import { DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { paths } from './paths'
import { readJson, writeJson } from './util'

let current: Settings | null = null

export function getSettings(): Settings {
  if (!current) {
    const raw = readJson<Partial<Settings>>(paths.settingsFile(), {})
    // installs from before the welcome wizard already went through setup
    current = { ...DEFAULT_SETTINGS, ...raw, onboarded: raw.onboarded ?? Object.keys(raw).length > 0 }
  }
  return current
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...getSettings(), ...patch }
  writeJson(paths.settingsFile(), current)
  return current
}
