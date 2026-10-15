import type { BrowserWindow } from 'electron'

/** The main app window. The pet window is a second BrowserWindow, so never use getAllWindows()[0]. */
let main: BrowserWindow | null = null
let create: (() => BrowserWindow) | null = null

export function setMainWindow(w: BrowserWindow, factory: () => BrowserWindow): void {
  main = w
  create = factory
  w.on('closed', () => {
    if (main === w) main = null
  })
}

export const getMainWindow = (): BrowserWindow | null => (main && !main.isDestroyed() ? main : null)

/** Main window, recreated if the user closed it while the pet kept the app alive. */
export function ensureMainWindow(): BrowserWindow | null {
  const w = getMainWindow()
  if (w) return w
  if (!create) return null
  const n = create()
  return n
}
