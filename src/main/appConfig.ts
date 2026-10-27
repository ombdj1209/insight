import { app } from 'electron'
import { join } from 'path'
import { readJson } from './util'

/**
 * Built-in app credentials, so users connect Google / Microsoft with one click instead of creating their own
 * OAuth clients. Shipped as resources/insight.config.json (copied by electron-builder, never committed); in dev it is
 * read from the repo root. Desktop OAuth clients are public clients: the "secret" is not confidential by design.
 * A user's own client ID in Settings always wins.
 */
export interface AppConfig {
  googleClientId?: string
  googleClientSecret?: string
  msClientId?: string
  msTenant?: string
}
let cfg: AppConfig | null = null
export function appConfig(): AppConfig {
  if (!cfg) {
    const file = app.isPackaged ? join(process.resourcesPath, 'insight.config.json') : join(app.getAppPath(), 'insight.config.json')
    const raw = readJson<AppConfig>(file, {})
    const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
    cfg = { googleClientId: s(raw.googleClientId), googleClientSecret: s(raw.googleClientSecret), msClientId: s(raw.msClientId), msTenant: s(raw.msTenant) }
  }
  return cfg
}
