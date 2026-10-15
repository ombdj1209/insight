import { DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { paths } from './paths'
import { readJson, writeJson } from './util'

let current: Settings | null = null

export function getSettings(): Settings {
  if (!current) current = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(paths.settingsFile(), {}) }
  return current
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...getSettings(), ...patch }
  writeJson(paths.settingsFile(), current)
  return current
}
