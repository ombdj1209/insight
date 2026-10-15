import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { ChatMessage, Meeting, MeetingSummary } from '../shared/types'
import { paths } from './paths'
import { readJson, uid, writeJson } from './util'

const meetingDir = (id: string): string => join(paths.meetings(), id)
const meetingFile = (id: string): string => join(meetingDir(id), 'meeting.json')
const cache = new Map<string, Meeting>()

export function listMeetings(): MeetingSummary[] {
  const out: MeetingSummary[] = []
  for (const id of readdirSync(paths.meetings())) {
    const m = getMeeting(id)
    if (!m) continue
    const preview = (m.enhanced || m.notes || m.transcript.map((t) => t.text).join(' ')).replace(/[#*_>-]/g, '').slice(0, 160)
    out.push({ id: m.id, title: m.title, createdAt: m.createdAt, durationMs: m.durationMs, status: m.status, preview })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export function getMeeting(id: string): Meeting | null {
  if (cache.has(id)) return cache.get(id)!
  if (!existsSync(meetingFile(id))) return null
  const m = readJson<Meeting | null>(meetingFile(id), null)
  if (m) {
    if (m.status === 'recording') m.status = 'done' // app closed mid-recording
    cache.set(id, m)
  }
  return m
}

export function saveMeeting(m: Meeting): Meeting {
  mkdirSync(meetingDir(m.id), { recursive: true })
  cache.set(m.id, m)
  writeJson(meetingFile(m.id), m)
  return m
}

export function createMeeting(): Meeting {
  const d = new Date()
  const title = `Meeting ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  return saveMeeting({ id: uid(), title, createdAt: Date.now(), durationMs: 0, notes: '', enhanced: '', transcript: [], assist: [], status: 'idle' })
}

export function updateMeeting(id: string, patch: Partial<Meeting>): Meeting {
  const m = getMeeting(id)
  if (!m) throw new Error('Meeting not found')
  return saveMeeting({ ...m, ...patch, id })
}

export function deleteMeeting(id: string): void {
  cache.delete(id)
  rmSync(meetingDir(id), { recursive: true, force: true })
}

export function saveSegmentAudio(meetingId: string, name: string, wav: Buffer): void {
  const d = join(meetingDir(meetingId), 'audio')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, name), wav)
}

export const getChat = (): ChatMessage[] => readJson<ChatMessage[]>(paths.chatFile(), [])
export const saveChat = (msgs: ChatMessage[]): void => writeJson(paths.chatFile(), msgs.slice(-200))
export const newMessage = (role: ChatMessage['role'], content: string): ChatMessage => ({ id: uid(), role, content, createdAt: Date.now() })

export function readSegmentAudio(meetingId: string, startMs: number, channel: string): Buffer | null {
  const f = join(meetingDir(meetingId), 'audio', `${startMs}-${channel}.wav`)
  return existsSync(f) ? readFileSync(f) : null
}

/** Delete saved audio older than `days` (transcripts and notes are kept). */
export function pruneAudio(days: number): number {
  if (!days) return 0
  const cutoff = Date.now() - days * 86_400_000
  let n = 0
  for (const id of readdirSync(paths.meetings())) {
    const d = join(meetingDir(id), 'audio')
    try {
      if (existsSync(d) && statSync(d).mtimeMs < cutoff) {
        rmSync(d, { recursive: true, force: true })
        n++
      }
    } catch {
      /* ignore */
    }
  }
  return n
}
