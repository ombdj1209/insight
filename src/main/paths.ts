import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'

let home: string | null = null

/** Root for models, runtimes and data. Override with INSIGHT_HOME. Defaults to %LOCALAPPDATA%\Insight. */
export function homeDir(): string {
  home ??=
    process.env.INSIGHT_HOME ||
    (process.env.LOCALAPPDATA ? migrated(join(process.env.LOCALAPPDATA, 'Foresight'), join(process.env.LOCALAPPDATA, 'Insight'), true) : join(app.getPath('userData'), 'data'))
  mkdirSync(home, { recursive: true })
  return home
}

/** Electron profile (window state, encryption key for saved API keys). Override with INSIGHT_USER_DATA. */
export const userDataDir = (): string => process.env.INSIGHT_USER_DATA || migrated(join(app.getPath('appData'), 'Foresight'), join(app.getPath('appData'), 'Insight'), false)

/**
 * The app used to be called Foresight. Moves the old folder to the new name once (instant on the same drive) and
 * rewrites absolute paths stored in its JSON files. If the old folder is locked, keeps using it for this run.
 */
function migrated(oldDir: string, newDir: string, fixPaths: boolean): string {
  if (existsSync(newDir) || !existsSync(oldDir)) return newDir
  try {
    renameSync(oldDir, newDir)
  } catch {
    return oldDir
  }
  if (fixPaths) rewritePaths(newDir, oldDir, newDir)
  return newDir
}

function rewritePaths(root: string, from: string, to: string): void {
  const pairs = [JSON.stringify(from).slice(1, -1), from].map((f, i) => [f, i ? to : JSON.stringify(to).slice(1, -1)] as const)
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.json') && statSync(p).size < 20_000_000) {
        const s = readFileSync(p, 'utf8')
        let out = s
        for (const [a, b] of pairs) out = out.split(a).join(b)
        if (out !== s) writeFileSync(p, out)
      }
    }
  }
  try {
    walk(root)
  } catch (e) {
    console.warn('path migration', (e as Error).message)
  }
}

export const dir = (...parts: string[]): string => {
  const p = join(homeDir(), ...parts)
  mkdirSync(p, { recursive: true })
  return p
}

export const paths = {
  models: () => dir('models'),
  runtime: () => dir('runtime'),
  meetings: () => dir('meetings'),
  index: () => dir('index'),
  logs: () => dir('logs'),
  settingsFile: () => join(homeDir(), 'settings.json'),
  sourcesFile: () => join(homeDir(), 'sources.json'),
  chatFile: () => join(homeDir(), 'chat.json'),
  manifestFile: () => join(homeDir(), 'models', 'manifest.json')
}
