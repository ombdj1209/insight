import { join } from 'path'
import type { Recap } from '../shared/types'
import { listCommitments } from './commitments'
import { homeDir } from './paths'
import { getSettings } from './settings'
import { getMeeting, listMeetings } from './store'
import { emit, readJson, writeJson } from './util'

/** Weekly recap and meeting health. Pure local stats; nothing leaves the PC. */
const stateFile = (): string => join(homeDir(), 'recap.json')

export function weekStart(d = new Date()): number {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7 // Monday = 0
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - day)
  return x.getTime()
}

export function computeRecap(offsetWeeks = 0): Recap {
  const from = weekStart() - offsetWeeks * 7 * 86_400_000
  const to = from + 7 * 86_400_000
  const ms = listMeetings()
    .filter((s) => s.createdAt >= from && s.createdAt < to)
    .map((s) => getMeeting(s.id))
    .filter((m): m is NonNullable<typeof m> => !!m && m.durationMs > 60_000)
  let mine = 0, all = 0
  const perDay = new Array(7).fill(0) as number[]
  const couldBeEmail: Recap['couldBeEmail'] = []
  for (const m of ms) {
    for (const l of m.transcript) {
      const d = Math.max(0, l.endMs - l.startMs)
      all += d
      if (l.channel === 'mic') mine += d
    }
    perDay[(new Date(m.createdAt).getDay() + 6) % 7] += m.durationMs
    const n = m.enhanced
    const actions = /##\s*(Action items|アクションアイテム)[^\n]*\n([\s\S]*?)(\n##\s|$)/i.exec(n)?.[2].split('\n').filter((l) => /^\s*[-*•]\s+\S/.test(l)).length ?? 0
    const decisions = /##\s*(Decisions|決定事項)/i.test(n)
    // no decisions, no action items, and nothing much said by the user: probably could have been a written update
    if (n && !actions && !decisions && m.durationMs >= 10 * 60_000) couldBeEmail.push({ id: m.id, title: m.title, minutes: Math.round(m.durationMs / 60_000) })
  }
  const cs = listCommitments().filter((c) => c.createdAt >= from && c.createdAt < to)
  const kept = listCommitments().filter((c) => c.isMe && c.status === 'done' && (c.doneAt ?? 0) >= from && (c.doneAt ?? 0) < to).length
  const busiest = perDay.indexOf(Math.max(...perDay))
  const longest = ms.slice().sort((a, b) => b.durationMs - a.durationMs)[0]
  return {
    from,
    to,
    meetings: ms.length,
    totalMs: ms.reduce((a, m) => a + m.durationMs, 0),
    talkShare: all ? mine / all : null,
    promisesMade: cs.filter((c) => c.isMe).length,
    promisesKept: kept,
    waitingOn: listCommitments().filter((c) => !c.isMe && c.status === 'open').length,
    actionItems: cs.length,
    busiestDay: ms.length ? busiest : null,
    longest: longest ? { id: longest.id, title: longest.title, minutes: Math.round(longest.durationMs / 60_000) } : null,
    couldBeEmail: couldBeEmail.slice(0, 5),
    perDayMs: perDay
  }
}

/** Friday 16:00 (local): present the week once, through the pet. */
export function startRecap(): void {
  const tick = (): void => {
    if (!getSettings().weeklyRecap) return
    const d = new Date()
    if (d.getDay() !== 5 || d.getHours() < 16) return
    const st = readJson<{ shownWeek?: number }>(stateFile(), {})
    const wk = weekStart(d)
    if (st.shownWeek === wk) return
    const r = computeRecap(0)
    if (!r.meetings) return
    writeJson(stateFile(), { shownWeek: wk })
    emit('recap:ready', r)
  }
  setTimeout(tick, 90_000)
  setInterval(tick, 10 * 60_000)
}
