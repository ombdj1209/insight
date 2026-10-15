import { join } from 'path'
import type { Brief, Citation, SearchHit } from '../shared/types'
import type { CalEvent } from '../shared/google'
import { onCalendarTick } from './calendar'
import { listCommitments } from './commitments'
import { meetingSourceId, search } from './ingest'
import { chat, chatWithTools } from './llm'
import { callMcpTool, mcpAvailable, mcpTools } from './mcp'
import { callMsTool, msConnected, msTools } from './microsoft'
import { sourcesBlock } from './meetings'
import { homeDir } from './paths'
import { getSettings } from './settings'
import { getMeeting, listMeetings } from './store'
import { emit, readJson, writeJson } from './util'

/** Pre-meeting briefs: what you need to know, a few minutes before each meeting. */
const file = (): string => join(homeDir(), 'briefs.json')
let briefs: Record<string, Brief> | null = null
const store = (): Record<string, Brief> => (briefs ??= readJson<Record<string, Brief>>(file(), {}))
export const briefKey = (e: Pick<CalEvent, 'id' | 'start'>): string => `${e.id}@${e.start}`
export const getBrief = (key: string): Brief | null => store()[key] ?? null

function persist(): void {
  const s = store()
  const cutoff = Date.now() - 3 * 86_400_000
  for (const [k, b] of Object.entries(s)) if (b.start < cutoff) delete s[k]
  writeJson(file(), s)
}

const SYSTEM = `You prepare a short pre-meeting brief so the user walks in prepared.
Use exactly these Markdown headings, in this order, and only those that have content:
## Why this meeting
## Since last time
## Promises
## Recent email
## Have open
## Ask
Under "Why this meeting": one line. "Since last time": decisions and open items from previous meetings with these people [n].
"Promises": what the user owes them and what they owe the user, with due dates. "Recent email": the latest relevant threads
with the attendees: who, when, the ask (Gmail). "Have open": 1-3 files worth opening [n]. "Ask": 2-3 sharp questions to raise.
Max 180 words. Cite local sources inline with [n]; mark email facts with (Gmail). Never invent facts.
Write in the language of the meeting title (translate the headings too).`

const words = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2))
function similarTitle(a: string, b: string): boolean {
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return false
  let n = 0
  for (const w of A) if (B.has(w)) n++
  return n / Math.min(A.size, B.size) >= 0.6
}

export async function generateBrief(e: CalEvent): Promise<Brief> {
  const others = (e.people ?? []).filter((p) => !p.self)
  const emails = new Set(others.map((p) => p.email.toLowerCase()))
  const names = others.map((p) => p.name || p.email.split('@')[0])

  // previous meetings with the same people or a similar title
  const prev = listMeetings()
    .map((s) => getMeeting(s.id))
    .filter((m): m is NonNullable<typeof m> => !!m && m.status === 'done' && (m.calendar?.eventId !== e.id || m.calendar.start !== e.start))
    .filter((m) => similarTitle(m.title, e.title) || (m.calendar?.people ?? []).some((p) => emails.has(p.email.toLowerCase())))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 2)
  const hits: SearchHit[] = prev.map((m) => ({
    chunkId: `prev:${m.id}`,
    title: m.title,
    loc: `Meeting ${new Date(m.createdAt).toLocaleDateString()}`,
    text: (m.enhanced || m.notes || m.transcript.map((l) => `${l.speaker}: ${l.text}`).join('\n')).slice(0, 1600),
    kind: 'meeting',
    label: 'Meetings',
    sourceId: meetingSourceId(m.id),
    score: 1
  }))
  const found = await search(`${e.title} ${names.join(' ')} ${e.description ?? ''}`.slice(0, 400), 6, { excludeSourceIds: prev.map((m) => meetingSourceId(m.id)) }).catch(() => [])
  hits.push(...found)

  const owed = listCommitments().filter(
    (c) => c.status === 'open' && ((c.email && emails.has(c.email.toLowerCase())) || names.some((n) => n && (c.person.toLowerCase().includes(n.toLowerCase().split(' ')[0]) || (c.forPerson ?? '').toLowerCase().includes(n.toLowerCase().split(' ')[0]))))
  )
  const promises = owed.map((c) => `- ${c.isMe ? 'You owe' : `${c.person} owes you`}${c.forPerson && c.isMe ? ` ${c.forPerson}` : ''}: ${c.text}${c.due ? ` (due ${c.due})` : ''}`).join('\n')

  const when = new Date(e.start)
  const user = `Meeting: ${e.title}
When: ${when.toLocaleString()}
Attendees: ${others.map((p) => (p.name ? `${p.name} <${p.email}>` : p.email)).join(', ') || '(none listed)'}
Invite description: ${e.description || '(none)'}

Open promises with these people:
${promises || '(none)'}

Sources:
${hits.length ? sourcesBlock(hits) : '(no matching local sources)'}`

  let md: string
  const tools = [...(mcpAvailable() ? (await mcpTools()).filter((t) => t.name.startsWith('gmail__') || t.name.startsWith('drive__')) : []), ...(msConnected() ? msTools().filter((t) => t.name !== 'outlook__list_events') : [])]
  if (tools.length && others.length) {
    const r = await chatWithTools(
      [
        { role: 'system', content: `${SYSTEM}\nYou may search the user's mail (Gmail and/or Outlook, read-only) for the last 14 days of threads with the attendees (use from:/to: with their emails) about this topic. At most 2 searches. Now: ${new Date().toString()}.` },
        { role: 'user', content: user }
      ],
      tools,
      (name, args) => (name.startsWith('outlook__') ? callMsTool(name, args) : callMcpTool(name, args)),
      { maxTokens: 900, maxRounds: 3 }
    )
    md = r.answer
  } else {
    md = await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], { maxTokens: 900, temperature: 0.2 })
  }

  // headings only, even if the model echoes the instructions after a dash or colon
  md = md.replace(/^(#{1,3}\s+[^\n—–:]+?)\s*[—–:].*$/gm, '$1')
  const used = new Set([...md.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1])))
  const citations: Citation[] = hits
    .map((h, i) => ({ n: i + 1, chunkId: h.chunkId, title: h.title, path: h.path, loc: h.loc, snippet: h.text.slice(0, 300), kind: h.kind, label: h.label, score: h.score }))
    .filter((c) => used.has(c.n))
  const b: Brief = { key: briefKey(e), eventId: e.id, title: e.title, start: e.start, md, citations, createdAt: Date.now() }
  store()[b.key] = b
  persist()
  return b
}

// ---------- automatic briefs ----------
const inflight = new Set<string>()
const failedAt = new Map<string, number>()

export function startBriefs(): void {
  onCalendarTick((evs) => {
    const s = getSettings()
    if (!s.briefs) return
    const now = Date.now()
    for (const e of evs) {
      const key = briefKey(e)
      const lead = e.start - now
      const worthIt = !e.allDay && ((e.people ?? []).filter((p) => !p.self).length > 0 || !!e.joinUrl)
      if (!worthIt || lead > s.briefMinutes * 60_000 || lead < -2 * 60_000) continue
      if (store()[key] || inflight.has(key) || now - (failedAt.get(key) ?? 0) < 10 * 60_000) continue
      inflight.add(key)
      void generateBrief(e)
        .then((brief) => emit('brief:ready', { brief, event: e }))
        .catch((err: Error) => {
          failedAt.set(key, Date.now())
          console.warn('brief failed', err.message)
        })
        .finally(() => inflight.delete(key))
      return // one at a time
    }
  })
}
