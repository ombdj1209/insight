import { getSettings } from './settings'
import { L } from './i18n'
import { BrowserWindow, globalShortcut, ipcMain, Menu, screen, type Rectangle } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { BADGES, DEFAULT_PET, DEFAULT_PROGRESS, isUnlocked, levelOf, UNLOCKS, type PetConfig, type PetProgress, type Topic } from '../shared/pet'
import { showMainWindow } from './hotkey'
import { toggleCaptions } from './captions'
import { homeDir } from './paths'
import { emit, readJson, writeJson } from './util'

/**
 * Desktop pet: a transparent, frameless, always-on-top window. Its native window shape (setShape) is
 * just the pet plus its speech bubble, so clicks and file drags pass through everywhere else.
 */
const W = 420
const H = 460
const FPS = 60
const file = (): string => join(homeDir(), 'pet.json')

let win: BrowserWindow | null = null
let state: { config: PetConfig; progress: PetProgress } | null = null
let userHidden = false
let fullscreen = false
let shooUntil = 0
let shooTimer: NodeJS.Timeout | undefined
let watcher: ChildProcess | null = null

// ---------- persistence ----------
function load(): { config: PetConfig; progress: PetProgress } {
  if (!state) {
    const raw = readJson<{ config?: Partial<PetConfig>; progress?: Partial<PetProgress> }>(file(), {})
    state = {
      config: { ...DEFAULT_PET, ...raw.config, language: raw.config?.language === 'ja' ? 'Japanese' : raw.config?.language === 'en' || !raw.config?.language ? 'English' : raw.config.language, topics: { ...DEFAULT_PET.topics, ...raw.config?.topics } },
      progress: { ...DEFAULT_PROGRESS, ...raw.progress, badges: raw.progress?.badges ?? [], likes: { ...DEFAULT_PROGRESS.likes, ...raw.progress?.likes }, dislikes: { ...DEFAULT_PROGRESS.dislikes, ...raw.progress?.dislikes } }
    }
  }
  return state
}
let saveT: NodeJS.Timeout | undefined
const save = (): void => {
  if (saveT) clearTimeout(saveT)
  saveT = setTimeout(() => writeJson(file(), load()), 400)
}
export const petConfig = (): PetConfig => load().config
export const petProgress = (): PetProgress => load().progress

export function setPetConfig(patch: Partial<PetConfig>): PetConfig {
  const s = load()
  const was = s.config.enabled
  s.config = { ...s.config, ...patch, topics: { ...s.config.topics, ...patch.topics } }
  save()
  emit('pet:config', s.config)
  if (s.config.enabled && !was) createPet()
  if (!s.config.enabled && was) destroyPet()
  if (patch.hideFullscreen !== undefined) syncWatcher()
  if (patch.gravity) startPhysics(0, 0)
  return s.config
}

// ---------- progression ----------
export function awardXp(amount: number): void {
  const p = load().progress
  const before = levelOf(p.xp).level
  p.xp += amount
  const after = levelOf(p.xp).level
  save()
  emit('pet:progress', p)
  if (after > before) {
    const unlocked = Object.entries(UNLOCKS)
      .filter(([id, lv]) => lv > before && lv <= after && !isUnlocked(id, before))
      .map(([id]) => id.split(':')[1])
    emit('pet:cmd', { type: 'levelup', level: after, unlocked })
  }
}
const today = (): string => new Date().toISOString().slice(0, 10)
export function noteMeetingDone(): void {
  const p = load().progress
  p.meetings++
  awardXp(10)
  if (p.meetings >= 1) awardBadge('first-meeting')
  if (p.meetings >= 10) awardBadge('meetings-10')
  if (p.meetings >= 50) awardBadge('meetings-50')
  if (p.meetings >= 100) awardBadge('meetings-100')
}
export function awardBadge(id: string): void {
  const p = load().progress
  p.badges ??= []
  if (p.badges.includes(id)) return
  const b = BADGES.find((x) => x.id === id)
  if (!b) return
  p.badges.push(id)
  save()
  emit('pet:progress', p)
  emit('pet:cmd', { type: 'badge', id, label: b.label, reward: b.reward?.split(':')[1] })
}

// ---------- visibility ----------
export const petVisible = (): boolean => !!win && !win.isDestroyed() && win.isVisible()
function applyVisibility(): void {
  if (!win || win.isDestroyed()) return
  const c = load().config
  const show = c.enabled && !userHidden && !(c.hideFullscreen && fullscreen) && Date.now() >= shooUntil
  if (show && !win.isVisible()) win.showInactive()
  if (!show && win.isVisible()) win.hide()
}
export function togglePet(): void {
  if (!load().config.enabled) {
    setPetConfig({ enabled: true })
    return
  }
  userHidden = !userHidden
  shooUntil = 0
  applyVisibility()
}
function shoo(ms: number): void {
  shooUntil = Date.now() + ms
  if (shooTimer) clearTimeout(shooTimer)
  shooTimer = setTimeout(() => {
    shooUntil = 0
    applyVisibility()
    emit('pet:cmd', { type: 'back' })
  }, ms)
  // let the pet say goodbye first
  setTimeout(applyVisibility, 1400)
}

// ---------- geometry ----------
const workArea = (x: number, y: number): Rectangle => screen.getDisplayNearestPoint({ x: Math.round(x + W / 2), y: Math.round(y + H / 2) }).workArea
function limits(x: number, y: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const wa = workArea(x, y)
  const m = W / 2 - 90 // let the pet itself reach the screen edge
  return { minX: wa.x - m, maxX: wa.x + wa.width - W + m, minY: wa.y - 120, maxY: wa.y + wa.height - H }
}
let pos = { x: 0, y: 0 }
function place(x: number, y: number): void {
  if (!win || win.isDestroyed()) return
  pos = { x, y }
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H })
}
function remember(): void {
  const p = load().progress
  p.x = Math.round(pos.x)
  p.y = Math.round(pos.y)
  save()
}

// ---------- physics (throw, gravity, walking) ----------
let loop: NodeJS.Timeout | undefined
let vel = { x: 0, y: 0 }
let walkTarget: number | null = null
function stopLoop(): void {
  if (loop) clearInterval(loop)
  loop = undefined
}
function startPhysics(vx: number, vy: number): void {
  if (!win) return
  walkTarget = null
  vel = { x: vx, y: vy }
  let peak = Math.hypot(vx, vy)
  stopLoop()
  if (peak > 3) emit('pet:motion', { state: 'flying' })
  loop = setInterval(() => {
    const g = load().config.gravity
    let { x, y } = pos
    const L = limits(x, y)
    vel.x *= 0.95
    vel.y = g ? vel.y + 1.1 : vel.y * 0.95
    x += vel.x
    y += vel.y
    let hit = 0
    if (x < L.minX) { x = L.minX; hit = Math.abs(vel.x); vel.x = -vel.x * 0.55 }
    if (x > L.maxX) { x = L.maxX; hit = Math.abs(vel.x); vel.x = -vel.x * 0.55 }
    if (y < L.minY) { y = L.minY; hit = Math.abs(vel.y); vel.y = -vel.y * 0.55 }
    let onFloor = false
    if (y >= L.maxY) {
      y = L.maxY
      if (vel.y > 0) {
        hit = Math.max(hit, vel.y)
        vel.y = -vel.y * 0.42
        if (Math.abs(vel.y) < 3) vel.y = 0
      }
      onFloor = true
      vel.x *= 0.9
    }
    if (hit > 6) emit('pet:motion', { state: 'bump', speed: hit })
    place(x, y)
    peak = Math.max(peak, Math.hypot(vel.x, vel.y))
    const slow = Math.abs(vel.x) < 0.35 && Math.abs(vel.y) < 0.35
    if (slow && (!g || onFloor)) {
      stopLoop()
      remember()
      emit('pet:motion', { state: 'landed', speed: peak })
    }
  }, 1000 / FPS)
}
function walk(dx: number, speed: number): void {
  if (!win || loop) return
  const L = limits(pos.x, pos.y)
  walkTarget = Math.max(L.minX, Math.min(L.maxX, pos.x + dx))
  const dir = Math.sign(walkTarget - pos.x)
  if (!dir) return
  emit('pet:motion', { state: 'walking', dir })
  loop = setInterval(() => {
    if (walkTarget === null) return stopLoop()
    const step = dir * speed
    const nx = pos.x + step
    if ((dir > 0 && nx >= walkTarget) || (dir < 0 && nx <= walkTarget)) {
      place(walkTarget, pos.y)
      walkTarget = null
      stopLoop()
      remember()
      emit('pet:motion', { state: 'stopped' })
      return
    }
    place(nx, pos.y)
  }, 1000 / FPS)
}

// ---------- full-screen watcher (hide during presentations, videos, games) ----------
const FS_SCRIPT = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class InsightFS {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public RECT m; public RECT w; public uint f; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MI i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static int Check() {
    IntPtr h = GetForegroundWindow(); if (h == IntPtr.Zero) return 0;
    var sb = new StringBuilder(256); GetClassName(h, sb, 256); string c = sb.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return 0;
    RECT r; if (!GetWindowRect(h, out r)) return 0;
    MI mi = new MI(); mi.cb = Marshal.SizeOf(typeof(MI));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return 0;
    return (r.L <= mi.m.L && r.T <= mi.m.T && r.R >= mi.m.R && r.B >= mi.m.B) ? 1 : 0;
  }
}
"@
$last = -1
while ($true) { $v = [InsightFS]::Check(); if ($v -ne $last) { [Console]::Out.WriteLine("FS $v"); [Console]::Out.Flush(); $last = $v }; Start-Sleep -Milliseconds 1500 }
`
function syncWatcher(): void {
  const want = process.platform === 'win32' && !!win && load().config.hideFullscreen
  if (want && !watcher) {
    try {
      const enc = Buffer.from(FS_SCRIPT, 'utf16le').toString('base64')
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', enc], { windowsHide: true })
      watcher = p
      let buf = ''
      p.stdout.on('data', (d: Buffer) => {
        buf += d.toString()
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (line.startsWith('FS ')) {
            fullscreen = line === 'FS 1'
            applyVisibility()
          }
        }
      })
      p.on('exit', () => {
        if (watcher === p) watcher = null
      })
    } catch {
      watcher = null // no PowerShell: the pet just stays visible
    }
  }
  if (!want && watcher) {
    watcher.kill()
    watcher = null
    fullscreen = false
    applyVisibility()
  }
}

// ---------- window ----------
export function createPet(): void {
  const s = load()
  if (!s.config.enabled || (win && !win.isDestroyed())) return
  const prim = screen.getPrimaryDisplay().workArea
  let x = s.progress.x ?? prim.x + prim.width - W - 40
  let y = s.progress.y ?? prim.y + prim.height - H
  // keep a saved position that is now off-screen (monitor unplugged) on a real display
  const L = limits(x, y)
  x = Math.max(L.minX, Math.min(L.maxX, x))
  y = Math.max(L.minY, Math.min(L.maxY, y))
  pos = { x, y }
  win = new BrowserWindow({
    x: Math.round(x),
    y: Math.round(y),
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
    focusable: false, // petting it never steals focus from what you are typing in
    show: false,
    title: 'Insight pet',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setShape([{ x: W / 2 - 100, y: H - 210, width: 200, height: 210 }])
  win.once('ready-to-show', applyVisibility)
  win.on('closed', () => {
    win = null
    stopLoop()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pet.html`)
  else void win.loadFile(join(__dirname, '../renderer/pet.html'))
  syncWatcher()
}
export function destroyPet(): void {
  stopLoop()
  if (watcher) watcher.kill()
  watcher = null
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}

// ---------- IPC ----------
const PET_KEY = 'CommandOrControl+Shift+P'
export function registerPetIpc(): void {
  const h = ipcMain.handle.bind(ipcMain)
  h('pet:get', () => {
    const s = load()
    return { config: s.config, progress: s.progress }
  })
  h('pet:set', (_e, patch: Partial<PetConfig>) => setPetConfig(patch))
  h('pet:petted', () => {
    const p = load().progress
    p.pets++
    if (p.petXpDay !== today()) {
      p.petXpDay = today()
      p.petXpToday = 0
    }
    if (p.petXpToday < 20) {
      p.petXpToday += 2
      awardXp(2)
    } else save()
  })
  h('pet:feedback', (_e, topic: Topic, liked: boolean) => {
    const p = load().progress
    if (liked) p.likes[topic]++
    else p.dislikes[topic]++
    save()
  })
  h('pet:briefed', () => {
    load().progress.lastBrief = today()
    save()
  })
  h('pet:say', (_e, line: unknown) => emit('pet:cmd', { type: 'line', line } as never))
  h('pet:listen', () => {
    showMainWindow()
    emit('pet:command', { cmd: 'listen' })
  })
  h('pet:stop', () => emit('pet:command', { cmd: 'stop' }))
  h('pet:show', () => {
    if (!load().config.enabled) setPetConfig({ enabled: true })
    userHidden = false
    shooUntil = 0
    applyVisibility()
  })
  h('pet:resetPosition', () => {
    const wa = screen.getPrimaryDisplay().workArea
    place(wa.x + wa.width - W - 40, wa.y + wa.height - H)
    remember()
  })
  h('pet:open', (_e, page: string, meetingId?: string) => {
    showMainWindow()
    emit('pet:command', { cmd: 'open', page, meetingId })
  })
  h('pet:joinNotes', (_e, event: unknown) => {
    showMainWindow()
    emit('pet:command', { cmd: 'joinNotes', event } as never)
  })
  h('pet:menu', (e) => {
    const c = load().config
    const w = BrowserWindow.fromWebContents(e.sender) ?? undefined
    Menu.buildFromTemplate([
      { label: L('Say something, {name}', { name: c.name }), click: () => emit('pet:cmd', { type: 'chat' }) },
      { label: `${L('Ask by voice')} (${getSettings().voiceHotkey.replace('CommandOrControl', 'Ctrl')})`, click: () => emit('pet:cmd', { type: 'voice' }) },
      { label: L('Ask Insight…'), click: () => (showMainWindow(), emit('pet:command', { cmd: 'open', page: 'chat' })) },
      { label: L('Live captions'), click: () => toggleCaptions() },
      { label: L('Open Insight'), click: showMainWindow },
      { label: L('Customize pet…'), click: () => (showMainWindow(), emit('pet:command', { cmd: 'open', page: 'pet' })) },
      { type: 'separator' },
      { label: L('Wander around'), type: 'checkbox', checked: c.wander, click: () => setPetConfig({ wander: !c.wander }) },
      { label: L('Gravity'), type: 'checkbox', checked: c.gravity, click: () => setPetConfig({ gravity: !c.gravity }) },
      { label: L('Sounds'), type: 'checkbox', checked: c.sound !== 'none' && c.volume > 0, click: () => setPetConfig({ volume: c.volume > 0 ? 0 : 0.35 }) },
      { type: 'separator' },
      { label: L('Shoo for 1 hour'), click: () => (emit('pet:cmd', { type: 'shoo' }), shoo(3600_000)) },
      { label: L('Hide ({key} brings it back)', { key: PET_KEY.replace('CommandOrControl', 'Ctrl') }), click: togglePet }
    ]).popup({ window: w })
  })
  // pointer handling: click-through except over the pet, drag, throw, walk
  ipcMain.on('pet:shape', (_e, rects: Rectangle[]) => {
    if (!win || win.isDestroyed() || !Array.isArray(rects)) return
    const clean = rects
      .map((r) => ({ x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }))
      .filter((r) => r.x < W && r.y < H)
    if (clean.length) win.setShape(clean)
  })
  ipcMain.on('pet:grab', () => {
    stopLoop()
    walkTarget = null
    emit('pet:motion', { state: 'carried' })
  })
  ipcMain.on('pet:moveTo', (_e, x: number, y: number) => place(x, y))
  // always run the physics step on release: it also pulls a pet dropped half off-screen back into view
  ipcMain.on('pet:throw', (_e, vx: number, vy: number) => {
    const cap = (v: number): number => Math.max(-70, Math.min(70, v))
    startPhysics(cap(vx), cap(vy))
  })
  ipcMain.on('pet:walk', (_e, dx: number) => walk(dx, 1.2 + load().config.energy * 1.6))
  try {
    globalShortcut.register(PET_KEY, togglePet)
  } catch {
    /* shortcut taken by another app */
  }
}
void fullscreen
