import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, statSync, writeFileSync } from 'fs'
import { basename, extname } from 'path'
import type { ChatMessage, ChatScope, ComponentId, Meeting, PresetId, SegmentPayload, Settings, SourceType, UserSecret } from '../shared/types'
import { PRESETS } from '../shared/presets'
import { resetRecognizers, warmAsr } from './asr'
import { warmDiarizer } from './diarize'
import { eventAt, syncCalendar, upcomingEvents } from './calendar'
import { setRecordingForDetect } from './detect'
import { addSlide, deleteSlide, slideImage, slidesSourceId } from './slides'
import { listPeople, summarizePerson } from './people'
import { connectMicrosoft, disconnectMicrosoft, msDraft, msEvent, msStatus, msTasks } from './microsoft'
import { computeRecap } from './recap'
import { generateBrief, getBrief } from './brief'
import { extractCommitments, listCommitments, removeCommitmentsFor, updateCommitment } from './commitments'
import { addTasks, createDraft, createEvent } from './gactions'
import type { CalEvent } from '../shared/google'
import type { Commitment } from '../shared/types'
import { ask } from './chat'
import { connectGoogle, disconnectGoogle } from './google'
import { googleStatus, resetMcp } from './mcp'
import { componentStatus, installComponents } from './downloader'
import { defaultBackend, detectHardware } from './hardware'
import { registerHotkey } from './hotkey'
import { addSource, clearMemory, getSources, memoryCount, indexMeeting, relabelSource, reindexSource, removeMeetingFromIndex, removeSource, resumeIndexing, search } from './ingest'
import { assist, draftFollowUp, enhanceNotes, finishMeeting, handleSegment, meetingMarkdown, renameSpeaker, translateNotes } from './meetings'
import { homeDir } from './paths'
import { ensureRuntime, restartRuntime, runtimeStatus } from './runtime'
import { secretStatus, setSecret, USER_SECRETS } from './secrets'
import { getSettings, updateSettings } from './settings'
import { createMeeting, deleteMeeting, getChat, getMeeting, listMeetings, newMessage, readSegmentAudio, saveChat, updateMeeting } from './store'
import { emit, uid } from './util'
import { transcribe } from './asr'
import { registerCaptionsIpc } from './captions'
import { chat } from './llm'
import { catalog, translate } from './i18n'
import { SUPPORTED_EXT } from './parsers'
import { awardXp, noteMeetingDone, petConfig } from './pet'
import { index, type SearchFilter } from './vectorIndex'

const RESTART_KEYS: (keyof Settings)[] = [
  'llmModel', 'gpuBackend', 'gpuLayers', 'contextSize', 'asrEngine', 'whisperModel', 'language', 'extraLlamaArgs', 'aiProvider'
]
const ASR_KEYS: (keyof Settings)[] = ['language', 'sherpaThreads', 'asrEngine']

const ready = (): boolean => componentStatus().every((c) => !c.required || c.installed)

export async function bootRuntime(): Promise<void> {
  if (!ready()) return
  try {
    await ensureRuntime()
    resumeIndexing()
  } catch (e) {
    emit('toast', { kind: 'error', message: (e as Error).message.split('\n')[0] })
  }
}

async function rebuildIndex(): Promise<void> {
  index.reset()
  resumeIndexing()
  for (const s of listMeetings()) {
    const m = getMeeting(s.id)
    if (m) await indexMeeting(m).catch(() => undefined)
  }
}

function applySettings(patch: Partial<Settings>): Settings {
  const before = getSettings()
  const next = updateSettings(patch)
  const changed = (k: keyof Settings): boolean => patch[k] !== undefined && patch[k] !== before[k]
  emit('components:changed', componentStatus())
  emit('runtime:changed', runtimeStatus())
  if (ASR_KEYS.some(changed)) resetRecognizers()
  if (changed('hotkey') || changed('voiceHotkey') || changed('captionsHotkey')) registerHotkey()
  if (changed('embedDims')) void rebuildIndex()
  if (changed('googleServices')) {
    resetMcp()
    void googleStatus().then((g) => emit('google:changed', g))
  }
  if (changed('calendarSync')) void syncCalendar().catch(() => undefined)
  if (changed('googleActions')) void googleStatus().then((g) => emit('google:changed', g))
  if (changed('msActions') || changed('msClientId')) emit('ms:changed', msStatus())
  if (RESTART_KEYS.some(changed) && ready()) void restartRuntime().catch(() => undefined)
  return next
}

export function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain)
  registerCaptionsIpc()

  h('app:home', () => homeDir())
  h('settings:get', () => getSettings())
  h('settings:set', (_e, patch: Partial<Settings>) => applySettings({ ...patch, ...(patch.preset ? {} : { preset: 'custom' as const }) }))
  h('hardware:detect', () => detectHardware())
  h('presets:apply', async (_e, id: PresetId) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return getSettings()
    const hw = await detectHardware()
    const gpu = id === 'light' || id === 'cloud' ? {} : { gpuBackend: defaultBackend(hw) }
    return applySettings({ ...p.settings, ...gpu, sherpaThreads: Math.max(2, Math.min(8, Math.floor(hw.cores / 2))) })
  })
  h('secrets:status', () => secretStatus())
  h('secrets:set', (_e, name: UserSecret, value: string) => {
    if (!USER_SECRETS.includes(name)) throw new Error('Unknown secret')
    setSecret(name, value.trim())
    return secretStatus()
  })

  h('components:list', () => componentStatus())
  h('components:install', async (_e, ids?: ComponentId[]) => {
    await installComponents(ids)
    await bootRuntime()
    return componentStatus()
  })
  h('runtime:status', () => runtimeStatus())
  h('runtime:start', () => bootRuntime())
  h('runtime:restart', () => restartRuntime().catch((e: Error) => emit('toast', { kind: 'error', message: e.message.split('\n')[0] })))

  h('meetings:list', () => listMeetings())
  h('meetings:get', (_e, id: string) => getMeeting(id))
  h('meetings:create', () => createMeeting())
  h('meetings:update', (_e, id: string, patch: Partial<Meeting>) => updateMeeting(id, patch))
  h('meetings:delete', (_e, id: string) => {
    removeMeetingFromIndex(id)
    removeCommitmentsFor(id)
    index.removeWhere((c) => c.sourceId === slidesSourceId(id))
    deleteMeeting(id)
  })
  h('meetings:start', (_e, id: string) => {
    void warmAsr().then(warmDiarizer)
    let m = updateMeeting(id, { status: 'recording' })
    // link the recording to the calendar event happening now: attendees for briefs, promises and follow-ups
    const ev = m.calendar ? undefined : eventAt(Date.now())
    if (ev) m = updateMeeting(id, { calendar: { eventId: ev.id, start: ev.start, title: ev.title, people: ev.people ?? [] }, ...(/^Meeting /.test(m.title) ? { title: ev.title } : {}) })
    emit('meeting:state', { recording: true, meetingId: id, title: m?.title ?? 'Meeting', durationMs: 0 })
    setRecordingForDetect(true)
    return m
  })
  h('meetings:finish', async (_e, id: string, durationMs: number) => {
    await finishMeeting(id, durationMs)
    setRecordingForDetect(false)
    emit('meeting:state', { recording: false, meetingId: id, title: getMeeting(id)?.title ?? 'Meeting', durationMs })
    if (durationMs > 60_000) noteMeetingDone()
  })
  h('meetings:enhance', async (_e, id: string) => {
    const out = await enhanceNotes(id)
    emit('meeting:enhanced', { meetingId: id, title: getMeeting(id)?.title ?? 'Meeting', actionItems: countActionItems(out) })
    awardXp(5)
    void extractCommitments(id).catch((e: Error) => console.warn('commitments', e.message))
    return out
  })
  h('meetings:assist', (_e, id: string, question: string, atMs: number) => assist(id, question, atMs, true))
  h('meetings:renameSpeaker', (_e, id: string, speakerId: string, name: string) => renameSpeaker(id, speakerId, name))
  h('meetings:followup', (_e, id: string, language: string, tone: 'formal' | 'friendly') => draftFollowUp(id, language, tone))
  h('i18n:catalog', (_e, lang: string) => catalog(lang))
  h('i18n:translate', (_e, lang: string, texts: string[]) => translate(lang, texts))
  h('meetings:translate', (_e, id: string, language: string) => translateNotes(id, language))
  h('meetings:audio', (_e, id: string, startMs: number, channel: string) => readSegmentAudio(id, startMs, channel))
  h('meetings:export', async (e, id: string) => {
    const m = getMeeting(id)
    if (!m) return false
    const win = BrowserWindow.fromWebContents(e.sender)!
    const safe = m.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'meeting'
    const r = await dialog.showSaveDialog(win, { defaultPath: `${safe}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (r.canceled || !r.filePath) return false
    writeFileSync(r.filePath, meetingMarkdown(m), 'utf8')
    return true
  })
  ipcMain.on('segment', (_e, p: SegmentPayload) => handleSegment(p))
  h('slides:add', (_e, meetingId: string, atMs: number, jpeg: ArrayBuffer) => addSlide(meetingId, atMs, jpeg))
  h('slides:image', (_e, meetingId: string, slideId: string) => slideImage(meetingId, slideId))
  h('slides:delete', (_e, meetingId: string, slideId: string) => deleteSlide(meetingId, slideId))

  h('sources:list', () => getSources())

  // Microsoft 365
  h('ms:status', () => msStatus())
  h('ms:connect', async () => {
    await connectMicrosoft()
    void syncCalendar().catch((e: Error) => emit('toast', { kind: 'error', message: e.message }))
    emit('ms:changed', msStatus())
    return msStatus()
  })
  h('ms:disconnect', () => {
    disconnectMicrosoft()
    emit('ms:changed', msStatus())
    return msStatus()
  })
  h('msactions:draft', (_e, p: { to: string[]; subject: string; body: string }) => msDraft(p))
  h('msactions:tasks', (_e, items: { title: string; notes?: string; due?: string | null }[]) => msTasks(items))
  h('msactions:event', (_e, p: { title: string; start: number; minutes: number; attendees: string[]; description?: string; meet: boolean }) => msEvent(p))
  // people memory and weekly recap
  h('people:list', () => listPeople())
  h('people:summarize', (_e, key: string) => summarizePerson(key))
  h('recap:get', (_e, offsetWeeks = 0) => computeRecap(offsetWeeks))
  h('file:savePng', async (e, dataUrl: string, name: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'PNG image', extensions: ['png'] }] })
    if (r.canceled || !r.filePath) return false
    writeFileSync(r.filePath, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'))
    return true
  })
  // pre-meeting briefs
  h('brief:get', (_e, key: string) => getBrief(key))
  h('brief:generate', (_e, ev: CalEvent) => generateBrief(ev))
  // promise tracker
  h('commitments:list', () => listCommitments())
  h('commitments:update', (_e, id: string, patch: Partial<Commitment>) => updateCommitment(id, patch))
  h('commitments:extract', (_e, meetingId: string) => extractCommitments(meetingId))
  // Google write actions (each one confirmed in the UI first)
  h('gactions:draft', (_e, p: { to: string[]; subject: string; body: string }) => createDraft(p))
  h('gactions:tasks', (_e, items: { title: string; notes?: string; due?: string | null }[]) => addTasks(items))
  h('gactions:event', (_e, p: { title: string; start: number; minutes: number; attendees: string[]; description?: string; meet: boolean }) => createEvent(p))
  // a file or folder dropped on the desktop pet
  h('sources:addPath', (_e, p: string) => {
    if (!p || !existsSync(p)) return { ok: false, name: '' }
    const isDir = statSync(p).isDirectory()
    if (!isDir && !SUPPORTED_EXT.includes(extname(p).toLowerCase())) return { ok: false, name: basename(p) }
    addSource(isDir ? 'folder' : 'file', p, 'General')
    awardXp(3)
    return { ok: true, name: basename(p) }
  })
  // a fresh line written by the configured AI provider, using only coarse context (no meeting titles or content)
  h('pet:smart', async (_e, ctx: { meetingsLeft: number; nextInMin: number | null; hour: number; weekday: string }) => {
    const c = petConfig()
    if (!c.smartLines) return ''
    try {
      const user = getSettings().userName
      const tone = c.sassy ? 'playfully sassy but kind' : 'warm and wholesome'
      const lang = c.language || 'English'
      const text = await chat(
        [
          { role: 'system', content: `You are ${c.name}, a tiny ${c.species} desktop pet who lives on ${user && user !== 'You' ? user + "'s" : "the user's"} Windows screen. Personality: ${tone}, energy ${Math.round(c.energy * 10)}/10. Write ONE short line (max 16 words) in ${lang}: a surprising true fact, a clean joke, or encouragement that fits the moment. No hashtags, no quotes, no emoji spam.` },
          { role: 'user', content: `It is ${ctx.weekday}, ${ctx.hour}:00. Meetings left today: ${ctx.meetingsLeft}. Next meeting in: ${ctx.nextInMin ?? 'none'} minutes.` }
        ],
        { maxTokens: 60, temperature: 0.95 }
      )
      return text.replace(/^["'「]+|["'」]+$/g, '').split('\n')[0].slice(0, 160)
    } catch {
      return ''
    }
  })
  h('sources:add', async (e, type: SourceType, label: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const filters =
      type === 'calendar'
        ? [{ name: 'Calendar', extensions: ['ics'] }]
        : type === 'bookmarks'
          ? [{ name: 'Bookmarks', extensions: ['html', 'htm', 'json', '*'] }]
          : undefined
    const r = await dialog.showOpenDialog(win, {
      properties: type === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      filters
    })
    if (r.canceled) return getSources()
    for (const p of r.filePaths) addSource(type, p, label)
    return getSources()
  })
  h('sources:remove', (_e, id: string) => removeSource(id))
  h('sources:relabel', (_e, id: string, label: string) => relabelSource(id, label))
  h('sources:reindex', (_e, id: string) => reindexSource(id))
  h('search', (_e, q: string, filter: SearchFilter) => search(q, 20, filter))

  h('chat:history', () => getChat())
  h('chat:clear', () => saveChat([]))
  // the pet's voice question: transcribe, answer with Ask (files, meetings, connected accounts), keep it in the Ask history
  h('pet:voiceAsk', async (_e, wav: ArrayBuffer) => {
    const { text } = await transcribe(Buffer.from(wav))
    if (!text.trim()) return { question: '', answer: '' }
    const history = getChat().slice(-6)
    const res = await ask(uid(), text, {}, history)
    saveChat([...getChat(), newMessage('user', text), { ...newMessage('assistant', res.answer), citations: res.citations }])
    return { question: text, answer: res.answer }
  })
  h('chat:ask', async (_e, requestId: string, question: string, scope: ChatScope, history: ChatMessage[], persist: boolean) => {
    const res = await ask(requestId, question, scope, history)
    if (persist) {
      const msgs = getChat()
      const a = { ...newMessage('assistant', res.answer), citations: res.citations }
      saveChat([...msgs, newMessage('user', question), a])
    }
    return res
  })

  h('google:status', (_e, probe?: boolean) => googleStatus(!!probe))
  h('google:connect', async () => {
    await connectGoogle()
    resetMcp()
    void syncCalendar().catch((e: Error) => emit('toast', { kind: 'error', message: e.message }))
    const g = await googleStatus(true)
    emit('google:changed', g)
    return g
  })
  h('google:disconnect', async () => {
    await disconnectGoogle()
    resetMcp()
    const g = await googleStatus()
    emit('google:changed', g)
    return g
  })
  h('calendar:list', () => upcomingEvents())
  h('calendar:sync', () => syncCalendar())
  h('memory:count', () => memoryCount())
  h('memory:clear', () => clearMemory())

  h('shell:open', (_e, p: string) => shell.openPath(p))
  h('shell:external', (_e, url: string) => {
    // meeting join links only; never hand arbitrary schemes to the OS
    if (!/^https:\/\//i.test(url)) throw new Error('Only https links can be opened')
    return shell.openExternal(url)
  })
  h('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  h('window:overlay', (e, color: string, symbolColor: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    try {
      win?.setTitleBarOverlay({ color, symbolColor, height: 56 })
    } catch {
      /* not supported on this platform */
    }
  })
}

/** Bullets under "## Action items" in enhanced notes */
function countActionItems(md: string): number {
  const m = md.match(/##\s*(Action items|アクションアイテム)[^\n]*\n([\s\S]*?)(\n##\s|$)/i)
  return m ? m[2].split('\n').filter((l) => /^\s*[-*•]\s+\S/.test(l)).length : 0
}
