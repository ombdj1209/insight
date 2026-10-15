#!/usr/bin/env node
// Downloads llama.cpp, Gemma 4, EmbeddingGemma 2 (and optionally whisper.cpp) into the same
// folder and manifest format the app's Setup screen uses. Safe to re-run: finished files are
// skipped and partial downloads resume.
//
// Usage:
//   node scripts/setup-models.mjs [--backend cuda|vulkan|cpu] [--model gemma-4-E4B|gemma-4-E4B-Q4|gemma-4-E2B]
//                                 [--asr sensevoice,parakeet,reazonspeech] [--speaker] [--no-llm]
//                                 [--whisper large-v3-turbo|base] [--update] [--check]
//   --asr      local speech engines to install (comma list; default sensevoice)
//   --speaker  voice model for speaker labels
//   --no-llm   skip Gemma 4 (Light / Cloud presets use a cloud AI provider)
//   --update  re-download the llama.cpp / whisper.cpp runtime even if present (picks up the newest release)
//   --check   only print what is installed
// Env: INSIGHT_HOME (data folder override), HF_TOKEN, GITHUB_TOKEN

import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import extractZip from 'extract-zip'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const catalog = JSON.parse(readFileSync(join(root, 'src/shared/catalog.json'), 'utf8'))

const args = process.argv.slice(2)
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const flag = (name) => args.includes(`--${name}`)

// installs from before the rename still live in ...\Foresight until the app moves them on its next start
const legacyHome = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Foresight')
const HOME =
  process.env.INSIGHT_HOME ||
  (process.env.LOCALAPPDATA
    ? !existsSync(join(process.env.LOCALAPPDATA, 'Insight')) && existsSync(legacyHome)
      ? legacyHome
      : join(process.env.LOCALAPPDATA, 'Insight')
    : join(process.env.HOME || '.', '.insight'))
const MODELS = join(HOME, 'models')
const RUNTIME = join(HOME, 'runtime')
const MANIFEST = join(MODELS, 'manifest.json')
const SETTINGS = join(HOME, 'settings.json')
for (const d of [HOME, MODELS, RUNTIME]) mkdirSync(d, { recursive: true })

const readJson = (f, fb) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return fb
  }
}
const settings = readJson(SETTINGS, {})
const backend = arg('backend', settings.gpuBackend || 'cuda')
const modelId = arg('model', settings.llmModel || 'gemma-4-E4B')
const whisperName = arg('whisper', null)
const asrList = arg('asr', 'sensevoice').split(',').map((x) => x.trim()).filter(Boolean)
const wantSpeaker = flag('speaker')
const skipLlm = flag('no-llm')
const manifest = readJson(MANIFEST, {})
const UA = { 'User-Agent': 'insight-windows-setup' }
const hfToken = process.env.HF_TOKEN || settings.hfToken || ''

if (!catalog.llm[modelId]) {
  console.error(`Unknown model "${modelId}". Choose one of: ${Object.keys(catalog.llm).join(', ')}`)
  process.exit(1)
}
if (!['cuda', 'vulkan', 'cpu'].includes(backend)) {
  console.error('--backend must be cuda, vulkan or cpu')
  process.exit(1)
}

if (flag('check')) {
  const ok = (p) => (p && existsSync(p) ? 'OK     ' : 'MISSING')
  console.log(`Data folder: ${HOME}`)
  console.log(`${ok(manifest.llamaRuntime?.exe)} llama.cpp runtime  ${manifest.llamaRuntime?.backend ?? ''} ${manifest.llamaRuntime?.tag ?? ''}`)
  console.log(`${ok(manifest.llm?.file)} LLM               ${manifest.llm?.modelId ?? ''} ${manifest.llm?.file ?? ''}`)
  console.log(`${ok(manifest.llm?.mmproj)} LLM mmproj        ${manifest.llm?.mmproj ?? ''}`)
  console.log(`${ok(manifest.embedder?.file)} Embedder          ${manifest.embedder?.file ?? ''}`)
  for (const k of Object.keys(catalog.sherpa)) console.log(`${ok(manifest.sherpa?.[k])} ${k.padEnd(18)}${catalog.sherpa[k].label}`)
  console.log(`${ok(manifest.speaker?.file)} Speaker model     ${manifest.speaker?.file ?? '(optional)'}`)
  console.log(`${ok(manifest.whisperRuntime?.exe)} whisper.cpp       ${manifest.whisperRuntime?.tag ?? '(optional)'}`)
  console.log(`${ok(manifest.whisperModel?.file)} Whisper model     ${manifest.whisperModel?.name ?? '(optional)'}`)
  process.exit(0)
}

const fmt = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(0)} MB`)

async function download(url, dest, auth = false) {
  if (existsSync(dest)) {
    console.log(`  ✓ ${basename(dest)} already present`)
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  let start = existsSync(part) ? statSync(part).size : 0
  const res = await fetch(url, {
    headers: { ...UA, ...(start ? { Range: `bytes=${start}-` } : {}), ...(auth && hfToken ? { Authorization: `Bearer ${hfToken}` } : {}) },
    redirect: 'follow'
  })
  if (res.status === 416) {
    renameSync(part, dest)
    return
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  if (res.status === 200) start = 0
  const total = start + Number(res.headers.get('content-length') || 0)
  let received = start
  let last = 0
  const progress = new Transform({
    transform(chunk, _e, cb) {
      received += chunk.length
      if (Date.now() - last > 500) {
        last = Date.now()
        const pct = total ? ((received / total) * 100).toFixed(1) : '?'
        process.stdout.write(`\r  ↓ ${basename(dest)}  ${fmt(received)} / ${total ? fmt(total) : '?'}  (${pct}%)   `)
      }
      cb(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(res.body), progress, createWriteStream(part, { flags: start ? 'a' : 'w' }))
  process.stdout.write('\n')
  renameSync(part, dest)
}

async function hfFiles(repo) {
  const res = await fetch(`https://huggingface.co/api/models/${repo}`, { headers: { ...UA, ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}) } })
  if (!res.ok) throw new Error(`Hugging Face lookup failed for ${repo} (HTTP ${res.status})`)
  return ((await res.json()).siblings || []).map((s) => s.rfilename)
}

function pickGguf(files, quants) {
  const ggufs = files.filter((f) => f.toLowerCase().endsWith('.gguf') && !f.toLowerCase().includes('mmproj'))
  for (const q of quants) {
    const hit = ggufs.find((f) => f.toLowerCase().includes(q.toLowerCase()))
    if (hit) return hit
  }
  if (ggufs[0]) return ggufs[0]
  throw new Error('No GGUF file found')
}

function pickMmproj(files) {
  const mm = files.filter((f) => f.toLowerCase().includes('mmproj') && f.endsWith('.gguf'))
  for (const p of catalog.mmprojPreference) {
    const hit = mm.find((f) => f.toLowerCase().includes(p))
    if (hit) return hit
  }
  return mm[0]
}

async function ghLatest(repo) {
  const t = process.env.GITHUB_TOKEN
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { ...UA, Accept: 'application/vnd.github+json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
  })
  if (!res.ok) throw new Error(`GitHub lookup failed for ${repo} (HTTP ${res.status}). Set GITHUB_TOKEN if rate limited.`)
  const rel = await res.json()
  if (rel.assets?.some((a) => /win/.test(a.name))) return rel
  // ponytail: 'latest' can be a stub release without binaries; fall back to the newest release that has Windows assets
  const list = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=15`, {
    headers: { ...UA, Accept: 'application/vnd.github+json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
  })
  const hit = list.ok ? (await list.json()).find((r) => r.assets?.some((a) => /win/.test(a.name))) : null
  return hit || rel
}

const cudaVer = (n) => (n.match(/cuda-(\d+)\.(\d+)/) || [0, 0, 0]).slice(1).map(Number)

function pickLlamaAssets(assets) {
  if (backend === 'cuda') {
    const builds = assets.filter((a) => /bin-win-cuda-[\d.]+-x64\.zip$/.test(a.name))
    const prio = (n) => {
      const [m, k] = cudaVer(n)
      return m === 12 ? 1000 + k : m * 10 + k
    }
    builds.sort((a, b) => prio(b.name) - prio(a.name))
    if (!builds[0]) throw new Error('No CUDA build in the latest llama.cpp release; use --backend vulkan or cpu')
    const v = cudaVer(builds[0].name).join('.')
    const cudart = assets.find((a) => a.name.startsWith('cudart-') && a.name.includes(`cuda-${v}`) && a.name.endsWith('x64.zip'))
    return cudart ? [builds[0], cudart] : [builds[0]]
  }
  const re = backend === 'vulkan' ? /bin-win-vulkan-x64\.zip$/ : /bin-win-cpu-x64\.zip$/
  const hit = assets.find((a) => re.test(a.name))
  if (!hit) throw new Error(`No ${backend} Windows build in the latest llama.cpp release`)
  return [hit]
}

function findFile(dir, names) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const r = findFile(p, names)
      if (r) return r
    } else if (names.includes(e.name.toLowerCase())) return p
  }
}

const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
const hfUrl = (repo, f) => `https://huggingface.co/${repo}/resolve/main/${f}`

async function main() {
  console.log(`Insight setup → ${HOME}\nBackend: ${backend}   Model: ${modelId}${whisperName ? `   Whisper: ${whisperName}` : ''}\n`)

  // 1. llama.cpp runtime
  if (flag('update') || !manifest.llamaRuntime || !existsSync(manifest.llamaRuntime.exe) || manifest.llamaRuntime.backend !== backend) {
    console.log('• llama.cpp runtime')
    const rel = await ghLatest(catalog.llamaRepo)
    const target = join(RUNTIME, `llama-${backend}`)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    for (const a of pickLlamaAssets(rel.assets)) {
      const zip = join(RUNTIME, a.name)
      await download(a.browser_download_url, zip)
      await extractZip(zip, { dir: target })
      rmSync(zip, { force: true })
    }
    const exe = findFile(target, ['llama-server.exe', 'llama-server'])
    if (!exe) throw new Error('llama-server.exe not found in archive')
    manifest.llamaRuntime = { exe, backend, tag: rel.tag_name }
    save()
    console.log(`  ✓ ${rel.tag_name}`)
  } else console.log(`• llama.cpp runtime ✓ ${manifest.llamaRuntime.tag}`)

  // 2. Gemma 4
  if (!skipLlm) {
    console.log(`• ${catalog.llm[modelId].label}`)
    const def = catalog.llm[modelId]
    const files = await hfFiles(def.repo)
    const file = pickGguf(files, def.quant)
    const mm = pickMmproj(files)
    const dir = join(MODELS, def.repo.replace('/', '__'))
    await download(hfUrl(def.repo, file), join(dir, basename(file)), true)
    if (mm) await download(hfUrl(def.repo, mm), join(dir, basename(mm)), true)
    else console.warn('  ! no mmproj file found: Gemma audio transcription will not work, use --whisper')
    manifest.llm = { modelId, file: join(dir, basename(file)), mmproj: mm ? join(dir, basename(mm)) : undefined }
    save()
  }

  // 2b. sherpa-onnx speech engines (tar.exe ships with Windows 10 1803+)
  for (const id of asrList) {
    const def = catalog.sherpa[id]
    if (!def) throw new Error(`Unknown --asr engine ${id}. Choose from ${Object.keys(catalog.sherpa).join(', ')}`)
    console.log(`• ${def.label}`)
    const root = join(MODELS, 'sherpa')
    mkdirSync(root, { recursive: true })
    const name = basename(def.url).replace(/\.tar\.bz2$/, '')
    const target = join(root, name)
    if (!existsSync(target)) {
      const archive = join(root, basename(def.url))
      await download(def.url, archive)
      const { spawnSync } = await import('node:child_process')
      const r = spawnSync(process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar', ['-xjf', archive, '-C', root], { stdio: 'inherit' })
      if (r.status !== 0) throw new Error(`Could not extract ${archive}`)
      rmSync(archive, { force: true })
    } else console.log(`  ✓ ${name} already present`)
    manifest.sherpa = { ...(manifest.sherpa || {}), [id]: target }
    save()
  }
  if (wantSpeaker) {
    console.log(`• ${catalog.speaker.label}`)
    const dest = join(MODELS, 'sherpa', basename(catalog.speaker.url))
    await download(catalog.speaker.url, dest)
    manifest.speaker = { file: dest }
    save()
  }

  // 3. EmbeddingGemma 2
  console.log(`• ${catalog.embedder.label}`)
  {
    const def = catalog.embedder
    const file = pickGguf(await hfFiles(def.repo), def.quant)
    const dir = join(MODELS, def.repo.replace('/', '__'))
    await download(hfUrl(def.repo, file), join(dir, basename(file)), true)
    manifest.embedder = { file: join(dir, basename(file)) }
    save()
  }

  // 4. Optional Whisper fallback
  if (whisperName) {
    const wfile = catalog.whisper.models[whisperName]
    if (!wfile) throw new Error(`Unknown whisper model ${whisperName}`)
    if (flag('update') || !manifest.whisperRuntime || !existsSync(manifest.whisperRuntime.exe)) {
      console.log('• whisper.cpp runtime')
      const rel = await ghLatest(catalog.whisperRepo)
      const cuda = rel.assets.find((a) => /^whisper-cublas-12[\d.]*-bin-x64\.zip$/.test(a.name))
      const cpu = rel.assets.find((a) => /^whisper-bin-x64\.zip$/.test(a.name))
      const asset = backend === 'cuda' ? cuda || cpu : cpu
      if (!asset) throw new Error('No whisper.cpp Windows build found')
      const target = join(RUNTIME, 'whisper')
      rmSync(target, { recursive: true, force: true })
      mkdirSync(target, { recursive: true })
      const zip = join(RUNTIME, asset.name)
      await download(asset.browser_download_url, zip)
      await extractZip(zip, { dir: target })
      rmSync(zip, { force: true })
      const exe = findFile(target, ['whisper-server.exe', 'server.exe', 'whisper-server'])
      if (!exe) throw new Error('whisper-server.exe not found in archive')
      manifest.whisperRuntime = { exe, tag: rel.tag_name }
      save()
    }
    console.log(`• Whisper ${whisperName}`)
    const dest = join(MODELS, 'whisper', wfile)
    await download(hfUrl(catalog.whisper.repo, wfile), dest)
    manifest.whisperModel = { name: whisperName, file: dest }
    save()
  }

  // keep the app's settings in line with what was installed
  writeFileSync(
    SETTINGS,
    JSON.stringify({ ...settings, gpuBackend: backend, llmModel: modelId, ...(whisperName ? { whisperModel: whisperName } : {}) }, null, 2)
  )
  console.log(`\nDone. Manifest: ${MANIFEST}\nStart the app with "npm run dev" (or the installed Insight).`)
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
