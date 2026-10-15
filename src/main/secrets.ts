import { safeStorage } from 'electron'
import { join } from 'path'
import type { SecretName, UserSecret } from '../shared/types'
import { homeDir } from './paths'
import { readJson, writeJson } from './util'

/** API keys are encrypted with Windows DPAPI (Electron safeStorage) and never sent to the renderer. */
const file = (): string => join(homeDir(), 'secrets.json')

export function getSecret(name: SecretName): string {
  const all = readJson<Record<string, string>>(file(), {})
  const v = all[name]
  if (!v) return ''
  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : Buffer.from(v, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

export function setSecret(name: SecretName, value: string): void {
  const all = readJson<Record<string, string>>(file(), {})
  if (!value) delete all[name]
  else
    all[name] = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8')).toString('base64')
  writeJson(file(), all)
}

export const USER_SECRETS: UserSecret[] = ['gemini', 'openai', 'googleClientSecret']
export const secretStatus = (): Record<UserSecret, boolean> =>
  Object.fromEntries(USER_SECRETS.map((n) => [n, !!getSecret(n)])) as Record<UserSecret, boolean>
