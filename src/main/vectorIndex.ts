import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import type { ChunkKind, SearchHit } from '../shared/types'
import { paths } from './paths'
import { getSettings } from './settings'
import { debounce, readJson, writeJson } from './util'

export interface ChunkMeta {
  id: string
  sourceId: string
  kind: ChunkKind
  title: string
  path?: string
  loc?: string
  label?: string
  text: string
  mtime?: number
}

export interface SearchFilter {
  labels?: string[]
  kinds?: ChunkKind[]
  sourceIds?: string[]
  excludeSourceIds?: string[]
}

/** Words for Latin-script text, character bigrams for CJK runs (no spaces between words). */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const m of text.toLowerCase().matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[a-z0-9\u00c0-\u024f\u0400-\u04ff\u0900-\u0dff][a-z0-9\u00c0-\u024f\u0400-\u04ff\u0900-\u0dff_.-]*/gu)) {
    const w = m[0]
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(w)) {
      if (w.length === 1) out.push(w)
      for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2))
    } else if (w.length > 1) out.push(w.replace(/[.-]+$/, ''))
  }
  return out
}

class VectorIndex {
  private bm: { tf: Map<string, number>[]; len: number[]; df: Map<string, number>; avg: number } | null = null
  private metas: ChunkMeta[] = []
  private vecs: Float32Array[] = []
  private dims = 768
  private loaded = false

  private files() {
    const d = paths.index()
    return { meta: join(d, 'chunks.json'), vec: join(d, 'vectors.f32'), info: join(d, 'info.json') }
  }

  load(): void {
    if (this.loaded) return
    this.loaded = true
    const f = this.files()
    const info = readJson<{ dims: number }>(f.info, { dims: getSettings().embedDims })
    this.dims = getSettings().embedDims
    if (info.dims !== this.dims || !existsSync(f.vec)) return // dimension changed: start fresh
    this.metas = readJson<ChunkMeta[]>(f.meta, [])
    const buf = readFileSync(f.vec)
    const all = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
    if (all.length !== this.metas.length * this.dims) {
      this.metas = []
      return
    }
    for (let i = 0; i < this.metas.length; i++) this.vecs.push(all.slice(i * this.dims, (i + 1) * this.dims))
  }

  private saveNow = (): void => {
    const f = this.files()
    const flat = new Float32Array(this.vecs.length * this.dims)
    this.vecs.forEach((v, i) => flat.set(v, i * this.dims))
    writeFileSync(`${f.vec}.tmp`, Buffer.from(flat.buffer))
    renameSync(`${f.vec}.tmp`, f.vec)
    writeJson(f.meta, this.metas)
    writeJson(f.info, { dims: this.dims })
  }
  save = debounce(this.saveNow, 1500)

  add(metas: ChunkMeta[], vectors: Float32Array[]): void {
    this.load()
    for (let i = 0; i < metas.length; i++) {
      this.metas.push(metas[i])
      this.vecs.push(vectors[i])
    }
    this.bm = null
    this.save()
  }

  removeWhere(pred: (m: ChunkMeta) => boolean): number {
    this.load()
    const keepM: ChunkMeta[] = []
    const keepV: Float32Array[] = []
    let removed = 0
    this.metas.forEach((m, i) => {
      if (pred(m)) removed++
      else {
        keepM.push(m)
        keepV.push(this.vecs[i])
      }
    })
    this.metas = keepM
    this.vecs = keepV
    if (removed) this.bm = null
    if (removed) this.save()
    return removed
  }

  relabel(sourceId: string, label: string): void {
    this.load()
    this.metas.forEach((m) => {
      if (m.sourceId === sourceId) m.label = label
    })
    this.save()
  }

  fileMtimes(sourceId: string): Map<string, number> {
    this.load()
    const map = new Map<string, number>()
    for (const m of this.metas) if (m.sourceId === sourceId && m.path) map.set(m.path, m.mtime ?? 0)
    return map
  }

  count(sourceId: string): number {
    this.load()
    return this.metas.filter((m) => m.sourceId === sourceId).length
  }

  get(id: string): ChunkMeta | undefined {
    this.load()
    return this.metas.find((m) => m.id === id)
  }

  search(q: Float32Array, k: number, filter: SearchFilter = {}): SearchHit[] {
    this.load()
    const scored: { i: number; s: number }[] = []
    for (let i = 0; i < this.metas.length; i++) {
      const m = this.metas[i]
      if (filter.kinds?.length && !filter.kinds.includes(m.kind)) continue
      if (filter.labels?.length && !(m.label && filter.labels.includes(m.label))) continue
      if (filter.sourceIds?.length && !filter.sourceIds.includes(m.sourceId)) continue
      if (filter.excludeSourceIds?.includes(m.sourceId)) continue
      const v = this.vecs[i]
      let s = 0
      for (let d = 0; d < this.dims; d++) s += v[d] * q[d]
      scored.push({ i, s })
    }
    scored.sort((a, b) => b.s - a.s)
    return scored.slice(0, k).map(({ i, s }) => {
      const m = this.metas[i]
      return { chunkId: m.id, title: m.title, path: m.path, loc: m.loc, text: m.text, kind: m.kind, label: m.label, sourceId: m.sourceId, score: s }
    })
  }

  /** Drop everything (e.g. after the embedding size changes). */
  reset(): void {
    this.metas = []
    this.vecs = []
    this.bm = null
    this.dims = getSettings().embedDims
    this.loaded = true
    this.saveNow()
  }

  private bm25(): NonNullable<VectorIndex['bm']> {
    if (this.bm) return this.bm
    const tf: Map<string, number>[] = []
    const len: number[] = []
    const df = new Map<string, number>()
    for (const m of this.metas) {
      const toks = tokenize(`${m.title} ${m.text}`)
      const map = new Map<string, number>()
      for (const t of toks) map.set(t, (map.get(t) ?? 0) + 1)
      for (const t of map.keys()) df.set(t, (df.get(t) ?? 0) + 1)
      tf.push(map)
      len.push(toks.length)
    }
    const avg = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length)
    this.bm = { tf, len, df, avg }
    return this.bm
  }

  /**
   * Hybrid retrieval: vector similarity + BM25 keyword match, fused with reciprocal rank fusion.
   * Exact names, numbers and codes are found even when embeddings miss them.
   * Each hit keeps its cosine similarity as `score` so callers can apply confidence thresholds.
   */
  hybridSearch(q: Float32Array, text: string, k: number, filter: SearchFilter = {}): SearchHit[] {
    this.load()
    const bm = this.bm25()
    const qt = [...new Set(tokenize(text))]
    const N = this.metas.length
    const vec: { i: number; s: number }[] = []
    const kw: { i: number; s: number }[] = []
    for (let i = 0; i < N; i++) {
      const m = this.metas[i]
      if (filter.kinds?.length && !filter.kinds.includes(m.kind)) continue
      if (filter.labels?.length && !(m.label && filter.labels.includes(m.label))) continue
      if (filter.sourceIds?.length && !filter.sourceIds.includes(m.sourceId)) continue
      if (filter.excludeSourceIds?.includes(m.sourceId)) continue
      const v = this.vecs[i]
      let s = 0
      for (let d = 0; d < this.dims; d++) s += v[d] * q[d]
      vec.push({ i, s })
      let b = 0
      for (const t of qt) {
        const f = bm.tf[i].get(t)
        if (!f) continue
        const idf = Math.log(1 + (N - (bm.df.get(t) ?? 0) + 0.5) / ((bm.df.get(t) ?? 0) + 0.5))
        b += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (bm.len[i] / (bm.avg || 1))))
      }
      if (b > 0) kw.push({ i, s: b })
    }
    vec.sort((a, b) => b.s - a.s)
    kw.sort((a, b) => b.s - a.s)
    const fused = new Map<number, number>()
    const cos = new Map<number, number>()
    vec.slice(0, 60).forEach((h, r) => {
      fused.set(h.i, (fused.get(h.i) ?? 0) + 1 / (60 + r))
      cos.set(h.i, h.s)
    })
    kw.slice(0, 60).forEach((h, r) => fused.set(h.i, (fused.get(h.i) ?? 0) + 1 / (60 + r)))
    for (const { i, s } of vec) if (!cos.has(i)) cos.set(i, s)
    return [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([i]) => {
        const m = this.metas[i]
        return { chunkId: m.id, title: m.title, path: m.path, loc: m.loc, text: m.text, kind: m.kind, label: m.label, sourceId: m.sourceId, score: cos.get(i) ?? 0 }
      })
  }

  flush(): void {
    if (this.loaded) this.saveNow()
  }
}

export const index = new VectorIndex()
