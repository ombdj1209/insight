import { L } from './i18n'
import { Notification } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { showMainWindow } from './hotkey'
import { petVisible } from './pet'
import { getSettings } from './settings'
import { emit } from './util'
import { callAppName } from '../shared/calls'

/**
 * Call detection: Windows records which apps are using the microphone right now
 * (CapabilityAccessManager\ConsentStore\microphone, LastUsedTimeStop = 0 while in use).
 * When a known meeting app starts using the mic and Insight is not recording, offer to take notes.
 */
const SCRIPT = `
$base = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'
$last = ''
while ($true) {
  $on = @()
  foreach ($root in @("$base\\NonPackaged", $base)) {
    Get-ChildItem -Path $root -ErrorAction SilentlyContinue | ForEach-Object {
      $p = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
      if ($p -and $p.LastUsedTimeStart -gt 0 -and $p.LastUsedTimeStop -eq 0) { $on += $_.PSChildName }
    }
  }
  $now = ($on | Sort-Object -Unique) -join '|'
  if ($now -ne $last) { [Console]::Out.WriteLine("MIC $now"); [Console]::Out.Flush(); $last = $now }
  Start-Sleep -Seconds 4
}
`

let proc: ChildProcess | null = null
let recording = false
let active = new Set<string>() // meeting apps currently using the mic
let offered = new Set<string>()
let endTimer: NodeJS.Timeout | undefined

export function setRecordingForDetect(on: boolean): void {
  recording = on
  if (on) offered = new Set(active) // do not offer again for the call being recorded
}

function onChange(keys: string[]): void {
  const now = new Set(keys.map(callAppName).filter((x): x is string => !!x))
  const started = [...now].filter((a) => !active.has(a))
  const stopped = [...active].filter((a) => !now.has(a))
  active = now
  for (const a of stopped) offered.delete(a)
  if (!getSettings().autoDetectCalls) return
  if (started.length && !recording) {
    const app = started.find((a) => a !== 'your browser') ?? started[0]
    if (!offered.has(app)) {
      offered.add(app)
      emit('call:detected', { app })
      if (!petVisible() && Notification.isSupported()) {
        const n = new Notification({ title: L('Looks like a call started'), body: L('{app} is using your microphone. Click to take notes with Insight.', { app: app === 'your browser' ? L('your browser') : app }) })
        n.on('click', () => {
          showMainWindow()
          emit('pet:command', { cmd: 'listen' })
        })
        n.show()
      }
    }
  }
  // every meeting app released the mic while Insight is still recording: offer to stop after a grace period
  if (recording && !now.size && stopped.length) {
    if (endTimer) clearTimeout(endTimer)
    endTimer = setTimeout(() => {
      if (recording && !active.size) emit('call:ended', { app: stopped[0] })
    }, 45_000)
  }
  if (now.size && endTimer) {
    clearTimeout(endTimer)
    endTimer = undefined
  }
}

export function startCallDetection(): void {
  if (process.platform !== 'win32' || proc) return
  try {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: true })
    proc = p
    let buf = ''
    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line.startsWith('MIC')) onChange(line.slice(3).trim().split('|').filter(Boolean))
      }
    })
    p.on('exit', () => {
      if (proc === p) proc = null
    })
  } catch {
    proc = null
  }
}
export function stopCallDetection(): void {
  proc?.kill()
  proc = null
}
