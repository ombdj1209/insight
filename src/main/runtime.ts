import { spawn, type ChildProcess } from 'child_process'
import { createWriteStream, existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import type { RuntimeStatus } from '../shared/types'
import { languageCode } from '../shared/languages'
import { ENGINE_LABELS, needsLocalLlm, resolveAsrEngine } from '../shared/engines'
import { manifest } from './downloader'
import { paths } from './paths'
import { getSettings } from './settings'
import { emit, sleep } from './util'

type Kind = 'llm' | 'embedder' | 'whisper'
export const PORTS: Record<Kind, number> = { llm: 47811, embedder: 47812, whisper: 47813 }
export const baseUrl = (k: Kind): string => `http://127.0.0.1:${PORTS[k]}`

const procs: Partial<Record<Kind, ChildProcess>> = {}
const status: RuntimeStatus = { llm: 'stopped', embedder: 'stopped', whisper: 'stopped', asr: '' }
let starting: Promise<void> | null = null

export const runtimeStatus = (): RuntimeStatus => ({ ...status, asr: ENGINE_LABELS[resolveAsrEngine(getSettings())] })
const push = (): void => emit('runtime:changed', runtimeStatus())
function set(k: Kind, v: RuntimeStatus[Kind], message?: string): void {
  ;(status as unknown as Record<Kind, string>)[k] = v
  if (message !== undefined) status.message = message
  push()
}

function logTail(kind: Kind): string {
  try {
    return readFileSync(join(paths.logs(), `${kind}.log`), 'utf8').slice(-1200)
  } catch {
    return ''
  }
}

function launch(kind: Kind, exe: string, args: string[]): ChildProcess {
  const log = createWriteStream(join(paths.logs(), `${kind}.log`), { flags: 'w' })
  log.write(`> ${exe} ${args.join(' ')}\n`)
  const child = spawn(exe, args, { cwd: dirname(exe), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)
  child.on('exit', (code) => {
    if (procs[kind] === child) {
      delete procs[kind]
      set(kind, 'error', `${kind} server exited (code ${code}). See logs\\${kind}.log`)
    }
  })
  procs[kind] = child
  return child
}

async function waitReady(kind: Kind, path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!procs[kind]) throw new Error(`${kind} server failed to start.\n${logTail(kind)}`)
    try {
      const r = await fetch(baseUrl(kind) + path)
      if (r.status === 200) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error(`${kind} server did not become ready in time.\n${logTail(kind)}`)
}

const gpuArgs = (): string[] => {
  const s = getSettings()
  return s.gpuBackend === 'cpu' ? [] : ['-ngl', String(s.gpuLayers)]
}

async function startLlm(): Promise<void> {
  const m = manifest()
  const s = getSettings()
  if (!m.llamaRuntime || !m.llm || !existsSync(m.llm.file)) throw new Error('Gemma 4 is not installed. Open Setup.')
  set('llm', 'starting')
  const args = [
    '-m', m.llm.file,
    ...(m.llm.mmproj && existsSync(m.llm.mmproj) ? ['--mmproj', m.llm.mmproj] : []),
    '--host', '127.0.0.1', '--port', String(PORTS.llm),
    '-c', String(s.contextSize), '-np', '2', '--jinja',
    ...gpuArgs(),
    ...s.extraLlamaArgs.split(/\s+/).filter(Boolean)
  ]
  launch('llm', m.llamaRuntime.exe, args)
  await waitReady('llm', '/health', 300_000)
  set('llm', 'ready')
}

async function startEmbedder(): Promise<void> {
  const m = manifest()
  if (!m.llamaRuntime || !m.embedder || !existsSync(m.embedder.file)) throw new Error('EmbeddingGemma 2 is not installed. Open Setup.')
  set('embedder', 'starting')
  const args = [
    '-m', m.embedder.file, '--embedding',
    '--host', '127.0.0.1', '--port', String(PORTS.embedder),
    '-c', '4096', '-b', '4096', '-ub', '4096', '-np', '1',
    ...gpuArgs()
  ]
  launch('embedder', m.llamaRuntime.exe, args)
  await waitReady('embedder', '/health', 120_000)
  set('embedder', 'ready')
}

async function startWhisper(): Promise<void> {
  const m = manifest()
  const s = getSettings()
  if (!m.whisperRuntime || !m.whisperModel) throw new Error('whisper.cpp is not installed. Open Setup.')
  set('whisper', 'starting')
  const code = languageCode(s.language)
  const args = ['-m', m.whisperModel.file, '--host', '127.0.0.1', '--port', String(PORTS.whisper), '-l', code || 'auto', '-t', String(Math.max(2, s.sherpaThreads))]
  launch('whisper', m.whisperRuntime.exe, args)
  await waitReady('whisper', '/', 120_000)
  set('whisper', 'ready')
}

/** Start every server the current settings need. Safe to call repeatedly. */
export function ensureRuntime(): Promise<void> {
  if (starting) return starting
  starting = (async () => {
    const s = getSettings()
    try {
      if (!procs.embedder) await startEmbedder()
      if (needsLocalLlm(s)) {
        if (!procs.llm) await startLlm()
      } else {
        procs.llm?.kill()
        delete procs.llm
        status.llm = 'cloud'
      }
      if (resolveAsrEngine(s) === 'whisper' && !procs.whisper) await startWhisper()
      status.message = undefined
      push()
    } catch (e) {
      status.message = (e as Error).message
      for (const k of ['llm', 'embedder', 'whisper'] as Kind[]) if (status[k] === 'starting') (status as unknown as Record<Kind, string>)[k] = 'error'
      push()
      throw e
    } finally {
      starting = null
    }
  })()
  return starting
}

export async function stopRuntime(): Promise<void> {
  for (const k of Object.keys(procs) as Kind[]) {
    const c = procs[k]
    delete procs[k]
    c?.kill()
    ;(status as unknown as Record<Kind, string>)[k] = 'stopped'
  }
  push()
  await sleep(800)
}

export async function restartRuntime(): Promise<void> {
  await stopRuntime()
  await ensureRuntime()
}

export const isReady = (k: Kind): boolean => status[k] === 'ready'
