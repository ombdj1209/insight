import { L } from './i18n'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import {
  freeSlots, icsEvent, MAX_FILE, MEMBER_ID, TEAM_DIR, validMember, validMessage, validStandup,
  type Busy, type StandupEntry, type TeamMember, type TeamMessage, type TeamMessageBody, type TeamStatus, type Visit
} from '../shared/team'
import { onCalendarTick, syncCalendar, upcomingEvents } from './calendar'
import { listCommitments } from './commitments'
import { createEvent } from './gactions'
import { actionsReady, googleEmail } from './google'
import { showMainWindow } from './hotkey'
import { indexMeeting } from './ingest'
import { meetingMarkdown } from './meetings'
import { msActionsReady, msEmail, msEvent } from './microsoft'
import { homeDir } from './paths'
import { awardXp, petConfig } from './pet'
import { getSettings, updateSettings } from './settings'
import { getMeeting, saveMeeting } from './store'
import { emit, readJson, uid, writeJson } from './util'
import { visit } from './visitor'

/**
 * Team pets over a folder the team already syncs (see src/shared/team.ts for the layout). No network code here:
 * the sync client (OneDrive, Google Drive, Dropbox, a network share) moves the files.
 */
const POLL_MS = 4000
const CARD_MS = 5 * 60_000
const MAX_AGE = 14 * 86_400_000

const root = (): string => join(getSettings().teamFolder, TEAM_DIR)
const me = (): string => getSettings().teamMemberId
const joined = (): boolean => !!getSettings().teamFolder && MEMBER_ID.test(me())
const clampMin = (n: number): number => Math.max(15, Math.min(240, Math.round(Number(n) || 30)))
const ymd = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ---------- files (everything read is untrusted) ----------
function writeAtomic(file: string, data: unknown): void {
  const json = JSON.stringify(data)
  if (json.length > MAX_FILE) throw new Error(L('That is too large to share through the team folder.'))
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(3).toString('hex')}.tmp`
  writeFileSync(tmp, json, 'utf8')
  renameSync(tmp, file)
}
function readCapped(file: string): unknown {
  try {
    if (statSync(file).size > MAX_FILE) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const jsonFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
}

// ---------- members ----------
function myCard(): TeamMember {
  const s = getSettings()
  const p = petConfig()
  return {
    v: 1,
    id: me(),
    name: (s.userName && s.userName !== 'You' ? s.userName : 'Teammate').slice(0, 60),
    email: googleEmail() ?? msEmail(),
    pet: { name: p.name, species: p.species, color: p.color, accent: p.accent, pattern: p.pattern, eyes: p.eyes, head: p.head, face: p.face, neck: p.neck },
    tzOffset: new Date().getTimezoneOffset(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    work: { start: s.teamWorkStart, end: s.teamWorkEnd },
    shareBusy: s.teamShareBusy,
    // start and end only: titles, attendees and places never leave this PC
    busy: s.teamShareBusy ? upcomingEvents().filter((e) => !e.allDay).slice(0, 500).map((e) => ({ s: e.start, e: e.end })) : [],
    updatedAt: Date.now()
  }
}

let lastCard = ''
let lastCardAt = 0
/** Write my card when it changed or every 5 minutes (called on each 20 s calendar tick). */
export function publishCard(force = false): void {
  if (!joined()) return
  const card = myCard()
  const key = JSON.stringify({ ...card, updatedAt: 0 })
  if (!force && key === lastCard && Date.now() - lastCardAt < CARD_MS) return
  try {
    writeAtomic(join(root(), 'members', `${me()}.json`), card)
    lastCard = key
    lastCardAt = Date.now()
  } catch (e) {
    console.warn('team card', (e as Error).message) // folder offline: try again next tick
  }
}

export function members(): TeamMember[] {
  if (!joined()) return []
  const dir = join(root(), 'members')
  return jsonFiles(dir)
    .map((f) => {
      const m = validMember(readCapped(join(dir, f)))
      return m && `${m.id}.json` === f ? m : null
    })
    .filter((m): m is TeamMember => !!m)
    .sort((a, b) => a.name.localeCompare(b.name))
}

const booking = (): TeamStatus['booking'] => (actionsReady() ? 'google' : msActionsReady() ? 'microsoft' : 'ics')

export function teamStatus(): TeamStatus {
  const s = getSettings()
  if (!joined()) return { folder: s.teamFolder, joined: false, teamName: '', memberId: s.teamMemberId, me: null, members: [], booking: booking() }
  const all = members()
  const t = readCapped(join(root(), 'team.json')) as { name?: unknown } | null
  return {
    folder: s.teamFolder,
    joined: true,
    teamName: typeof t?.name === 'string' && t.name.trim() ? t.name.slice(0, 80) : basename(s.teamFolder),
    memberId: me(),
    me: all.find((m) => m.id === me()) ?? null,
    members: all.filter((m) => m.id !== me()),
    booking: booking()
  }
}
const changed = (): void => emit('team:changed', teamStatus())

export async function joinTeam(parent: BrowserWindow | null): Promise<TeamStatus> {
  const opts: Electron.OpenDialogOptions = { title: L('Choose the folder your team shares'), properties: ['openDirectory', 'createDirectory'] }
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths[0]) return teamStatus()
  const folder = r.filePaths[0]
  const id = MEMBER_ID.test(me()) ? me() : randomBytes(10).toString('hex')
  const dir = join(folder, TEAM_DIR)
  for (const d of ['members', join('inbox', id), 'standups']) mkdirSync(join(dir, d), { recursive: true })
  if (!existsSync(join(dir, 'team.json'))) writeAtomic(join(dir, 'team.json'), { name: basename(folder), createdAt: Date.now() })
  updateSettings({ teamFolder: folder, teamMemberId: id })
  publishCard(true)
  changed()
  return teamStatus()
}

export function leaveTeam(): TeamStatus {
  if (joined()) {
    try {
      rmSync(join(root(), 'members', `${me()}.json`), { force: true })
      rmSync(join(root(), 'inbox', me()), { recursive: true, force: true })
    } catch {
      /* folder offline: teammates just stop seeing updates */
    }
  }
  updateSettings({ teamFolder: '' })
  lastCard = ''
  changed()
  return teamStatus()
}

// ---------- messages ----------
function send(to: string, body: TeamMessageBody): void {
  if (!joined() || !MEMBER_ID.test(to)) throw new Error(L('That teammate is not in this team folder.'))
  const at = Date.now()
  const id = `${at}-${randomBytes(4).toString('hex')}`
  writeAtomic(join(root(), 'inbox', to, `${id}.json`), { ...body, v: 1, id, from: me(), to, at })
}

const seenFile = (): string => join(homeDir(), 'team-seen.json')
let seen: string[] | null = null
const seenList = (): string[] => (seen ??= readJson<string[]>(seenFile(), []))
function markSeen(id: string): void {
  seen = [...seenList(), id].slice(-500)
  writeJson(seenFile(), seen)
}

function pollInbox(): void {
  if (!joined()) return
  const dir = join(root(), 'inbox', me())
  const files = jsonFiles(dir).slice(0, 50)
  if (!files.length) return
  const people = members()
  for (const f of files) {
    const p = join(dir, f)
    const raw = readCapped(p)
    // a file the sync client is still writing: try again on the next poll
    if (raw === null && Date.now() - (statSafe(p) ?? 0) < 60_000) continue
    try {
      rmSync(p, { force: true })
    } catch {
      /* read-only share: the seen list keeps it from repeating */
    }
    const msg = validMessage(raw, me())
    if (!msg || seenList().includes(msg.id) || Date.now() - msg.at > MAX_AGE) continue
    markSeen(msg.id)
    const from = people.find((m) => m.id === msg.from)
    if (from) receive(msg, from)
  }
}
const statSafe = (p: string): number | null => {
  try {
    return statSync(p).mtimeMs
  } catch {
    return null
  }
}

const when = (t: number): string => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const openTeamPage = (): void => {
  showMainWindow()
  emit('pet:command', { cmd: 'open', page: 'team' })
}

function receive(m: TeamMessage, from: TeamMember): void {
  const name = from.name
  const v = (text: string, actions: Visit['actions']): Visit => ({ id: m.id, from: name, pet: from.pet, text, actions })
  switch (m.type) {
    case 'wave':
      awardXp(1)
      return visit(v(L('{name} says hi!', { name }), [{ id: 'wave', label: L('Wave back'), primary: true }, { id: 'bye', label: L('Bye') }]), (a) => {
        if (a !== 'wave') return
        send(from.id, { type: 'wave' })
        return L('Waved back!')
      }, 60_000)
    case 'meet.ask':
      return visit(
        v(L('{name} would like to meet: "{title}", {when} ({min} min).', { name, title: m.title, when: when(m.start), min: m.minutes }), [
          { id: 'accept', label: L('Accept'), primary: true },
          { id: 'decline', label: L('Decline') }
        ]),
        (a) => {
          if (a === 'accept') {
            openIcs(m.title, m.start, m.minutes, from.email ? [from.email] : [])
            send(from.id, { type: 'meet.booked', title: m.title, minutes: m.minutes, start: m.start, via: 'ics' })
            return L('Accepted. Save the invite that opened to add it to your calendar.')
          }
          if (a === 'decline') {
            send(from.id, { type: 'meet.declined', title: m.title, start: m.start })
            return L('Declined. I let {name} know.', { name })
          }
        }
      )
    case 'meet.booked':
      if (m.via !== 'ics') void syncCalendar().catch(() => undefined)
      return visit(
        v(m.via === 'ics' ? L('{name} accepted "{title}", {when}.', { name, title: m.title, when: when(m.start) }) : L('{name} booked "{title}" with you, {when}. The invite is in your calendar.', { name, title: m.title, when: when(m.start) }), [{ id: 'ok', label: L('OK'), primary: true }]),
        () => undefined,
        3 * 60_000
      )
    case 'meet.declined':
      return visit(v(L('{name} can\'t make "{title}" ({when}).', { name, title: m.title, when: when(m.start) }), [{ id: 'find', label: L('Find another time'), primary: true }, { id: 'ok', label: L('OK') }]), (a) => {
        if (a === 'find') openTeamPage()
      })
    case 'notes':
      return visit(v(L('{name} shared notes: "{title}".', { name, title: m.title }), [{ id: 'save', label: L('Save to my meetings'), primary: true }, { id: 'no', label: L('No thanks') }]), async (a) => {
        if (a !== 'save') return
        await importNotes(m, name)
        return L('Saved. It is in your meetings now.')
      })
    case 'standup.ping':
      return visit(v(L('{name} is asking for your stand-up.', { name }), [{ id: 'open', label: L('Write stand-up'), primary: true }, { id: 'later', label: L('Later') }]), (a) => {
        if (a === 'open') openTeamPage()
      })
  }
}

async function importNotes(m: Extract<TeamMessage, { type: 'notes' }>, name: string): Promise<void> {
  const meeting = saveMeeting({
    id: uid(),
    title: m.title,
    createdAt: m.date,
    durationMs: 0,
    notes: L('Shared by {name}', { name }),
    enhanced: m.markdown.replace(/^# [^\n]*\n+/, ''), // the title is already the meeting's title
    transcript: [],
    assist: [],
    status: 'done'
  })
  emit('meetings:changed', null)
  await indexMeeting(meeting).catch(() => undefined)
}

function openIcs(title: string, start: number, minutes: number, attendees: string[]): void {
  const file = join(app.getPath('temp'), `insight-invite-${randomBytes(4).toString('hex')}.ics`)
  writeFileSync(file, icsEvent({ uid: uid(), title, start, minutes, attendees, organizer: googleEmail() ?? msEmail() }), 'utf8')
  void shell.openPath(file)
}

// ---------- actions from the Team page ----------
export function findTime(ids: string[], minutes: number): Busy[] {
  const all = members()
  const people = [myCard(), ...ids.map((id) => all.find((m) => m.id === id)).filter((m): m is TeamMember => !!m)]
  return freeSlots(people, clampMin(minutes), Date.now())
}

export async function book(p: { ids: string[]; title: string; start: number; minutes: number }): Promise<{ via: TeamStatus['booking']; url?: string }> {
  const all = members()
  const who = p.ids.map((id) => all.find((m) => m.id === id)).filter((m): m is TeamMember => !!m)
  if (!who.length) throw new Error(L('Pick at least one teammate.'))
  const title = String(p.title ?? '').trim().slice(0, 200) || L('Catch-up')
  const minutes = clampMin(p.minutes)
  const start = Number(p.start)
  if (!(start > Date.now())) throw new Error(L('Pick a time in the future.'))
  const attendees = who.map((m) => m.email).filter((e): e is string => !!e)
  const via = booking()
  if (via !== 'ics') {
    const r = await (via === 'google' ? createEvent : msEvent)({ title, start, minutes, attendees, meet: true, description: L('Booked with Insight team pets.') })
    for (const m of who) send(m.id, { type: 'meet.booked', title, minutes, start, via })
    void syncCalendar().catch(() => undefined)
    awardXp(2)
    return { via, url: r.url }
  }
  openIcs(title, start, minutes, attendees)
  for (const m of who) send(m.id, { type: 'meet.ask', title, minutes, start })
  return { via }
}

export function sendNotes(meetingId: string, ids: string[]): number {
  const m = getMeeting(meetingId)
  if (!m) throw new Error(L('That meeting no longer exists.'))
  const markdown = meetingMarkdown(m).slice(0, 59_000)
  let n = 0
  for (const id of ids) {
    send(id, { type: 'notes', title: m.title.slice(0, 200), date: m.createdAt, markdown })
    n++
  }
  return n
}

export const wave = (id: string): void => send(id, { type: 'wave' })

// ---------- stand-ups ----------
export function standup(): { date: string; suggestion: { done: string[]; today: string[] }; entries: StandupEntry[] } {
  const date = ymd()
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const since = midnight.getTime() - 86_400_000
  const mine = listCommitments().filter((c) => c.isMe)
  const suggestion = {
    done: mine.filter((c) => c.status === 'done' && (c.doneAt ?? 0) >= since).map((c) => c.text).slice(0, 12),
    today: mine.filter((c) => c.status === 'open' && !!c.due && c.due <= date).map((c) => c.text).slice(0, 12)
  }
  const dir = join(root(), 'standups', date)
  const entries = joined()
    ? jsonFiles(dir)
        .map((f) => {
          const s = validStandup(readCapped(join(dir, f)))
          return s && `${s.memberId}.json` === f && s.date === date ? s : null
        })
        .filter((s): s is StandupEntry => !!s)
        .sort((a, b) => a.at - b.at)
    : []
  return { date, suggestion, entries }
}

export function postStandup(p: { done: string[]; today: string[] }): ReturnType<typeof standup> {
  if (!joined()) throw new Error(L('Join a team first.'))
  const date = ymd()
  const entry = validStandup({ v: 1, memberId: me(), name: myCard().name, date, done: p.done, today: p.today, at: Date.now() })
  if (!entry) throw new Error(L('Write at least one line.'))
  writeAtomic(join(root(), 'standups', date, `${me()}.json`), entry)
  awardXp(2)
  return standup()
}

/** Nudge teammates who have not posted today; returns how many were pinged. */
export function pingStandup(): number {
  const { date, entries } = standup()
  const posted = new Set(entries.map((e) => e.memberId))
  const others = members().filter((m) => m.id !== me() && !posted.has(m.id))
  for (const m of others) send(m.id, { type: 'standup.ping', date })
  return others.length
}

// ---------- clock ----------
let started = false
let membersKey = ''
export function startTeam(): void {
  if (started) return
  started = true
  setInterval(() => {
    try {
      pollInbox()
    } catch (e) {
      console.warn('team inbox', (e as Error).message)
    }
  }, POLL_MS)
  onCalendarTick(() => publishCard())
  setInterval(() => {
    const key = members().map((m) => `${m.id}:${m.updatedAt}`).join()
    if (key !== membersKey) {
      membersKey = key
      changed()
    }
  }, 30_000)
  publishCard(true)
}
