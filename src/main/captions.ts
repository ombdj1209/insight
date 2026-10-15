import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { homeDir } from './paths'
import { chat } from './llm'
import { getSettings, updateSettings } from './settings'
import { emit, readJson, SerialQueue, writeJson } from './util'

/** Live captions: a small always-on-top bar showing what is said, optionally translated into any language. */
const W = 920
const H = 190
const file = (): string => join(homeDir(), 'captions.json')
let win: BrowserWindow | null = null
const queue = new SerialQueue()

export const captionsOpen = (): boolean => !!win && !win.isDestroyed()

export function toggleCaptions(force?: boolean): void {
  const open = force ?? !captionsOpen()
  if (!open) {
    win?.destroy()
    win = null
    emit('captions:state', { open: false })
    return
  }
  if (captionsOpen()) return win!.showInactive()
  const saved = readJson<{ x?: number; y?: number }>(file(), {})
  const wa = screen.getPrimaryDisplay().workArea
  const x = saved.x ?? Math.round(wa.x + (wa.width - W) / 2)
  const y = saved.y ?? wa.y + wa.height - H - 24
  const onScreen = screen.getAllDisplays().some((d) => x + W / 2 >= d.workArea.x && x + W / 2 <= d.workArea.x + d.workArea.width && y >= d.workArea.y - 20 && y <= d.workArea.y + d.workArea.height)
  win = new BrowserWindow({
    x: onScreen ? x : Math.round(wa.x + (wa.width - W) / 2),
    y: onScreen ? y : wa.y + wa.height - H - 24,
    width: W,
    height: H,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    title: 'Insight captions',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.once('ready-to-show', () => win?.showInactive())
  win.on('moved', () => {
    const b = win?.getBounds()
    if (b) writeJson(file(), { x: b.x, y: b.y })
  })
  win.on('closed', () => {
    win = null
    emit('captions:state', { open: false })
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/captions.html`)
  else void win.loadFile(join(__dirname, '../renderer/captions.html'))
  emit('captions:state', { open: true })
}

/** Translate one caption line (not cached: transcripts are never reused). */
function translateLine(text: string, lang: string): Promise<string> {
  return queue.push(async () => {
    if (queue.pending > 6) return '' // falling behind: skip rather than lag further
    const out = await chat(
      [
        { role: 'system', content: `Translate the meeting caption into ${lang}. Output only the translation, one line, natural spoken style. If it is already in ${lang}, repeat it.` },
        { role: 'user', content: text }
      ],
      { maxTokens: 200, temperature: 0 }
    )
    return out.replace(/\s+/g, ' ').trim()
  })
}

export function registerCaptionsIpc(): void {
  ipcMain.handle('captions:toggle', (_e, open?: boolean) => toggleCaptions(open))
  ipcMain.handle('captions:isOpen', () => captionsOpen())
  ipcMain.handle('captions:translate', (_e, text: string) => {
    const lang = getSettings().captionsLanguage
    return lang ? translateLine(text, lang).catch(() => '') : ''
  })
  ipcMain.handle('captions:setLanguage', (_e, lang: string) => {
    updateSettings({ captionsLanguage: lang })
    emit('captions:language', lang)
  })
}
