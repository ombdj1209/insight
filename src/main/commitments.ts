import { L } from './i18n'
import { Notification } from 'electron'
import { join } from 'path'
import type { Commitment, Meeting } from '../shared/types'
import type { Person } from '../shared/google'
import { lastSentTo } from './gactions'
import { msLastSentTo } from './microsoft'
import { showMainWindow } from './hotkey'
import { chat } from './llm'
import { fmtTime } from './ingest'
import { fitTranscript } from './meetings'
import { homeDir } from './paths'
import { awardBadge, awardXp, petConfig, petVisible } from './pet'
import { getSettings } from './settings'
import { getMeeting } from './store'
import { emit, readJson, uid, writeJson } from './util'

/** Promise tracker: commitments extracted from meetings, with nudges before they are due. */
const file = (): string => join(homeDir(), 'commitments.json')
let items: Commitment[] | null = null
const all = (): Commitment[] => (items ??= readJson<Commitment[]>(file(), []))
const save = (): void => {
  writeJson(file(), all())
  emit('commitments:changed', all())
}
export const listCommitments = (): Commitment[] => all()
export function removeCommitmentsFor(meetingId: string): void {
  items = all().filter((c) => c.meetingId !== meetingId)
  save()
}
const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function updateCommitment(id: string, patch: Partial<Pick<Commitment, 'status' | 'due' | 'text' | 'snoozeUntil'>>): Commitment[] {
  const c = all().find((x) => x.id === id)
  if (!c) return all()
  if (patch.status === 'done' && c.status !== 'done') {
    c.doneAt = Date.now()
    if (c.isMe) awardXp(3)
  }
  Object.assign(c, patch)
  save()
  if (patch.status === 'done' && c.isMe) {
    const kept = all().filter((x) => x.isMe && x.status === 'done').length
    if (kept >= 10) awardBadge('kept-10')
    if (kept >= 50) awardBadge('kept-50')
    if (!all().some((x) => x.isMe && x.status === 'open')) awardBadge('inbox-zero')
  }
  return all()
}

/** Match a spoken name ("Sofia", "Tanaka-san") to a calendar attendee. */
function emailFor(name: string | undefined, people: Person[]): string | undefined {
  if (!name) return undefined
  const n = name.toLowerCase().replace(/[-\s]?(san|sama|kun|chan)$/, '').trim()
  if (!n) return undefined
  const p = people.find((x) => !x.self && ((x.name ?? '').toLowerCase().includes(n) || x.email.toLowerCase().split('@')[0].includes(n.split(' ')[0])))
  return p?.email
}

const EXTRACT = (user: string, m: Meeting): string => {
  const d = new Date(m.createdAt)
  return `Extract commitments from a meeting: concrete promises someone made to do something ("I'll send…", "we will check…", "Sofia owns…").
The user's own lines are marked "(the user)"; their name is "${user}". Mark isMe=true only for commitments the user made.
The meeting was on ${d.toDateString()}. Resolve relative dates ("Friday", "next week", "by the 24th") to YYYY-MM-DD; null if none.
Return ONLY JSON: {"items":[{"isMe":true,"person":"who committed","forPerson":"who it is for or null","text":"the task, imperative, max 12 words","due":"YYYY-MM-DD or null","quote":"short exact quote or null"}]}
At most 12 items. Skip ideas, wishes and questions. Keep the meeting's language for text.`
}

export async function extractCommitments(meetingId: string): Promise<Commitment[]> {
  const m = getMeeting(meetingId)
  if (!m || (!m.transcript.length && !m.enhanced.trim())) return []
  const user = getSettings().userName || 'You'
  // the user's microphone lines are marked so ownership never depends on the model guessing names
  const micNames = new Set(m.transcript.filter((l) => l.channel === 'mic').map((l) => l.speaker.toLowerCase()))
  const marked = m.transcript.map((l) => `[${fmtTime(l.startMs)}] ${l.speaker}${l.channel === 'mic' ? ' (the user)' : ''}: ${l.text}`).join('\n')
  const transcript = marked.length < 60_000 ? marked : await fitTranscript(m)
  const aliases = new Set([user.toLowerCase(), user.split(' ')[0].toLowerCase(), 'you', 'me', 'i', 'the user', ...micNames])
  const isUser = (name?: string | null): boolean => !!name && aliases.has(name.toLowerCase().replace(/\s*\(the user\)\s*/, '').trim())
  const raw = await chat(
    [
      { role: 'system', content: EXTRACT(user, m) },
      { role: 'user', content: `Notes:\n${m.enhanced || m.notes || '(none)'}\n\nTranscript:\n${transcript || '(none)'}` }
    ],
    { maxTokens: 1200, temperature: 0.1 }
  )
  let parsed: { items?: { isMe?: boolean; person?: string; forPerson?: string | null; text?: string; due?: string | null; quote?: string | null }[] } = {}
  try {
    parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
  } catch {
    throw new Error('The AI model did not return a readable list of commitments. Try again.')
  }
  const people = m.calendar?.people ?? []
  const fresh: Commitment[] = (parsed.items ?? [])
    .filter((x) => x.text && x.text.trim())
    .slice(0, 12)
    .map((x) => ({
      id: uid(),
      meetingId,
      meetingTitle: m.title,
      // trust the speaker labels over the model's guess
      isMe: x.person ? isUser(x.person) : !!x.isMe,
      person: (x.person || (x.isMe ? user : 'Someone')).trim(),
      forPerson: x.forPerson ?? undefined,
      email: emailFor(x.isMe ? x.forPerson ?? undefined : x.person, people),
      text: x.text!.trim(),
      due: x.due && /^\d{4}-\d{2}-\d{2}$/.test(x.due) ? x.due : null,
      quote: x.quote ?? undefined,
      createdAt: Date.now(),
      status: 'open' as const
    }))
  // re-running replaces the still-open items of this meeting, keeping anything already done or dismissed
  items = all().filter((c) => c.meetingId !== meetingId || c.status !== 'open').concat(fresh)
  save()
  return all().filter((c) => c.meetingId === meetingId)
}

// ---------- nudges ----------
function quietNow(): boolean {
  const c = petConfig()
  const h = new Date().getHours()
  if (c.quietStart < 0 || c.quietStart === c.quietEnd) return h < 8 || h >= 21
  return c.quietStart < c.quietEnd ? h >= c.quietStart && h < c.quietEnd : h >= c.quietStart || h < c.quietEnd
}

async function nudgeTick(): Promise<void> {
  if (!getSettings().promiseNudges || quietNow()) return
  const now = Date.now()
  const today = ymd(new Date())
  const tomorrow = ymd(new Date(now + 86_400_000))
  const due = all().find(
    (c) =>
      c.isMe &&
      c.status === 'open' &&
      c.nudgedDay !== today &&
      (c.snoozeUntil ?? 0) < now &&
      (c.due ? c.due <= tomorrow : now - c.createdAt > 3 * 86_400_000)
  )
  if (!due) return
  due.nudgedDay = today
  save()
  let evidence: string | undefined
  if (due.email) {
    try {
      const sent = (await lastSentTo(due.email, due.createdAt).catch(() => null)) ?? (await msLastSentTo(due.email, due.createdAt).catch(() => null))
      if (sent) evidence = `You emailed ${due.forPerson || due.email} "${sent.subject}" on ${new Date(sent.date).toLocaleDateString()}. Was that it?`
    } catch {
      /* evidence is optional */
    }
  }
  emit('commitment:nudge', { c: due, evidence })
  if (!petVisible() && Notification.isSupported()) {
    const n = new Notification({ title: L('Insight: a promise is due'), body: `${due.text}${due.due ? ` (${L('due {date}', { date: due.due })})` : ''}` })
    n.on('click', showMainWindow)
    n.show()
  }
}

let started = false
export function startCommitments(): void {
  if (started) return
  started = true
  setTimeout(() => void nudgeTick().catch(() => undefined), 60_000)
  setInterval(() => void nudgeTick().catch(() => undefined), 5 * 60_000)
}
