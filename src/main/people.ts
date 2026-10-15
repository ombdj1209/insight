import { join } from 'path'
import type { Person as CalPerson } from '../shared/google'
import type { PersonCard } from '../shared/types'
import { listCommitments } from './commitments'
import { embed, chat } from './llm'
import { homeDir } from './paths'
import { getSettings } from './settings'
import { getMeeting, listMeetings } from './store'
import { readJson, uid, writeJson } from './util'
import { index } from './vectorIndex'

/** People memory: one card per person you meet, built from meetings, calendar attendees and promises. */
const file = (): string => join(homeDir(), 'people.json')
type Saved = Record<string, { summary: string; updatedAt: number }>
let saved: Saved | null = null
const store = (): Saved => (saved ??= readJson<Saved>(file(), {}))

const GENERIC = /^(speaker\s*\d+|others?|unknown|you|me|guest|participant)$/i
const norm = (s: string): string => s.toLowerCase().replace(/[-\s]?(san|sama|kun|chan|さん|様)$/u, '').replace(/\s+/g, ' ').trim()
const first = (s: string): string => norm(s).split(' ')[0]

export function listPeople(): PersonCard[] {
  const user = norm(getSettings().userName || 'You')
  const cards = new Map<string, PersonCard>()
  const byName = new Map<string, string>() // first name -> key, to merge speakers into calendar attendees
  const card = (key: string, name: string, email?: string): PersonCard => {
    let c = cards.get(key)
    if (!c) {
      c = { key, name, email, meetings: [], lastMet: 0, theyOwe: 0, youOwe: 0, summary: store()[key]?.summary, summaryAt: store()[key]?.updatedAt }
      cards.set(key, c)
    }
    if (email && !c.email) c.email = email
    if (name.length > c.name.length && !name.includes('@')) c.name = name
    return c
  }
  const meetings = listMeetings()
    .map((s) => getMeeting(s.id))
    .filter((m): m is NonNullable<typeof m> => !!m)
  for (const m of meetings) {
    const seen = new Set<string>()
    const add = (c: PersonCard): void => {
      if (seen.has(c.key)) return
      seen.add(c.key)
      c.meetings.push({ id: m.id, title: m.title, at: m.createdAt })
      c.lastMet = Math.max(c.lastMet, m.createdAt)
    }
    for (const p of (m.calendar?.people ?? []) as CalPerson[]) {
      if (p.self) continue
      const name = p.name || p.email.split('@')[0]
      const c = card(p.email.toLowerCase(), name, p.email)
      byName.set(first(name), c.key)
      add(c)
    }
    const speakers = new Set([...Object.values(m.speakers ?? {}), ...m.transcript.filter((l) => l.channel === 'system').map((l) => l.speaker)])
    for (const sp of speakers) {
      const n = norm(sp)
      if (!n || GENERIC.test(n) || n === user || first(sp) === first(user)) continue
      const key = byName.get(first(sp)) ?? `name:${n}`
      add(card(key, sp))
    }
  }
  for (const c of listCommitments()) {
    if (c.status !== 'open') continue
    const who = c.isMe ? c.forPerson : c.person
    const key = (c.email && cards.has(c.email.toLowerCase()) ? c.email.toLowerCase() : who ? byName.get(first(who)) ?? `name:${norm(who)}` : '') || ''
    const pc = cards.get(key)
    if (!pc) continue
    if (c.isMe) pc.youOwe++
    else pc.theyOwe++
  }
  return [...cards.values()].filter((c) => c.meetings.length).sort((a, b) => b.lastMet - a.lastMet)
}

export async function summarizePerson(key: string): Promise<PersonCard | null> {
  const p = listPeople().find((x) => x.key === key)
  if (!p) return null
  const fn = first(p.name)
  const parts: string[] = []
  for (const ref of p.meetings.slice(0, 8)) {
    const m = getMeeting(ref.id)
    if (!m) continue
    const said = m.transcript.filter((l) => first(l.speaker) === fn).map((l) => `${l.speaker}: ${l.text}`).join('\n').slice(0, 1500)
    parts.push(`### ${m.title} (${new Date(m.createdAt).toLocaleDateString()})\n${(m.enhanced || m.notes).slice(0, 1500)}\n${said ? `What ${p.name} said:\n${said}` : ''}`)
  }
  const promises = listCommitments()
    .filter((c) => c.status === 'open' && (first(c.person) === fn || first(c.forPerson ?? '') === fn))
    .map((c) => `- ${c.isMe ? `You owe ${p.name}` : `${p.name} owes you`}: ${c.text}${c.due ? ` (due ${c.due})` : ''}`)
    .join('\n')
  const md = await chat(
    [
      {
        role: 'system',
        content: `Write a short profile of a work contact from meeting notes, for the user to prepare for their next conversation.
Sections (Markdown, only those with content): ## What you work on together, ## Their priorities, ## Open items, ## Good to remember.
"Good to remember" = work-relevant things they explicitly said (preferred channel, time zone, upcoming leave, deadlines). Never guess personal traits,
health, religion, politics or anything not said. Max 140 words. Write in the language most used in the notes.`
      },
      { role: 'user', content: `Contact: ${p.name}${p.email ? ` <${p.email}>` : ''}\nMeetings together: ${p.meetings.length}\n\nOpen promises:\n${promises || '(none)'}\n\n${parts.join('\n\n') || '(no notes)'}` }
    ],
    { maxTokens: 700, temperature: 0.2 }
  )
  store()[key] = { summary: md, updatedAt: Date.now() }
  writeJson(file(), store())
  // searchable in Ask: "brief me on Daniel"
  const sourceId = `person:${key}`
  index.removeWhere((c) => c.sourceId === sourceId)
  try {
    const text = `${p.name}${p.email ? ` (${p.email})` : ''}\n${md}`
    index.add([{ id: uid(), sourceId, kind: 'memory', title: `About ${p.name}`, label: 'People', text }], await embed([{ text, title: p.name }], 'doc'))
  } catch {
    /* search not ready */
  }
  return { ...p, summary: md, summaryAt: Date.now() }
}
