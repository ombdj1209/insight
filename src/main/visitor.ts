import { L } from './i18n'
import { BrowserWindow, ipcMain, Notification, screen, type Rectangle } from 'electron'
import { join } from 'path'
import type { Visit } from '../shared/team'
import type { MainEvents } from '../shared/types'
import { showMainWindow } from './hotkey'
import { petBounds, petVisible } from './pet'
import { emit, uid } from './util'

/**
 * Visiting pets: a teammate's message arrives as their pet walking in from the screen edge up to yours, saying it in
 * a bubble with buttons. One visitor at a time, in a temporary transparent window like the pet's (pet.html#visitor).
 */
const W = 320
const H = 380
const FPS = 60
const GAP = 190 // centre to centre, so the two pets stand side by side

/** answers a button; a returned string is shown as the visitor's reply before it leaves */
export type VisitHandler = (actionId: string) => Promise<string | void> | string | void
interface Queued {
  visit: Visit
  act: VisitHandler
  stayMs: number
}
const queue: Queued[] = []
const shown = new Set<Notification>() // keep references so click handlers survive GC
let cur: (Queued & { win: BrowserWindow; x: number; y: number; start: number; dir?: number; arrived?: boolean; loop?: NodeJS.Timeout; timer?: NodeJS.Timeout; leaving?: boolean }) | null = null

export function visit(v: Visit, act: VisitHandler, stayMs = 10 * 60_000): void {
  queue.push({ visit: v, act, stayMs })
  if (!cur) next()
}

const send = <K extends keyof MainEvents>(ch: K, p: MainEvents[K]): void => {
  if (cur && !cur.win.isDestroyed()) cur.win.webContents.send(ch, p)
}

function next(): void {
  const q = queue.shift()
  if (!q) return
  const b = petBounds()
  const wa = (b ? screen.getDisplayNearestPoint({ x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) }) : screen.getPrimaryDisplay()).workArea
  // stand beside your pet (on the side with more room), or in the bottom-right corner when it is hidden
  const mid = b ? b.x + b.w / 2 : wa.x + wa.width - 60 - GAP
  const fromLeft = mid - wa.x > wa.x + wa.width - mid
  const target = Math.round((b ? mid + (fromLeft ? -GAP : GAP) : wa.x + wa.width - 60) - W / 2)
  const start = fromLeft ? wa.x - W : wa.x + wa.width
  const y = Math.round(b ? b.y + b.h - H : wa.y + wa.height - H)
  const win = new BrowserWindow({
    x: start,
    y,
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
    title: 'Insight visitor',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setShape([{ x: W / 2 - 80, y: H - 170, width: 160, height: 170 }])
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.on('closed', () => {
    if (cur?.win !== win) return
    clearInterval(cur.loop)
    clearTimeout(cur.timer)
    cur = null
    next()
  })
  cur = { ...q, win, x: start, y, start }
  win.once('ready-to-show', () => {
    win.showInactive()
    walkTo(target, () => arrived(q))
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pet.html#visitor`)
  else void win.loadFile(join(__dirname, '../renderer/pet.html'), { hash: 'visitor' })
}

function walkTo(x: number, done: () => void): void {
  if (!cur) return
  const c = cur
  clearInterval(c.loop)
  const dir = Math.sign(x - c.x)
  c.dir = dir
  const speed = Math.max(3.2, Math.abs(x - c.x) / (4.5 * FPS)) // never more than ~4.5 s, even across a wide screen
  send('visitor:motion', { state: 'walking', dir })
  c.loop = setInterval(() => {
    if (c.win.isDestroyed()) return clearInterval(c.loop)
    c.x += dir * speed
    const there = (dir > 0 && c.x >= x) || (dir < 0 && c.x <= x) || !dir
    if (there) c.x = x
    c.win.setBounds({ x: Math.round(c.x), y: c.y, width: W, height: H })
    if (!there) return
    // stop first: done() may destroy the window
    clearInterval(c.loop)
    c.dir = 0
    send('visitor:motion', { state: 'stopped' })
    done()
  }, 1000 / FPS)
}

function arrived(q: Queued): void {
  if (!cur) return
  cur.arrived = true
  send('visitor:show', cur.visit)
  cur.timer = setTimeout(leave, q.stayMs)
  const v = q.visit
  if (petVisible()) {
    emit('pet:cmd', { type: 'line', line: { id: uid(), text: L('Look, {pet} came over from {name}!', { pet: v.pet.name, name: v.from }), ttl: 4500, mood: 'excited' } })
  } else if (Notification.isSupported()) {
    const n = new Notification({ title: L('{name} sent {pet} over', { name: v.from, pet: v.pet.name }), body: v.text })
    n.on('click', () => {
      showMainWindow()
      emit('pet:command', { cmd: 'open', page: 'team' })
      shown.delete(n)
    })
    n.on('close', () => shown.delete(n))
    shown.add(n)
    n.show()
  }
}

function leave(): void {
  if (!cur || cur.leaving) return
  const c = cur
  c.leaving = true
  clearTimeout(c.timer)
  walkTo(c.start, () => c.win.destroy())
}

export function registerVisitorIpc(): void {
  // the window can mount after the walk started: tell it where things stand (no bubble until it has arrived)
  ipcMain.handle('visitor:get', () => (cur ? { visit: cur.arrived ? cur.visit : null, pet: cur.visit.pet, dir: cur.dir ?? 0 } : null))
  ipcMain.handle('visitor:act', async (e, actionId: string) => {
    if (!cur || e.sender !== cur.win.webContents || cur.leaving) return
    const c = cur
    let reply: string | void
    try {
      reply = await c.act(String(actionId))
    } catch (err) {
      reply = String((err as Error).message ?? err).slice(0, 200)
    }
    if (!reply) return leave()
    c.visit = { ...c.visit, reply, actions: [] }
    send('visitor:show', c.visit)
    clearTimeout(c.timer)
    c.timer = setTimeout(leave, 4000)
  })
  ipcMain.on('visitor:shape', (e, rects: Rectangle[]) => {
    if (!cur || e.sender !== cur.win.webContents || !Array.isArray(rects)) return
    const clean = rects
      .map((r) => ({ x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }))
      .filter((r) => r.x < W && r.y < H)
    if (clean.length) cur.win.setShape(clean)
  })
}
