import type { PetConfig } from './pet'

/**
 * Team pets. Teammates share one synced folder (OneDrive, SharePoint, Google Drive for desktop, Dropbox or a network
 * share). Insight only reads and writes small JSON files in `<folder>/.insight-team/`; the sync client moves them.
 *
 *   team.json                         { name, createdAt }
 *   members/<memberId>.json           TeamMember (busy blocks only, never titles)
 *   inbox/<memberId>/<file>.json      TeamMessage addressed to that member
 *   standups/<yyyy-mm-dd>/<memberId>.json  StandupEntry
 *
 * Everything read from the folder is untrusted: validate it, cap sizes, render as text, never execute.
 */
export const TEAM_DIR = '.insight-team'
export const MAX_FILE = 200_000
export const MEMBER_ID = /^[a-z0-9]{12,40}$/

export type TeamPet = Pick<PetConfig, 'name' | 'species' | 'color' | 'accent' | 'pattern' | 'eyes' | 'head' | 'face' | 'neck'>
export interface Busy {
  s: number
  e: number
}
export interface TeamMember {
  v: 1
  id: string
  name: string
  email?: string
  pet: TeamPet
  /** minutes, as Date.getTimezoneOffset() (UTC minus local) */
  tzOffset: number
  tz: string
  /** local working hours */
  work: { start: number; end: number }
  shareBusy: boolean
  busy: Busy[]
  updatedAt: number
}
export type TeamMessageBody =
  | { type: 'wave' }
  | { type: 'meet.ask'; title: string; minutes: number; start: number }
  | { type: 'meet.booked'; title: string; minutes: number; start: number; via: 'google' | 'microsoft' | 'ics' }
  | { type: 'meet.declined'; title: string; start: number }
  | { type: 'notes'; title: string; date: number; markdown: string }
  | { type: 'standup.ping'; date: string }
export type TeamMessage = TeamMessageBody & { v: 1; id: string; from: string; to: string; at: number }
export interface StandupEntry {
  v: 1
  memberId: string
  name: string
  date: string
  done: string[]
  today: string[]
  at: number
}
export interface TeamStatus {
  folder: string
  joined: boolean
  teamName: string
  memberId: string
  me: TeamMember | null
  members: TeamMember[]
  /** how a meeting gets booked from this PC */
  booking: 'google' | 'microsoft' | 'ics'
}
/** What a visiting pet shows; actions are answered through team:visitAct. */
export interface Visit {
  id: string
  from: string
  pet: TeamPet
  text: string
  actions: { id: string; label: string; primary?: boolean }[]
  reply?: string
}

// ---------- validation (folder contents are untrusted) ----------
const str = (x: unknown, max: number): string | null => (typeof x === 'string' && x.length <= max ? x : null)
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const SPECIES = ['blob', 'cat', 'fox', 'bunny', 'bear', 'axolotl', 'robot', 'ghost', 'dragon', 'penguin']
const HEX = /^#[0-9a-fA-F]{6}$/

export function validPet(p: unknown): TeamPet | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  const name = str(o.name, 40), species = str(o.species, 20), color = str(o.color, 7), accent = str(o.accent, 7)
  if (!name || !species || !SPECIES.includes(species) || !color || !HEX.test(color) || !accent || !HEX.test(accent)) return null
  const pick = (k: string): string => str(o[k], 20) ?? 'none'
  return { name, species, color, accent, pattern: pick('pattern'), eyes: str(o.eyes, 20) ?? 'dots', head: pick('head'), face: pick('face'), neck: pick('neck') } as TeamPet
}

export function validMember(x: unknown): TeamMember | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const id = str(o.id, 40), name = str(o.name, 60), pet = validPet(o.pet)
  const tzOffset = num(o.tzOffset), updatedAt = num(o.updatedAt)
  const work = o.work as Record<string, unknown> | undefined
  const ws = num(work?.start), we = num(work?.end)
  if (!id || !MEMBER_ID.test(id) || !name || !pet || tzOffset === null || Math.abs(tzOffset) > 14 * 60 || updatedAt === null) return null
  if (ws === null || we === null || ws < 0 || we > 24 || ws >= we) return null
  const busy = (Array.isArray(o.busy) ? o.busy : [])
    .slice(0, 500)
    .map((b) => ({ s: num((b as Busy)?.s), e: num((b as Busy)?.e) }))
    .filter((b): b is Busy => b.s !== null && b.e !== null && b.e > b.s)
  const email = str(o.email, 120) ?? undefined
  return { v: 1, id, name, email: email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : undefined, pet, tzOffset, tz: str(o.tz, 60) ?? '', work: { start: ws, end: we }, shareBusy: o.shareBusy !== false, busy, updatedAt }
}

export function validMessage(x: unknown, me: string): TeamMessage | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const id = str(o.id, 80), from = str(o.from, 40), to = str(o.to, 40), at = num(o.at), type = str(o.type, 20)
  if (!id || !from || !MEMBER_ID.test(from) || to !== me || at === null || !type) return null
  const base = { v: 1 as const, id, from, to, at }
  const title = str(o.title, 200), minutes = num(o.minutes), start = num(o.start)
  switch (type) {
    case 'wave':
      return { ...base, type }
    case 'meet.ask':
      return title && minutes && minutes > 0 && minutes <= 480 && start ? { ...base, type, title, minutes, start } : null
    case 'meet.booked': {
      const via = o.via === 'google' || o.via === 'microsoft' ? o.via : 'ics'
      return title && minutes && minutes > 0 && minutes <= 480 && start ? { ...base, type, title, minutes, start, via } : null
    }
    case 'meet.declined':
      return title && start ? { ...base, type, title, start } : null
    case 'notes': {
      const markdown = str(o.markdown, 60_000), date = num(o.date)
      return title && markdown !== null && date !== null ? { ...base, type, title, date, markdown } : null
    }
    case 'standup.ping': {
      const date = str(o.date, 10)
      return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { ...base, type, date } : null
    }
  }
  return null
}

export function validStandup(x: unknown): StandupEntry | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const memberId = str(o.memberId, 40), name = str(o.name, 60), date = str(o.date, 10), at = num(o.at)
  if (!memberId || !MEMBER_ID.test(memberId) || !name || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || at === null) return null
  const list = (v: unknown): string[] => (Array.isArray(v) ? v : []).map((s) => str(s, 300)).filter((s): s is string => !!s?.trim()).slice(0, 12)
  return { v: 1, memberId, name, date, done: list(o.done), today: list(o.today), at }
}

// ---------- scheduling ----------
const MIN = 60_000
/**
 * Free slots everyone can make: inside each person's local working hours (Mon–Fri), clear of their busy blocks,
 * on a 30-minute grid, at least 30 minutes from now. Picks spread-out options (a different hour or day each).
 */
export function freeSlots(people: Pick<TeamMember, 'busy' | 'work' | 'tzOffset'>[], minutes: number, now: number, opts: { days?: number; count?: number } = {}): Busy[] {
  const days = opts.days ?? 10, count = opts.count ?? 3
  const step = 30 * MIN
  let s = Math.ceil((now + 30 * MIN) / step) * step
  const until = now + days * 24 * 60 * MIN
  const out: Busy[] = []
  const fits = (p: (typeof people)[number], a: number, b: number): boolean => {
    const local = new Date(a - p.tzOffset * MIN)
    const day = local.getUTCDay()
    if (day === 0 || day === 6) return false
    const h0 = local.getUTCHours() + local.getUTCMinutes() / 60
    const h1 = h0 + (b - a) / (60 * MIN)
    if (h0 < p.work.start || h1 > p.work.end) return false
    return !p.busy.some((x) => x.s < b && x.e > a)
  }
  for (; s + minutes * MIN <= until && out.length < count; s += step) {
    const e = s + minutes * MIN
    if (!people.every((p) => fits(p, s, e))) continue
    // spread options out: skip anything within 90 minutes of an option already picked
    if (out.some((o) => Math.abs(o.s - s) < 90 * MIN)) continue
    out.push({ s, e })
  }
  return out
}

/** A minimal iCalendar invite (used when no Google or Microsoft account can book). */
export function icsEvent(p: { uid: string; title: string; start: number; minutes: number; attendees: string[]; organizer?: string }): string {
  const f = (t: number): string => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc = (s: string): string => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Insight//Team pets//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${p.uid}@insight`,
    `DTSTAMP:${f(Date.now())}`,
    `DTSTART:${f(p.start)}`,
    `DTEND:${f(p.start + p.minutes * MIN)}`,
    `SUMMARY:${esc(p.title)}`,
    ...(p.organizer ? [`ORGANIZER:mailto:${p.organizer}`] : []),
    ...p.attendees.map((a) => `ATTENDEE;RSVP=TRUE:mailto:${a}`),
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n')
}
