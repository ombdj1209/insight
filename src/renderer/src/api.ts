import { useEffect } from 'react'
import type {
  AssistCard, ChatMessage, ChatScope, Citation, ComponentId, ComponentStatus, KnowledgeSource, MainEvents,
  Meeting, MeetingSummary, RuntimeStatus, SearchHit, Settings, SourceType, ChunkKind, HardwareInfo, PresetId, UserSecret
} from '../../shared/types'
import type { CalEvent, GoogleStatus } from '../../shared/google'
import type { PetConfig, PetLine, PetProgress, Topic } from '../../shared/pet'
import type { Brief, Commitment, PersonCard, Recap, Slide } from '../../shared/types'
import type { Busy, StandupEntry, TeamStatus, Visit } from '../../shared/team'

const inv = <T,>(ch: string, ...a: unknown[]): Promise<T> => window.insight.invoke<T>(ch, ...a)

export const api = {
  home: () => inv<string>('app:home'),
  getSettings: () => inv<Settings>('settings:get'),
  setSettings: (p: Partial<Settings>) => inv<Settings>('settings:set', p),
  components: () => inv<ComponentStatus[]>('components:list'),
  install: (ids?: ComponentId[]) => inv<ComponentStatus[]>('components:install', ids),
  runtimeStatus: () => inv<RuntimeStatus>('runtime:status'),
  startRuntime: () => inv<void>('runtime:start'),
  restartRuntime: () => inv<void>('runtime:restart'),
  meetings: () => inv<MeetingSummary[]>('meetings:list'),
  meeting: (id: string) => inv<Meeting | null>('meetings:get', id),
  createMeeting: () => inv<Meeting>('meetings:create'),
  updateMeeting: (id: string, p: Partial<Meeting>) => inv<Meeting>('meetings:update', id, p),
  deleteMeeting: (id: string) => inv<void>('meetings:delete', id),
  startMeeting: (id: string) => inv<Meeting>('meetings:start', id),
  finishMeeting: (id: string, durationMs: number) => inv<void>('meetings:finish', id, durationMs),
  enhance: (id: string) => inv<string>('meetings:enhance', id),
  assist: (id: string, q: string, atMs: number) => inv<AssistCard | null>('meetings:assist', id, q, atMs),
  sources: () => inv<KnowledgeSource[]>('sources:list'),
  addSource: (type: SourceType, label: string) => inv<KnowledgeSource[]>('sources:add', type, label),
  removeSource: (id: string) => inv<void>('sources:remove', id),
  relabelSource: (id: string, label: string) => inv<void>('sources:relabel', id, label),
  reindexSource: (id: string) => inv<void>('sources:reindex', id),
  search: (q: string, filter: { labels?: string[]; kinds?: ChunkKind[] }) => inv<SearchHit[]>('search', q, filter),
  chatHistory: () => inv<ChatMessage[]>('chat:history'),
  clearChat: () => inv<void>('chat:clear'),
  ask: (requestId: string, q: string, scope: ChatScope, history: ChatMessage[], persist: boolean) =>
    inv<{ answer: string; citations: Citation[] }>('chat:ask', requestId, q, scope, history, persist),
  open: (p: string) => inv<string>('shell:open', p),
  reveal: (p: string) => inv<void>('shell:reveal', p),
  overlay: (color: string, symbol: string) => inv<void>('window:overlay', color, symbol),
  hardware: () => inv<HardwareInfo>('hardware:detect'),
  applyPreset: (id: PresetId) => inv<Settings>('presets:apply', id),
  secretStatus: () => inv<Record<UserSecret, boolean>>('secrets:status'),
  setSecret: (name: UserSecret, value: string) => inv<Record<UserSecret, boolean>>('secrets:set', name, value),
  setupInfo: () => inv<{ googleBuiltIn: boolean; msBuiltIn: boolean; userName: string }>('setup:info'),
  /** null when the key works, otherwise a message for the user */
  checkGeminiKey: (key: string) => inv<string | null>('gemini:check', key),
  renameSpeaker: (id: string, speakerId: string, name: string) => inv<Meeting>('meetings:renameSpeaker', id, speakerId, name),
  followUp: (id: string, language: string, tone: 'formal' | 'friendly') => inv<string>('meetings:followup', id, language, tone),
  i18nCatalog: (lang: string) => inv<Record<string, string>>('i18n:catalog', lang),
  translate: (lang: string, texts: string[]) => inv<string[]>('i18n:translate', lang, texts),
  translateNotes: (id: string, language: string) => inv<string>('meetings:translate', id, language),
  segmentAudio: (id: string, startMs: number, channel: string) => inv<Uint8Array | null>('meetings:audio', id, startMs, channel),
  exportMeeting: (id: string) => inv<boolean>('meetings:export', id),
  googleStatus: (probe = false) => inv<GoogleStatus>('google:status', probe),
  connectGoogle: () => inv<GoogleStatus>('google:connect'),
  disconnectGoogle: () => inv<GoogleStatus>('google:disconnect'),
  calendar: () => inv<CalEvent[]>('calendar:list'),
  syncCalendar: () => inv<CalEvent[]>('calendar:sync'),
  memoryCount: () => inv<number>('memory:count'),
  clearMemory: () => inv<number>('memory:clear'),
  openExternal: (url: string) => inv<void>('shell:external', url),
  // desktop pet
  petGet: () => inv<{ config: PetConfig; progress: PetProgress }>('pet:get'),
  petSet: (p: Partial<PetConfig>) => inv<PetConfig>('pet:set', p),
  petPetted: () => inv<void>('pet:petted'),
  petFeedback: (topic: Topic, liked: boolean) => inv<void>('pet:feedback', topic, liked),
  petBriefed: () => inv<void>('pet:briefed'),
  petMenu: () => inv<void>('pet:menu'),
  petOpen: (page: string, meetingId?: string) => inv<void>('pet:open', page, meetingId),
  petJoinNotes: (event: CalEvent) => inv<void>('pet:joinNotes', event),
  petShow: () => inv<void>('pet:show'),
  petListen: () => inv<void>('pet:listen'),
  petStop: () => inv<void>('pet:stop'),
  petVoiceAsk: (wav: ArrayBuffer) => inv<{ question: string; answer: string }>('pet:voiceAsk', wav),
  slideImage: (meetingId: string, slideId: string) => inv<string | null>('slides:image', meetingId, slideId),
  deleteSlide: (meetingId: string, slideId: string) => inv<Slide[]>('slides:delete', meetingId, slideId),
  msStatus: () => inv<{ configured: boolean; connected: boolean; email?: string; actionsNeedReconnect: boolean }>('ms:status'),
  msConnect: () => inv<{ configured: boolean; connected: boolean; email?: string; actionsNeedReconnect: boolean }>('ms:connect'),
  msDisconnect: () => inv<{ configured: boolean; connected: boolean; email?: string; actionsNeedReconnect: boolean }>('ms:disconnect'),
  msDraft: (p: { to: string[]; subject: string; body: string }) => inv<{ url: string }>('msactions:draft', p),
  msTasks: (items: { title: string; notes?: string; due?: string | null }[]) => inv<{ added: number; url: string }>('msactions:tasks', items),
  msEvent: (p: { title: string; start: number; minutes: number; attendees: string[]; description?: string; meet: boolean }) => inv<{ url: string }>('msactions:event', p),
  people: () => inv<PersonCard[]>('people:list'),
  summarizePerson: (key: string) => inv<PersonCard | null>('people:summarize', key),
  recap: (offsetWeeks = 0) => inv<Recap>('recap:get', offsetWeeks),
  savePng: (dataUrl: string, name: string) => inv<boolean>('file:savePng', dataUrl, name),
  copyImage: async (dataUrl: string): Promise<void> => {
    const blob = await (await fetch(dataUrl)).blob()
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  },
  captionsToggle: (open?: boolean) => inv<void>('captions:toggle', open),
  captionsIsOpen: () => inv<boolean>('captions:isOpen'),
  captionsTranslate: (text: string) => inv<string>('captions:translate', text),
  captionsSetLanguage: (lang: string) => inv<void>('captions:setLanguage', lang),
  petResetPosition: () => inv<void>('pet:resetPosition'),
  petSay: (line: PetLine) => inv<void>('pet:say', line),
  petSmart: (ctx: { meetingsLeft: number; nextInMin: number | null; hour: number; weekday: string }) => inv<string>('pet:smart', ctx),
  addPath: (path: string) => inv<{ ok: boolean; name: string }>('sources:addPath', path),
  // briefs, promises, Google actions
  briefGet: (key: string) => inv<Brief | null>('brief:get', key),
  briefGenerate: (e: CalEvent) => inv<Brief>('brief:generate', e),
  commitments: () => inv<Commitment[]>('commitments:list'),
  updateCommitment: (id: string, patch: Partial<Commitment>) => inv<Commitment[]>('commitments:update', id, patch),
  extractCommitments: (meetingId: string) => inv<Commitment[]>('commitments:extract', meetingId),
  gDraft: (p: { to: string[]; subject: string; body: string }) => inv<{ url: string }>('gactions:draft', p),
  gTasks: (items: { title: string; notes?: string; due?: string | null }[]) => inv<{ added: number; url: string }>('gactions:tasks', items),
  gEvent: (p: { title: string; start: number; minutes: number; attendees: string[]; description?: string; meet: boolean }) => inv<{ url: string }>('gactions:event', p),
  // team pets
  teamStatus: () => inv<TeamStatus>('team:status'),
  teamJoin: () => inv<TeamStatus>('team:join'),
  teamLeave: () => inv<TeamStatus>('team:leave'),
  teamFindTime: (ids: string[], minutes: number) => inv<Busy[]>('team:findTime', ids, minutes),
  teamBook: (p: { ids: string[]; title: string; start: number; minutes: number }) => inv<{ via: TeamStatus['booking']; url?: string }>('team:book', p),
  teamSendNotes: (meetingId: string, ids: string[]) => inv<number>('team:sendNotes', meetingId, ids),
  teamWave: (id: string) => inv<void>('team:wave', id),
  teamStandup: () => inv<Standup>('team:standup'),
  teamPostStandup: (p: { done: string[]; today: string[] }) => inv<Standup>('team:postStandup', p),
  teamPingStandup: () => inv<number>('team:pingStandup'),
  visitorGet: () => inv<{ visit: Visit | null; pet: Visit['pet']; dir: number } | null>('visitor:get'),
  visitorAct: (actionId: string) => inv<void>('visitor:act', actionId)
}
export type Standup = { date: string; suggestion: { done: string[]; today: string[] }; entries: StandupEntry[] }

export const cleanError = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function useEvent<K extends keyof MainEvents>(ch: K, cb: (p: MainEvents[K]) => void, deps: unknown[] = []): void {
  useEffect(() => window.insight.on(ch, cb), deps) // eslint-disable-line react-hooks/exhaustive-deps
}

export const fmtTime = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export const fmtBytes = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.max(0, Math.round(n / 1e3))} KB`
