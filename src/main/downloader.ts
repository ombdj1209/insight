import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { join, basename } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import extractZip from 'extract-zip'
import catalog from '../shared/catalog.json'
import type { ComponentId, ComponentStatus, GpuBackend, SherpaModel } from '../shared/types'
import { needsLocalLlm, resolveAsrEngine } from '../shared/engines'
import { paths } from './paths'
import { getSettings } from './settings'
import { emit, readJson, writeJson } from './util'

interface Manifest {
  llamaRuntime?: { exe: string; backend: GpuBackend; tag: string }
  llm?: { modelId: string; file: string; mmproj?: string }
  embedder?: { file: string }
  whisperRuntime?: { exe: string; tag: string }
  whisperModel?: { name: string; file: string }
  sherpa?: Partial<Record<SherpaModel, string>>
  speaker?: { file: string }
}

const UA = { 'User-Agent': 'insight-windows' }
const active = new Map<ComponentId, { received: number; total: number; file: string }>()
const errors = new Map<ComponentId, string>()

export const manifest = (): Manifest => readJson<Manifest>(paths.manifestFile(), {})
const saveManifest = (m: Manifest): void => writeJson(paths.manifestFile(), m)
const exists = (p?: string): boolean => !!p && existsSync(p)

export function componentStatus(): ComponentStatus[] {
  const m = manifest()
  const s = getSettings()
  const llmDef = (catalog.llm as Record<string, { label: string }>)[s.llmModel]
  const asr = resolveAsrEngine(s)
  const sherpaDefs = catalog.sherpa as Record<SherpaModel, { label: string; size: string }>
  const sherpaRow = (id: SherpaModel): ComponentStatus => ({
    id,
    name: sherpaDefs[id].label,
    description: 'Fast local speech recognition (sherpa-onnx, CPU)',
    installed: exists(m.sherpa?.[id]),
    required: asr === id,
    sizeHint: sherpaDefs[id].size
  })
  const list: ComponentStatus[] = [
    {
      id: 'llamaRuntime',
      name: `llama.cpp runtime (${s.gpuBackend.toUpperCase()})`,
      description: 'Local inference server for EmbeddingGemma 2 (and Gemma 4 when used locally)',
      installed: exists(m.llamaRuntime?.exe) && m.llamaRuntime?.backend === s.gpuBackend,
      required: true,
      sizeHint: s.gpuBackend === 'cuda' ? '~600 MB' : '~60 MB'
    },
    {
      id: 'embedder',
      name: catalog.embedder.label,
      description: 'Semantic search across your files and meetings. Runs fine on CPU.',
      installed: exists(m.embedder?.file),
      required: true,
      sizeHint: '~0.8 GB'
    },
    sherpaRow('sensevoice'),
    sherpaRow('parakeet'),
    sherpaRow('reazonspeech'),
    {
      id: 'speaker',
      name: catalog.speaker.label,
      description: 'Tells speakers apart so "Others" becomes Speaker 1, 2, 3',
      installed: exists(m.speaker?.file),
      required: s.diarization,
      sizeHint: catalog.speaker.size
    },
    {
      id: 'llm',
      name: llmDef?.label ?? s.llmModel,
      description: 'Local notes, chat, Live Assistance and Gemma audio transcription',
      installed: exists(m.llm?.file) && m.llm?.modelId === s.llmModel && (asr !== 'gemma' || exists(m.llm?.mmproj)),
      required: needsLocalLlm(s),
      sizeHint: s.llmModel === 'gemma-4-E4B' ? '~8.5 GB' : s.llmModel === 'gemma-4-E4B-Q4' ? '~5.5 GB' : '~5 GB'
    },
    {
      id: 'whisperRuntime',
      name: 'whisper.cpp runtime',
      description: 'Whisper engine for languages the fast models do not cover',
      installed: exists(m.whisperRuntime?.exe),
      required: asr === 'whisper',
      sizeHint: '~50-500 MB'
    },
    {
      id: 'whisperModel',
      name: `Whisper ${s.whisperModel}`,
      description: '99 languages; best with a GPU',
      installed: exists(m.whisperModel?.file) && m.whisperModel?.name === s.whisperModel,
      required: asr === 'whisper',
      sizeHint: s.whisperModel === 'base' ? '~150 MB' : '~550 MB'
    }
  ]
  return list.map((c) => ({ ...c, downloading: active.get(c.id), error: errors.get(c.id) }))
}

const broadcast = (): void => emit('components:changed', componentStatus())

// ---------- remote resolution ----------

async function hfFiles(repo: string): Promise<string[]> {
  const token = getSettings().hfToken
  const res = await fetch(`https://huggingface.co/api/models/${repo}`, {
    headers: { ...UA, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  })
  if (!res.ok) throw new Error(`Hugging Face lookup failed for ${repo} (HTTP ${res.status})`)
  const json = (await res.json()) as { siblings?: { rfilename: string }[] }
  return (json.siblings ?? []).map((s) => s.rfilename)
}

function pickGguf(files: string[], quants: string[]): string {
  const ggufs = files.filter((f) => f.toLowerCase().endsWith('.gguf') && !f.toLowerCase().includes('mmproj'))
  for (const q of quants) {
    const hit = ggufs.find((f) => f.toLowerCase().includes(q.toLowerCase()))
    if (hit) return hit
  }
  if (ggufs[0]) return ggufs[0]
  throw new Error('No GGUF file found in repository')
}

function pickMmproj(files: string[]): string | undefined {
  const mm = files.filter((f) => f.toLowerCase().includes('mmproj') && f.endsWith('.gguf'))
  for (const p of catalog.mmprojPreference) {
    const hit = mm.find((f) => f.toLowerCase().includes(p))
    if (hit) return hit
  }
  return mm[0]
}

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
}

async function ghLatest(repo: string): Promise<{ tag: string; assets: GhAsset[] }> {
  const token = process.env.GITHUB_TOKEN
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { ...UA, Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  })
  if (!res.ok) throw new Error(`GitHub release lookup failed for ${repo} (HTTP ${res.status})`)
  const j = (await res.json()) as { tag_name: string; assets: GhAsset[] }
  return { tag: j.tag_name, assets: j.assets }
}

function cudaVersion(name: string): number[] {
  const m = name.match(/cuda-(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2])] : [0, 0]
}

/** Pick llama.cpp Windows assets. CUDA prefers 12.x (widest driver support) and pairs the matching cudart. */
export function pickLlamaAssets(assets: GhAsset[], backend: GpuBackend): GhAsset[] {
  if (backend === 'cuda') {
    const builds = assets.filter((a) => /bin-win-cuda-[\d.]+-x64\.zip$/.test(a.name))
    builds.sort((a, b) => {
      const [am, an] = cudaVersion(a.name)
      const [bm, bn] = cudaVersion(b.name)
      const pa = am === 12 ? 1000 + an : am * 10 + an
      const pb = bm === 12 ? 1000 + bn : bm * 10 + bn
      return pb - pa
    })
    const build = builds[0]
    if (!build) throw new Error('No CUDA build in the latest llama.cpp release. Choose Vulkan or CPU in Settings.')
    const ver = cudaVersion(build.name).join('.')
    const cudart = assets.find((a) => a.name.startsWith('cudart-') && a.name.includes(`cuda-${ver}`) && a.name.endsWith('x64.zip'))
    return cudart ? [build, cudart] : [build]
  }
  const re = backend === 'vulkan' ? /bin-win-vulkan-x64\.zip$/ : /bin-win-cpu-x64\.zip$/
  const hit = assets.find((a) => re.test(a.name)) ?? assets.find((a) => /bin-win-(avx2|noavx)-x64\.zip$/.test(a.name))
  if (!hit) throw new Error(`No ${backend} Windows build found in the latest llama.cpp release`)
  return [hit]
}

function pickWhisperAsset(assets: GhAsset[], backend: GpuBackend): GhAsset {
  const cuda = assets.find((a) => /^whisper-cublas-12[\d.]*-bin-x64\.zip$/.test(a.name))
  const cpu = assets.find((a) => /^whisper-bin-x64\.zip$/.test(a.name))
  const hit = backend === 'cuda' ? cuda ?? cpu : cpu
  if (!hit) throw new Error('No Windows build found in the latest whisper.cpp release')
  return hit
}

function findFile(root: string, names: string[]): string | undefined {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name)
    if (entry.isDirectory()) {
      const r = findFile(p, names)
      if (r) return r
    } else if (names.includes(entry.name.toLowerCase())) return p
  }
  return undefined
}

function extractTar(archive: string, dest: string): Promise<void> {
  // tar.exe ships with Windows 10 1803+ and reads .tar.bz2
  return new Promise((resolve, reject) => {
    const p = spawn('tar', ['-xjf', archive, '-C', dest], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += String(d)))
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Extracting ${basename(archive)} failed: ${err.slice(0, 300)}`))))
  })
}

// ---------- download ----------

async function download(id: ComponentId, url: string, dest: string, auth = false): Promise<void> {
  if (existsSync(dest)) return
  mkdirSync(join(dest, '..'), { recursive: true })
  const part = `${dest}.part`
  let start = existsSync(part) ? statSync(part).size : 0
  const token = getSettings().hfToken
  const res = await fetch(url, {
    headers: {
      ...UA,
      ...(start ? { Range: `bytes=${start}-` } : {}),
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {})
    },
    redirect: 'follow'
  })
  if (res.status === 416) {
    renameSync(part, dest)
    return
  }
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}) for ${basename(dest)}`)
  if (res.status === 200) start = 0
  const total = start + Number(res.headers.get('content-length') ?? 0)
  const state = { received: start, total, file: basename(dest) }
  active.set(id, state)
  let lastEmit = 0
  const progress = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      state.received += chunk.length
      const now = Date.now()
      if (now - lastEmit > 250) {
        lastEmit = now
        broadcast()
      }
      cb(null, chunk)
    }
  })
  await pipeline(
    Readable.fromWeb(res.body as import('stream/web').ReadableStream),
    progress,
    createWriteStream(part, { flags: start ? 'a' : 'w' })
  )
  renameSync(part, dest)
}

async function installComponent(id: ComponentId): Promise<void> {
  const s = getSettings()
  const m = manifest()
  const models = paths.models()
  const hfUrl = (repo: string, file: string): string => `https://huggingface.co/${repo}/resolve/main/${file}`

  switch (id) {
    case 'llamaRuntime': {
      const rel = await ghLatest(catalog.llamaRepo)
      const assets = pickLlamaAssets(rel.assets, s.gpuBackend)
      const target = join(paths.runtime(), `llama-${s.gpuBackend}`)
      rmSync(target, { recursive: true, force: true })
      mkdirSync(target, { recursive: true })
      for (const a of assets) {
        const zip = join(paths.runtime(), a.name)
        await download(id, a.browser_download_url, zip)
        await extractZip(zip, { dir: target })
        rmSync(zip, { force: true })
      }
      const exe = findFile(target, ['llama-server.exe', 'llama-server'])
      if (!exe) throw new Error('llama-server.exe not found in the downloaded archive')
      m.llamaRuntime = { exe, backend: s.gpuBackend, tag: rel.tag }
      break
    }
    case 'llm': {
      const def = (catalog.llm as Record<string, { repo: string; quant: string[] }>)[s.llmModel]
      const files = await hfFiles(def.repo)
      const file = pickGguf(files, def.quant)
      const mmproj = pickMmproj(files)
      const dir = join(models, def.repo.replace('/', '__'))
      await download(id, hfUrl(def.repo, file), join(dir, basename(file)), true)
      if (mmproj) await download(id, hfUrl(def.repo, mmproj), join(dir, basename(mmproj)), true)
      m.llm = { modelId: s.llmModel, file: join(dir, basename(file)), mmproj: mmproj ? join(dir, basename(mmproj)) : undefined }
      break
    }
    case 'embedder': {
      const def = catalog.embedder
      const files = await hfFiles(def.repo)
      const file = pickGguf(files, def.quant)
      const dir = join(models, def.repo.replace('/', '__'))
      await download(id, hfUrl(def.repo, file), join(dir, basename(file)), true)
      m.embedder = { file: join(dir, basename(file)) }
      break
    }
    case 'whisperRuntime': {
      const rel = await ghLatest(catalog.whisperRepo)
      const asset = pickWhisperAsset(rel.assets, s.gpuBackend)
      const target = join(paths.runtime(), 'whisper')
      rmSync(target, { recursive: true, force: true })
      mkdirSync(target, { recursive: true })
      const zip = join(paths.runtime(), asset.name)
      await download(id, asset.browser_download_url, zip)
      await extractZip(zip, { dir: target })
      rmSync(zip, { force: true })
      const exe = findFile(target, ['whisper-server.exe', 'server.exe', 'whisper-server'])
      if (!exe) throw new Error('whisper-server.exe not found in the downloaded archive')
      m.whisperRuntime = { exe, tag: rel.tag }
      break
    }
    case 'sensevoice':
    case 'parakeet':
    case 'reazonspeech': {
      const def = (catalog.sherpa as Record<SherpaModel, { url: string }>)[id]
      const root = join(models, 'sherpa')
      mkdirSync(root, { recursive: true })
      const archive = join(root, basename(def.url))
      const dirName = basename(def.url).replace(/\.tar\.bz2$/, '')
      const target = join(root, dirName)
      if (!existsSync(target)) {
        await download(id, def.url, archive)
        active.set(id, { received: 0, total: 0, file: 'extracting...' })
        broadcast()
        await extractTar(archive, root)
        rmSync(archive, { force: true })
      }
      if (!existsSync(target)) throw new Error(`Expected folder ${dirName} after extraction`)
      m.sherpa = { ...(m.sherpa ?? {}), [id]: target }
      break
    }
    case 'speaker': {
      const dest = join(models, 'sherpa', basename(catalog.speaker.url))
      await download(id, catalog.speaker.url, dest)
      m.speaker = { file: dest }
      break
    }
    case 'whisperModel': {
      const file = (catalog.whisper.models as Record<string, string>)[s.whisperModel]
      const dest = join(models, 'whisper', file)
      await download(id, hfUrl(catalog.whisper.repo, file), dest)
      m.whisperModel = { name: s.whisperModel, file: dest }
      break
    }
  }
  saveManifest(m)
}

export async function installComponents(ids?: ComponentId[]): Promise<void> {
  const targets = ids ?? componentStatus().filter((c) => c.required && !c.installed).map((c) => c.id)
  for (const id of targets) {
    errors.delete(id)
    try {
      active.set(id, { received: 0, total: 0, file: 'resolving...' })
      broadcast()
      await installComponent(id)
    } catch (e) {
      errors.set(id, (e as Error).message)
    } finally {
      active.delete(id)
      broadcast()
    }
  }
}
