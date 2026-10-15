import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import type { MainEvents } from '../shared/types'

export const uid = (): string => randomUUID()

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function emit<K extends keyof MainEvents>(channel: K, payload: MainEvents[K]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: NodeJS.Timeout | undefined
  return (...a: A) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

/** Serial async queue: run tasks one at a time. */
export class SerialQueue {
  private chain: Promise<unknown> = Promise.resolve()
  pending = 0
  push<T>(task: () => Promise<T>): Promise<T> {
    this.pending++
    const run = this.chain.then(task, task)
    this.chain = run.catch(() => undefined).finally(() => this.pending--)
    return run
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
