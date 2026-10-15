import { mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Slide } from '../shared/types'
import { chat, embed, isCloudAi } from './llm'
import { fmtTime } from './ingest'
import { markCloud } from './meetings'
import { paths } from './paths'
import { getMeeting, saveMeeting } from './store'
import { emit, SerialQueue, uid } from './util'
import { index, type ChunkMeta } from './vectorIndex'

/**
 * Slide capture: frames of the shared screen saved when the content changes (detected in the renderer),
 * read by the AI model, and added to the meeting's notes context and the search index.
 */
const MAX_PER_MEETING = 80
const queue = new SerialQueue()
const dirOf = (meetingId: string): string => join(paths.meetings(), meetingId, 'slides')
export const slidesSourceId = (meetingId: string): string => `slides:${meetingId}`

const words = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))
function sameText(a: string, b: string): boolean {
  const A = words(a), B = words(b)
  if (A.size < 3 || B.size < 3) return false
  let n = 0
  for (const w of A) if (B.has(w)) n++
  return n / Math.max(A.size, B.size) >= 0.85
}

export function addSlide(meetingId: string, atMs: number, jpeg: ArrayBuffer): void {
  const m = getMeeting(meetingId)
  if (!m || (m.slides?.length ?? 0) >= MAX_PER_MEETING) return
  const id = uid()
  const d = dirOf(meetingId)
  mkdirSync(d, { recursive: true })
  const file = join(d, `${Math.round(atMs)}-${id.slice(0, 6)}.jpg`)
  const buf = Buffer.from(jpeg)
  writeFileSync(file, buf)
  const slide: Slide = { id, atMs, file, text: '', status: 'reading' }
  m.slides = [...(m.slides ?? []), slide]
  saveMeeting(m)
  emit('slides:changed', { meetingId, slides: m.slides })
  void queue.push(async () => {
    let text = ''
    try {
      text = (
        await chat(
          [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` } },
                { type: 'text', text: 'This is a frame of a screen shared in a meeting. If it shows a presentation slide, document, spreadsheet, chart, diagram, whiteboard or code, transcribe its visible text exactly (keep the original language), then add one line summarising what it shows. If it only shows a video-call grid, faces, an empty desktop or app chrome without meaningful content, reply exactly NONE.' }
              ]
            }
          ],
          { temperature: 0.1, maxTokens: 700 }
        )
      ).trim()
      if (/^NONE.?$/i.test(text)) text = ''
    } catch (e) {
      text = ''
      console.warn('slide read failed', (e as Error).message)
    }
    const fresh = getMeeting(meetingId)
    if (!fresh?.slides) return
    const prev = fresh.slides.filter((s) => s.id !== id && s.status === 'ready').pop()
    if (prev && text && sameText(prev.text, text)) {
      // the same slide again (scroll, cursor, small animation): keep only the first one
      fresh.slides = fresh.slides.filter((s) => s.id !== id)
    } else {
      // frames without content (call grid, desktop) are dropped instead of cluttering the meeting
      fresh.slides = text ? fresh.slides.map((s) => (s.id === id ? { ...s, text, status: 'ready' } : s)) : fresh.slides.filter((s) => s.id !== id)
      if (text) {
        if (isCloudAi()) markCloud(fresh, 'notes')
        const meta: ChunkMeta = { id: uid(), sourceId: slidesSourceId(meetingId), kind: 'image', title: `${fresh.title} · slide ${fmtTime(atMs)}`, path: file, loc: `Slide at ${fmtTime(atMs)}`, label: 'Meetings', text }
        try {
          index.add([meta], await embed([{ text, title: meta.title }], 'doc'))
        } catch {
          /* search index not ready; the slide text is still in the meeting */
        }
      }
    }
    if (!fresh.slides.some((s) => s.id === id)) rmSync(file, { force: true })
    saveMeeting(fresh)
    emit('slides:changed', { meetingId, slides: fresh.slides })
  })
}

export function slideImage(meetingId: string, slideId: string): string | null {
  const s = getMeeting(meetingId)?.slides?.find((x) => x.id === slideId)
  if (!s || !existsSync(s.file)) return null
  return `data:image/jpeg;base64,${readFileSync(s.file).toString('base64')}`
}

export function deleteSlide(meetingId: string, slideId: string): Slide[] {
  const m = getMeeting(meetingId)
  if (!m?.slides) return []
  const s = m.slides.find((x) => x.id === slideId)
  m.slides = m.slides.filter((x) => x.id !== slideId)
  if (s) rmSync(s.file, { force: true })
  if (s) index.removeWhere((c) => c.sourceId === slidesSourceId(meetingId) && c.path === s.file)
  saveMeeting(m)
  return m.slides
}

/** Slide text for the notes prompt */
export const slidesForNotes = (meetingId: string): string =>
  (getMeeting(meetingId)?.slides ?? [])
    .filter((s) => s.status === 'ready' && s.text)
    .map((s) => `[${fmtTime(s.atMs)}] ${s.text.slice(0, 1200)}`)
    .join('\n\n')
