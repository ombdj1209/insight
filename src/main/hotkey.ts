import { globalShortcut } from 'electron'
import { getSettings } from './settings'
import { emit } from './util'
import { ensureMainWindow } from './windows'
import { toggleCaptions } from './captions'

const current: Record<string, string> = {}

function bind(slot: string, key: string, label: string, fn: () => void): void {
  if (current[slot]) globalShortcut.unregister(current[slot])
  current[slot] = ''
  if (!key) return
  try {
    if (globalShortcut.register(key, fn)) current[slot] = key
    else emit('toast', { kind: 'error', message: `The ${label} shortcut ${key} is used by another app. Pick another in Settings.` })
  } catch {
    emit('toast', { kind: 'error', message: `"${key}" is not a valid shortcut.` })
  }
}

/** Global shortcuts (work while Teams or Zoom has focus): start/stop listening, ask the pet by voice, live captions. */
export function registerHotkey(): void {
  const s = getSettings()
  bind('listen', s.hotkey, 'listening', () => emit('hotkey:toggle', null))
  bind('voice', s.voiceHotkey, 'voice', () => emit('pet:cmd', { type: 'voice' }))
  bind('captions', s.captionsHotkey, 'captions', () => toggleCaptions())
}

export function showMainWindow(): void {
  const w = ensureMainWindow()
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}
