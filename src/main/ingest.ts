import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'fs'
import { basename, extname, join } from 'path'
import type { KnowledgeSource, Meeting, SearchHit, SourceType } from '../shared/types'
import { describeImage, embed } from './llm'
import { chunkText, imageMime, isImage, parseBookmarks, parseFile, SUPPORTED_EXT } from './parsers'
import { paths } from './paths'
import { getSettings } from './settings'
import { debounce, emit, readJson, SerialQueue, uid, writeJson } from './util'
import { index, type ChunkMeta, type SearchFilter } from './vectorIndex'

const MAX_FILE_BYTES = 40 * 1024 * 1024
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', '__pycache__', '$recycle.bin', 'appdata'])
const queue = new SerialQueue()
const watchers = new Map<string, FSWatcher>()
let sources: KnowledgeSource[] | null = null

export function getSources(): KnowledgeSource[] {
  if (!sources) sources = readJson<KnowledgeSource[]>(paths.sourcesFile(), [])
  return sources
}

function persist(): void {
  writeJson(paths.sourcesFile(), getSources().map(({ progress: _p, ...s }) => s))
  emit('sources:changed', getSources())
}
const persistSoon = debounce(persist, 300)

function patch(id: string, p: Partial<KnowledgeSource>): void {
  const s = getSources().find((x) => x.id === id)
  if (s) Object.assign(s, p)
  persistSoon()
}

function walk(dir: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name.toLowerCase())) walk(p, out)
    } else if (SUPPORTED_EXT.includes(extname(e.name).toLowerCase())) out.push(p)
  }
  return out
}

async function indexFile(src: KnowledgeSource, file: string, mtime: number): Promise<number> {
  const s = getSettings()
  let sections: { loc?: string; text: string }[] = []
  let title = basename(file)
  let kind: ChunkMeta['kind'] = src.type === 'calendar' ? 'calendar' : src.type === 'bookmarks' ? 'bookmark' : 'file'
  if (isImage(file)) {
    if (!s.indexImages) return 0
    kind = 'image'
    sections = [{ text: await describeImage(readFileSync(file), imageMime(file)) }]
  } else if (src.type === 'bookmarks') {
    sections = parseBookmarks(readFileSync(file, 'utf8'), file)
  } else {
    const parsed = await parseFile(file)
    title = parsed.title
    sections = parsed.sections
    if (extname(file).toLowerCase() === '.ics') kind = 'calendar'
  }
  const metas: ChunkMeta[] = []
  for (const sec of sections) {
    const pieces = kind === 'calendar' || kind === 'bookmark' ? [sec.text.trim()].filter(Boolean) : chunkText(sec.text)
    for (const text of pieces) metas.push({ id: uid(), sourceId: src.id, kind, title, path: file, loc: sec.loc, label: src.label, text, mtime })
  }
  if (!metas.length) return 0
  const vecs = await embed(metas.map((m) => ({ text: m.text, title: m.title })), 'doc')
  index.add(metas, vecs)
  return metas.length
}

async function runIndex(src: KnowledgeSource): Promise<void> {
  if (!getSources().includes(src)) return
  patch(src.id, { status: 'indexing', error: undefined })
  try {
    if (!existsSync(src.path)) throw new Error('Path no longer exists')
    const files = src.type === 'folder' ? walk(src.path) : [src.path]
    const known = index.fileMtimes(src.id)
    const current = new Set(files)
    // drop chunks for deleted files
    index.removeWhere((m) => m.sourceId === src.id && !!m.path && !current.has(m.path))
    const todo: { f: string; mtime: number }[] = []
    for (const f of files) {
      let st
      try {
        st = statSync(f)
      } catch {
        continue
      }
      if (st.size > MAX_FILE_BYTES) continue
      if (known.get(f) === st.mtimeMs) continue
      todo.push({ f, mtime: st.mtimeMs })
    }
    let done = 0
    patch(src.id, { progress: { done, total: todo.length }, fileCount: files.length })
    for (const { f, mtime } of todo) {
      if (!getSources().includes(src)) return
      index.removeWhere((m) => m.sourceId === src.id && m.path === f)
      try {
        await indexFile(src, f, mtime)
      } catch (e) {
        console.warn(`Skipped ${f}: ${(e as Error).message}`)
      }
      done++
      patch(src.id, { progress: { done, total: todo.length }, chunkCount: index.count(src.id) })
    }
    patch(src.id, { status: 'ready', progress: undefined, chunkCount: index.count(src.id), fileCount: files.length })
  } catch (e) {
    patch(src.id, { status: 'error', progress: undefined, error: (e as Error).message })
  }
}

export function reindexSource(id: string): void {
  const src = getSources().find((s) => s.id === id)
  if (!src || src.status === 'indexing') return
  patch(id, { status: 'queued' })
  void queue.push(() => runIndex(src))
}

function startWatch(src: KnowledgeSource): void {
  if (src.type !== 'folder' || watchers.has(src.id) || !existsSync(src.path)) return
  try {
    const trigger = debounce(() => reindexSource(src.id), 4000)
    const w = watch(src.path, { recursive: true }, (_e, name) => {
      if (name && SUPPORTED_EXT.includes(extname(String(name)).toLowerCase())) trigger()
    })
    watchers.set(src.id, w)
  } catch {
    /* watching unsupported on this path */
  }
}

export function addSource(type: SourceType, path: string, label: string): KnowledgeSource {
  const existing = getSources().find((s) => s.path.toLowerCase() === path.toLowerCase())
  if (existing) return existing
  const src: KnowledgeSource = { id: uid(), type, path, label: label || 'General', addedAt: Date.now(), fileCount: 0, chunkCount: 0, status: 'queued' }
  getSources().push(src)
  persist()
  startWatch(src)
  reindexSource(src.id)
  return src
}

export function removeSource(id: string): void {
  sources = getSources().filter((s) => s.id !== id)
  watchers.get(id)?.close()
  watchers.delete(id)
  index.removeWhere((m) => m.sourceId === id)
  persist()
}

export function relabelSource(id: string, label: string): void {
  patch(id, { label })
  index.relabel(id, label)
}

/** Called once the runtime is ready: watch folders and pick up changes made while the app was closed. */
export function resumeIndexing(): void {
  for (const s of getSources()) {
    startWatch(s)
    reindexSource(s.id)
  }
}

export const meetingSourceId = (id: string): string => `meeting:${id}`

export async function indexMeeting(m: Meeting): Promise<void> {
  const sourceId = meetingSourceId(m.id)
  const metas: ChunkMeta[] = []
  const base = { sourceId, kind: 'meeting' as const, title: m.title, label: 'Meetings' }
  let buf = ''
  let startMs = 0
  const flush = (): void => {
    if (buf.trim()) metas.push({ ...base, id: uid(), loc: `Transcript ${fmtTime(startMs)}`, text: buf.trim() })
    buf = ''
  }
  for (const line of m.transcript) {
    if (!buf) startMs = line.startMs
    buf += `${line.speaker}: ${line.text}\n`
    if (buf.length > 1100) flush()
  }
  flush()
  for (const t of chunkText(m.enhanced)) metas.push({ ...base, id: uid(), loc: 'Enhanced notes', text: t })
  if (!m.enhanced) for (const t of chunkText(m.notes)) metas.push({ ...base, id: uid(), loc: 'My notes', text: t })
  if (!metas.length) return
  const vecs = await embed(metas.map((x) => ({ text: x.text, title: x.title })), 'doc')
  index.removeWhere((x) => x.sourceId === sourceId)
  index.add(metas, vecs)
}

export const removeMeetingFromIndex = (id: string): number => index.removeWhere((m) => m.sourceId === meetingSourceId(id))

export async function search(query: string, k = 8, filter: SearchFilter = {}): Promise<SearchHit[]> {
  if (!query.trim()) return []
  const [q] = await embed([{ text: query }], 'query')
  return index.hybridSearch(q, query, k, filter)
}

/** Pure vector search, used for topic detection where keyword overlap is noisy. */
export async function vectorSearch(query: string, k: number, filter: SearchFilter = {}): Promise<SearchHit[]> {
  const [q] = await embed([{ text: query }], 'query')
  return index.search(q, k, filter)
}

export function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// ---------- Remembered answers ----------
// Answers that needed a live Google lookup are kept so later questions can use them without searching again.

export const MEMORY_SOURCE = 'memory'

export async function rememberAnswer(question: string, answer: string, details: string): Promise<void> {
  const when = new Date()
  const text = `Question: ${question}\nAnswer (${when.toLocaleString()}): ${answer.replace(/\[\d+\]/g, '').trim()}${details ? `\nDetails: ${details}` : ''}`
  const metas: ChunkMeta[] = chunkText(text).map((t) => ({
    id: uid(),
    sourceId: MEMORY_SOURCE,
    kind: 'memory' as const,
    title: question.slice(0, 90),
    loc: `Remembered ${when.toLocaleDateString()}`,
    label: 'Memory',
    text: t,
    mtime: when.getTime()
  }))
  if (!metas.length) return
  index.add(metas, await embed(metas.map((m) => ({ text: m.text, title: m.title })), 'doc'))
}

export const memoryCount = (): number => index.count(MEMORY_SOURCE)
export const clearMemory = (): number => index.removeWhere((m) => m.sourceId === MEMORY_SOURCE)
