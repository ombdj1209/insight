import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, CssBaseline, Snackbar, ThemeProvider, useMediaQuery } from '@mui/material'
import type { ComponentStatus, MeetingSummary, RuntimeStatus, Settings } from '../../shared/types'
import { api, cleanError, useEvent } from './api'
import { buildTheme, tokens } from './theme'
import { recorder } from './audio/recorder'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { CommandPalette } from './components/CommandPalette'
import { PageFade } from './components/ui'
import { useRecorder } from './components/ListeningPill'
import { HomePage } from './pages/Home'
import { MeetingPage } from './pages/Meeting'
import { KnowledgePage } from './pages/Knowledge'
import { ChatPage } from './pages/Chat'
import { SettingsPage } from './pages/Settings'
import { SetupPage } from './pages/Setup'
import { joinAndListen, ReminderBanner } from './components/Upcoming'
import { PetPage } from './pages/PetPage'
import { PeoplePage } from './pages/PeoplePage'
import { BriefDialog, briefKeyOf } from './components/Brief'
import { RecapDialog } from './components/Recap'
import type { CalEvent } from '../../shared/google'
import { setUiLanguage, useI18nVersion } from './i18n'
import createCache from '@emotion/cache'
import { CacheProvider } from '@emotion/react'
import rtlPlugin from '@mui/stylis-plugin-rtl'

// right-to-left languages: emotion flips margins, paddings and positions (MUI's documented RTL setup)
const rtlCache = createCache({ key: 'muirtl', stylisPlugins: [rtlPlugin] })
const ltrCache = createCache({ key: 'css' })

export type Route =
  | { page: 'home' | 'knowledge' | 'chat' | 'settings' | 'setup' | 'pet' | 'people'; meetingId?: undefined }
  | { page: 'meeting'; meetingId: string }

export interface AppCtx {
  settings: Settings
  saveSettings: (p: Partial<Settings>) => Promise<void>
  reloadSettings: () => Promise<void>
  go: (r: Route) => void
  startListening: (meetingId?: string) => Promise<void>
  stopListening: () => Promise<void>
  refreshMeetings: () => void
  toast: (message: string, kind?: 'info' | 'error') => void
  setupNeeded: boolean
  meetings: MeetingSummary[]
  runtime: RuntimeStatus
  openBrief: (e: CalEvent) => void
  openRecap: () => void
}

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem('fs.navCollapsed') === '1'
  } catch {
    return false
  }
}

export function App() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const narrow = useMediaQuery('(max-width: 1180px)')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [route, setRoute] = useState<Route>({ page: 'home' })
  const [meetings, setMeetings] = useState<MeetingSummary[]>([])
  const [components, setComponents] = useState<ComponentStatus[]>([])
  const [runtime, setRuntime] = useState<RuntimeStatus>({ llm: 'stopped', embedder: 'stopped', whisper: 'stopped', asr: '' })
  const [snack, setSnack] = useState<{ message: string; kind: 'info' | 'error' } | null>(null)
  const [collapsedPref, setCollapsedPref] = useState(readCollapsed)
  const [palette, setPalette] = useState(false)
  const rec = useRecorder()
  const startRef = useRef<() => Promise<void>>(async () => undefined)
  const stopRef = useRef<() => Promise<void>>(async () => undefined)
  const collapsed = collapsedPref || (narrow && route.page === 'meeting')

  const mode: 'light' | 'dark' = settings?.theme === 'system' || !settings ? (prefersDark ? 'dark' : 'light') : settings.theme
  useI18nVersion()
  const uiLanguage = settings?.uiLanguage
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr')
  useEffect(() => {
    if (uiLanguage !== undefined) void setUiLanguage(uiLanguage).then(() => setDir(document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'))
  }, [uiLanguage])
  const theme = useMemo(() => Object.assign(buildTheme(mode), { direction: dir }), [mode, dir])

  useEffect(() => {
    const t = tokens[mode]
    void api.overlay(t.window, t.onSurfaceVariant)
  }, [mode])

  const refreshMeetings = useCallback(() => void api.meetings().then(setMeetings), [])
  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.components().then((c) => {
      setComponents(c)
      if (c.some((x) => x.required && !x.installed)) setRoute({ page: 'setup' })
    })
    void api.runtimeStatus().then(setRuntime)
    refreshMeetings()
  }, [refreshMeetings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEvent('components:changed', setComponents)
  useEvent('runtime:changed', setRuntime)
  useEvent('toast', (t) => setSnack({ message: t.message, kind: t.kind }))
  const ctxRef = useRef<AppCtx | null>(null)
  const [briefEvent, setBriefEvent] = useState<CalEvent | null>(null)
  const [recapOpen, setRecapOpen] = useState(false)
  // the desktop pet asks the main window to open a page or join a meeting with notes
  useEvent('pet:command', (c) => {
    if (c.cmd === 'open') {
      if (c.page === 'recap') setRecapOpen(true)
      else if (c.page === 'brief' && c.meetingId) {
        const key = c.meetingId
        void Promise.all([api.calendar(), api.briefGet(key)]).then(([evs, b]) => {
          // the saved brief is enough to show it even if the calendar has not synced this event
          const e = evs.find((x) => briefKeyOf(x) === key) ?? (b ? { id: b.eventId, title: b.title, start: b.start, end: b.start + 30 * 60_000, allDay: false, attendees: 0 } : undefined)
          if (e) setBriefEvent(e)
        })
      } else if (c.page === 'meeting' && c.meetingId) setRoute({ page: 'meeting', meetingId: c.meetingId })
      else if (['home', 'knowledge', 'chat', 'settings', 'setup', 'pet', 'people'].includes(c.page)) setRoute({ page: c.page as 'home' })
    }
    if (c.cmd === 'joinNotes' && ctxRef.current) void joinAndListen(ctxRef.current, c.event)
    if (c.cmd === 'listen' && !recorder.state.recording) void startRef.current()
    if (c.cmd === 'stop' && recorder.state.recording) void stopRef.current()
  })
  useEvent('hotkey:toggle', () => {
    if (recorder.state.recording) void stopRef.current()
    else void startRef.current()
  })

  const setupNeeded = components.some((c) => c.required && !c.installed)
  const toast = useCallback((message: string, kind: 'info' | 'error' = 'info') => setSnack({ message, kind }), [])

  const startListening = useCallback(
    async (meetingId?: string) => {
      if (!settings) return
      if (setupNeeded) {
        setRoute({ page: 'setup' })
        return
      }
      const m = meetingId ? await api.meeting(meetingId) : await api.createMeeting()
      if (!m) return
      setRoute({ page: 'meeting', meetingId: m.id })
      try {
        await api.startMeeting(m.id)
        await recorder.start(m.id, { micDeviceId: settings.micDeviceId, captureSystem: settings.captureSystemAudio, offsetMs: m.durationMs, captureSlides: settings.captureSlides && settings.captureSystemAudio })
        if (recorder.state.error) toast(recorder.state.error, 'error')
      } catch (e) {
        await api.updateMeeting(m.id, { status: 'done' })
        toast(cleanError(e), 'error')
      }
      refreshMeetings()
    },
    [settings, setupNeeded, toast, refreshMeetings]
  )

  const stopListening = useCallback(async () => {
    const { meetingId, durationMs } = await recorder.stop()
    if (meetingId) await api.finishMeeting(meetingId, durationMs)
    refreshMeetings()
  }, [refreshMeetings])

  startRef.current = () => startListening()
  stopRef.current = stopListening

  if (!settings) return null

  const ctx: AppCtx = {
    settings,
    saveSettings: async (p) => setSettings(await api.setSettings(p)),
    reloadSettings: async () => setSettings(await api.getSettings()),
    go: setRoute,
    startListening,
    stopListening,
    refreshMeetings,
    toast,
    setupNeeded,
    meetings,
    runtime,
    openBrief: setBriefEvent,
    openRecap: () => setRecapOpen(true)
  }

  ctxRef.current = ctx

  const toggleNav = (): void => {
    const next = !collapsed
    setCollapsedPref(next)
    try {
      localStorage.setItem('fs.navCollapsed', next ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  const routeKey = route.page === 'meeting' ? `m-${route.meetingId}` : route.page

  return (
    <CacheProvider value={dir === 'rtl' ? rtlCache : ltrCache}>
      <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
        <TitleBar onMenu={toggleNav} onSearch={() => setPalette(true)} />
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Sidebar
            route={route}
            go={setRoute}
            meetings={meetings}
            recordingId={rec.meetingId}
            runtime={runtime}
            setupNeeded={setupNeeded}
            collapsed={collapsed}
            onStart={() => void startListening()}
          />
          <Box
            component="main"
            sx={(t) => ({
              flex: 1,
              minWidth: 0,
              mr: 1.5,
              mb: 1.5,
              borderRadius: '24px',
              overflow: 'hidden',
              bgcolor: t.fs.sheet,
              boxShadow: t.palette.mode === 'light' ? '0 0 0 1px rgba(0,0,0,.02)' : 'none'
            })}
          >
            <PageFade key={routeKey}>
              {route.page === 'home' && <HomePage ctx={ctx} meetings={meetings} />}
              {route.page === 'meeting' && <MeetingPage ctx={ctx} meetingId={route.meetingId} />}
              {route.page === 'knowledge' && <KnowledgePage ctx={ctx} />}
              {route.page === 'chat' && <ChatPage ctx={ctx} />}
              {route.page === 'settings' && <SettingsPage ctx={ctx} runtime={runtime} />}
              {route.page === 'pet' && <PetPage ctx={ctx} />}
              {route.page === 'people' && <PeoplePage ctx={ctx} />}
              {route.page === 'setup' && <SetupPage ctx={ctx} components={components} runtime={runtime} />}
            </PageFade>
          </Box>
        </Box>
      </Box>
      <ReminderBanner ctx={ctx} />
      <BriefDialog ctx={ctx} event={briefEvent} onClose={() => setBriefEvent(null)} />
      {recapOpen && <RecapDialog ctx={ctx} onClose={() => setRecapOpen(false)} />}
      <CommandPalette open={palette} onClose={() => setPalette(false)} ctx={ctx} meetings={meetings} />
      <Snackbar open={!!snack} autoHideDuration={6000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Alert
          severity={snack?.kind === 'error' ? 'error' : 'info'}
          variant="filled"
          onClose={() => setSnack(null)}
          sx={(t) => ({ borderRadius: 1, bgcolor: t.palette.mode === 'light' ? '#303030' : '#E3E3E3', color: t.palette.mode === 'light' ? '#F2F2F2' : '#303030', '& .MuiAlert-icon': { color: snack?.kind === 'error' ? (t.palette.mode === 'light' ? '#F2B8B5' : '#B3261E') : 'inherit' } })}
        >
          {snack?.message}
        </Alert>
      </Snackbar>
      </ThemeProvider>
    </CacheProvider>
  )
}
