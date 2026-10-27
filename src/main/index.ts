import { L } from './i18n'
import { app, BrowserWindow, desktopCapturer, globalShortcut, Menu, nativeImage, session, shell, Tray } from 'electron'
import { join } from 'path'
import { registerHotkey, showMainWindow } from './hotkey'
import { TRAY_ICON } from './icon'
import { startCalendar } from './calendar'
import { startBriefs } from './brief'
import { startCommitments } from './commitments'
import { startCallDetection, stopCallDetection } from './detect'
import { toggleCaptions } from './captions'
import { startRecap } from './recap'
import { startTeam } from './team'
import { bootRuntime, registerIpc } from './ipc'
import { createPet, destroyPet, registerPetIpc, togglePet } from './pet'
import { setMainWindow } from './windows'
import { userDataDir } from './paths'
import { stopRuntime } from './runtime'
import { getSettings } from './settings'
import { pruneAudio } from './store'
import { emit } from './util'
import { index } from './vectorIndex'

// %APPDATA%\Insight (moved from the old Foresight folder once, so saved API keys still decrypt).
// INSIGHT_USER_DATA: a separate profile for automated QA next to a running copy
app.setPath('userData', userDataDir())

if (!app.requestSingleInstanceLock()) app.quit()
// lets automated UI checks attach to both windows (dev only)
if (process.env.INSIGHT_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.INSIGHT_DEBUG_PORT)

let win: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Insight',
    icon: nativeImage.createFromDataURL(TRAY_ICON),
    backgroundColor: '#F8FAFD',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#F0F4F9', symbolColor: '#444746', height: 56 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false // keep audio capture and VAD running while minimised
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  setMainWindow(win, createWindow)
  return win
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON))
  tray.setToolTip('Insight')
  // built on every right-click so it follows the interface language
  tray.on('right-click', () =>
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: L('Open Insight'), click: showMainWindow },
        { label: L('Start / stop listening'), click: () => emit('hotkey:toggle', null) },
        { label: L('Show / hide pet'), click: togglePet },
        { label: L('Live captions'), click: () => toggleCaptions() },
        { type: 'separator' },
        { label: L('Quit'), click: () => app.quit() }
      ])
    )
  )
  tray.on('click', showMainWindow)
}

app.on('second-instance', showMainWindow)

app.whenReady().then(() => {
  app.setAppUserModelId('dev.needfit.insight')
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media' || permission === 'display-capture'))
  // System audio: answer getDisplayMedia with the primary screen + Windows WASAPI loopback, no picker.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, cb) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => cb({ video: sources[0], audio: 'loopback' }))
        .catch(() => cb({}))
    },
    { useSystemPicker: false }
  )
  registerIpc()
  registerPetIpc()
  createWindow()
  createPet()
  createTray()
  registerHotkey()
  pruneAudio(getSettings().retentionDays)
  void bootRuntime()
  startCalendar()
  startBriefs()
  startCommitments()
  startCallDetection()
  startRecap()
  startTeam()
})

app.on('before-quit', () => {
  destroyPet()
  stopCallDetection()
  index.flush()
  globalShortcut.unregisterAll()
  void stopRuntime()
})

app.on('window-all-closed', () => app.quit())
