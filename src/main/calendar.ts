import { L } from './i18n'
import { Notification } from 'electron'
import { join } from 'path'
import { joinUrlOf, type CalEvent } from '../shared/google'
import { googleConnected, googleFetch } from './google'
import { msConnected, msEvents } from './microsoft'
import { showMainWindow } from './hotkey'
import { petVisible } from './pet'
import { homeDir } from './paths'
import { getSettings } from './settings'
import { emit, readJson, writeJson } from './util'

/** Google Calendar sync for meeting reminders with a one-click Join. Keeps the next 7 days in calendar.json. */
const file = (): string => join(homeDir(), 'calendar.json')
const SYNC_MS = 5 * 60_000
const CHECK_MS = 20_000

let events: CalEvent[] | null = null
const notified = new Set<string>()
const shown = new Set<Notification>() // keep references so Windows click handlers survive GC

export const upcomingEvents = (): CalEvent[] => (events ??= readJson<CalEvent[]>(file(), [])).filter((e) => e.end > Date.now())

interface GEvent {
  id: string
  status?: string
  summary?: string
  location?: string
  description?: string
  htmlLink?: string
  hangoutLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { self?: boolean; responseStatus?: string; email?: string; displayName?: string; resource?: boolean }[]
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
}

async function googleEvents(now: number): Promise<CalEvent[]> {
  const q = new URLSearchParams({
    timeMin: new Date(now - 6 * 3600_000).toISOString(),
    timeMax: new Date(now + 7 * 86_400_000).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100'
  })
  const res = await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`)
  if (!res.ok) throw new Error(`Google Calendar sync failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as { items?: GEvent[] }
  return (j.items ?? [])
    .filter((e) => e.status !== 'cancelled' && e.attendees?.find((a) => a.self)?.responseStatus !== 'declined')
    .map((e) => ({
      id: e.id,
      title: e.summary || '(No title)',
      start: Date.parse(e.start?.dateTime ?? e.start?.date ?? ''),
      end: Date.parse(e.end?.dateTime ?? e.end?.date ?? ''),
      allDay: !e.start?.dateTime,
      location: e.location,
      joinUrl: joinUrlOf(e),
      htmlLink: e.htmlLink,
      attendees: e.attendees?.length ?? 0,
      people: (e.attendees ?? []).filter((a) => a.email && !a.resource).map((a) => ({ email: a.email!, name: a.displayName, self: a.self })),
      description: e.description ? e.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200) : undefined
    }))
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end))
}

/** Sync the next 7 days from every connected calendar (Google and Microsoft 365). */
export async function syncCalendar(): Promise<CalEvent[]> {
  if (!getSettings().calendarSync) return upcomingEvents()
  const now = Date.now()
  const sources: Promise<CalEvent[]>[] = []
  if (googleConnected()) sources.push(googleEvents(now))
  if (msConnected()) sources.push(msEvents(now - 6 * 3600_000, now + 7 * 86_400_000))
  if (!sources.length) return upcomingEvents()
  const results = await Promise.allSettled(sources)
  const ok = results.filter((r): r is PromiseFulfilledResult<CalEvent[]> => r.status === 'fulfilled')
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason
  // the same meeting on both calendars (invites across tenants): keep one
  const seen = new Set<string>()
  events = ok
    .flatMap((r) => r.value)
    .sort((a, b) => a.start - b.start)
    .filter((e) => {
      const k = `${e.title.trim().toLowerCase()}@${Math.round(e.start / 60_000)}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  writeJson(file(), events)
  emit('calendar:changed', upcomingEvents())
  return upcomingEvents()
}

/** The calendar event happening around `at` (used to link a recording to its meeting). */
export function eventAt(at: number): CalEvent | undefined {
  return (events ??= readJson<CalEvent[]>(file(), []))
    .filter((e) => !e.allDay && e.start - 15 * 60_000 <= at && e.end >= at)
    .sort((a, b) => Math.abs(a.start - at) - Math.abs(b.start - at))[0]
}

const ticks: ((evs: CalEvent[]) => void)[] = []
/** lets the brief scheduler and team pets run on the same 20 s clock */
export const onCalendarTick = (fn: (evs: CalEvent[]) => void): void => {
  ticks.push(fn)
}

function checkReminders(): void {
  for (const fn of ticks) {
    try {
      fn(upcomingEvents())
    } catch (e) {
      console.warn('calendar tick', e)
    }
  }
  const s = getSettings()
  if (!s.calendarSync) return
  const now = Date.now()
  const lead = Math.max(0, s.reminderMinutes) * 60_000
  for (const e of upcomingEvents()) {
    const key = `${e.id}@${e.start}`
    // remind once, from `lead` before the start until 5 min after (covers a PC waking from sleep)
    if (e.allDay || notified.has(key) || now < e.start - lead || now > e.start + 5 * 60_000) continue
    notified.add(key)
    emit('calendar:reminder', e)
    // the desktop pet shows the reminder with Join buttons; avoid a duplicate Windows toast
    if (!Notification.isSupported() || petVisible()) continue
    const mins = Math.round((e.start - now) / 60_000)
    const n = new Notification({
      title: e.title,
      body: `${mins > 0 ? L('Starts in {mins} min', { mins }) : L('Starting now')} · ${new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${e.joinUrl ? ` · ${L('Click to join')}` : ''}`
    })
    n.on('click', () => {
      showMainWindow()
      emit('calendar:reminder', e)
      shown.delete(n)
    })
    n.on('close', () => shown.delete(n))
    shown.add(n)
    n.show()
  }
}

let started = false

export function startCalendar(): void {
  if (started) return
  started = true
  const sync = (): void => void syncCalendar().catch((e: Error) => console.warn(e.message))
  sync()
  setInterval(sync, SYNC_MS)
  setInterval(checkReminders, CHECK_MS)
}
