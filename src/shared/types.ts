import type { CalEvent, GoogleService, GoogleStatus, Person } from './google'
import type { PetConfig, PetLine, PetProgress } from './pet'
import type { TeamStatus, Visit } from './team'

export type Channel = 'mic' | 'system'
export type GpuBackend = 'cuda' | 'vulkan' | 'cpu'
/** Speech recognition engines. 'auto' picks the best installed local engine for the meeting language. */
export type AsrEngine = 'auto' | 'sensevoice' | 'parakeet' | 'reazonspeech' | 'whisper' | 'gemma' | 'cloud'
export type SherpaModel = 'sensevoice' | 'parakeet' | 'reazonspeech'
export type LlmModelId = 'gemma-4-E2B' | 'gemma-4-E4B' | 'gemma-4-E4B-Q4'
/** Where notes, chat and Live Assistance answers are generated. */
export type AiProvider = 'local' | 'gemini' | 'openai'
export type CloudAsrProvider = 'gemini' | 'openai'
export type PresetId = 'light' | 'balanced' | 'full' | 'cloud' | 'custom'
export type SecretName = 'gemini' | 'openai' | 'googleClientSecret' | 'googleToken' | 'msToken'
/** Secrets the user types in; the OAuth token is managed by the main process only. */
export type UserSecret = Exclude<SecretName, 'googleToken' | 'msToken'>

export interface Settings {
  preset: PresetId
  userName: string
  language: string
  // speech
  asrEngine: AsrEngine
  sherpaThreads: number
  whisperModel: 'large-v3-turbo' | 'base'
  cloudAsrProvider: CloudAsrProvider
  cloudAsrModel: string
  diarization: boolean
  inRoomMode: boolean
  echoFilter: boolean
  captureSystemAudio: boolean
  micDeviceId: string
  // AI
  aiProvider: AiProvider
  geminiModel: string
  openaiBaseUrl: string
  openaiModel: string
  llmModel: LlmModelId
  gpuBackend: GpuBackend
  gpuLayers: number
  contextSize: number
  extraLlamaArgs: string
  // features
  liveAssist: boolean
  topicAssist: boolean
  liveAssistThreshold: number
  noteTemplate: string
  indexImages: boolean
  embedDims: 768 | 512 | 256 | 128
  retentionDays: number
  hotkey: string
  hfToken: string
  theme: 'system' | 'light' | 'dark'
  // Google account (MCP tools for Ask, calendar reminders)
  googleClientId: string
  googleServices: GoogleService[]
  rememberAnswers: boolean
  calendarSync: boolean
  reminderMinutes: number
  briefs: boolean
  briefMinutes: number
  googleActions: boolean
  promiseNudges: boolean
  // interface + captions
  uiLanguage: string // 'auto' or a WORLD language name
  captionsLanguage: string // '' = no translation
  captionsHotkey: string
  // pet voice, call detection, slides, recap
  voiceHotkey: string
  autoDetectCalls: boolean
  captureSlides: boolean
  weeklyRecap: boolean
  // Microsoft 365
  msClientId: string
  msTenant: string
  msActions: boolean
  /** finished the first-run welcome */
  onboarded: boolean
  /** team pets: a folder the team syncs (OneDrive, SharePoint, Google Drive, Dropbox, network share) */
  teamFolder: string
  teamMemberId: string
  /** share busy blocks (never titles) so teammates can find a time */
  teamShareBusy: boolean
  teamWorkStart: number
  teamWorkEnd: number
}

/** Something someone committed to in a meeting. isMe = the user. */
export interface Commitment {
  id: string
  meetingId: string
  meetingTitle: string
  isMe: boolean
  person: string // who committed (or, when isMe, who it is for)
  forPerson?: string
  email?: string // of the other person, from calendar attendees
  text: string
  due: string | null // yyyy-mm-dd
  quote?: string
  createdAt: number
  status: 'open' | 'done' | 'dismissed'
  doneAt?: number
  snoozeUntil?: number
  nudgedDay?: string
}

export interface Slide {
  id: string
  atMs: number
  file: string
  text: string
  status: 'reading' | 'ready' | 'failed'
}

export interface PersonCard {
  key: string // email, or name:<name>
  name: string
  email?: string
  meetings: { id: string; title: string; at: number }[]
  lastMet: number
  youOwe: number
  theyOwe: number
  summary?: string
  summaryAt?: number
}

export interface Recap {
  from: number
  to: number
  meetings: number
  totalMs: number
  talkShare: number | null // share of speaking time that was the user's
  promisesMade: number
  promisesKept: number
  waitingOn: number
  actionItems: number
  busiestDay: number | null // 0 = Monday
  longest: { id: string; title: string; minutes: number } | null
  couldBeEmail: { id: string; title: string; minutes: number }[]
  perDayMs: number[]
}

export interface Brief {
  key: string // eventId@start
  eventId: string
  title: string
  start: number
  md: string
  citations: Citation[]
  createdAt: number
}

export interface TranscriptLine {
  id: string
  channel: Channel
  speaker: string
  speakerId?: string
  startMs: number
  endMs: number
  text: string
  engine?: string
}

export interface Citation {
  n: number
  chunkId: string
  title: string
  path?: string
  loc?: string
  snippet: string
  kind: ChunkKind
  label?: string
  score: number
}

export interface AssistCard {
  id: string
  kind?: 'answer' | 'context'
  atMs: number
  question: string
  answer: string
  citations: Citation[]
}

export interface Meeting {
  id: string
  title: string
  createdAt: number
  durationMs: number
  notes: string
  enhanced: string
  transcript: TranscriptLine[]
  assist: AssistCard[]
  status: 'idle' | 'recording' | 'done'
  template?: string
  speakers?: Record<string, string>
  voiceprints?: Record<string, { v: number[]; n: number; channel: Channel }>
  followUp?: string
  translation?: { language: string; text: string }
  /** the calendar event this meeting belongs to (for attendees, briefs and follow-ups) */
  calendar?: { eventId: string; start: number; title: string; people: Person[] }
  slides?: Slide[]
  cloudUsed?: ('audio' | 'notes' | 'chat')[]
}

export type MeetingSummary = Pick<Meeting, 'id' | 'title' | 'createdAt' | 'durationMs' | 'status'> & {
  preview: string
}

export type SourceType = 'folder' | 'file' | 'calendar' | 'bookmarks'
export type ChunkKind = 'file' | 'image' | 'meeting' | 'calendar' | 'bookmark' | 'memory'

export interface KnowledgeSource {
  id: string
  type: SourceType
  path: string
  label: string
  addedAt: number
  fileCount: number
  chunkCount: number
  status: 'queued' | 'indexing' | 'ready' | 'error'
  progress?: { done: number; total: number }
  error?: string
}

export interface SearchHit {
  chunkId: string
  title: string
  path?: string
  loc?: string
  text: string
  kind: ChunkKind
  label?: string
  sourceId: string
  score: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  createdAt: number
}

export interface ChatScope {
  labels?: string[]
  kinds?: ChunkKind[]
  meetingId?: string
}

export type ComponentId =
  | 'llamaRuntime'
  | 'llm'
  | 'embedder'
  | 'sensevoice'
  | 'parakeet'
  | 'reazonspeech'
  | 'speaker'
  | 'whisperRuntime'
  | 'whisperModel'

export interface ComponentStatus {
  id: ComponentId
  name: string
  description: string
  installed: boolean
  required: boolean
  sizeHint?: string
  downloading?: { received: number; total: number; file: string }
  error?: string
}

export interface RuntimeStatus {
  llm: 'stopped' | 'starting' | 'ready' | 'error' | 'cloud'
  embedder: 'stopped' | 'starting' | 'ready' | 'error'
  whisper: 'stopped' | 'starting' | 'ready' | 'error'
  asr: string
  message?: string
}

export interface GpuInfo {
  name: string
  vendor: 'nvidia' | 'amd' | 'intel' | 'other'
  vramMB: number
}

export interface HardwareInfo {
  gpus: GpuInfo[]
  ramGB: number
  cores: number
  recommended: PresetId
  reason: string
}

export interface SegmentPayload {
  meetingId: string
  channel: Channel
  startMs: number
  endMs: number
  wav: ArrayBuffer
}

/** Events pushed from main to renderer */
export interface MainEvents {
  'transcript:line': { meetingId: string; line: TranscriptLine }
  'transcript:remove': { meetingId: string; lineId: string }
  'transcript:update': { meetingId: string; transcript: TranscriptLine[]; speakers: Record<string, string> }
  'assist:card': { meetingId: string; card: AssistCard }
  'enhance:delta': { meetingId: string; text: string }
  'chat:delta': { requestId: string; text: string }
  /** What Ask is doing right now, e.g. "Searching Gmail" while a tool runs. */
  'chat:status': { requestId: string; text: string }
  'google:changed': GoogleStatus
  'calendar:changed': CalEvent[]
  'calendar:reminder': CalEvent
  // desktop pet
  'pet:config': PetConfig
  'pet:progress': PetProgress
  'pet:motion': { state: 'flying' | 'landed' | 'walking' | 'stopped' | 'carried' | 'bump'; dir?: number; speed?: number }
  /** commands for the pet window */
  'pet:cmd': { type: 'levelup'; level: number; unlocked: string[] } | { type: 'chat' } | { type: 'shoo' } | { type: 'back' } | { type: 'line'; line: PetLine } | { type: 'voice' } | { type: 'badge'; id: string; label: string; reward?: string }
  /** commands from the pet for the main window */
  'pet:command': { cmd: 'open'; page: string; meetingId?: string } | { cmd: 'joinNotes'; event: CalEvent } | { cmd: 'listen' } | { cmd: 'stop' }
  'meeting:state': { recording: boolean; meetingId: string; title: string; durationMs: number }
  'meeting:enhanced': { meetingId: string; title: string; actionItems: number }
  'brief:ready': { brief: Brief; event: CalEvent }
  'commitments:changed': Commitment[]
  'commitment:nudge': { c: Commitment; evidence?: string }
  'call:detected': { app: string }
  'call:ended': { app: string }
  'captions:state': { open: boolean }
  'captions:language': string
  'slides:changed': { meetingId: string; slides: Slide[] }
  'recap:ready': Recap
  'ms:changed': { configured: boolean; connected: boolean; email?: string; actionsNeedReconnect: boolean }
  'sources:changed': KnowledgeSource[]
  'components:changed': ComponentStatus[]
  'runtime:changed': RuntimeStatus
  'asr:busy': { pending: number }
  'hotkey:toggle': null
  // team pets
  'team:changed': TeamStatus
  /** a meeting was added outside the main window (notes shared by a teammate) */
  'meetings:changed': null
  /** for the visitor window: the visiting pet, its line and buttons (reply set after a button was pressed) */
  'visitor:show': Visit
  'visitor:motion': { state: 'walking' | 'stopped'; dir?: number }
  toast: { kind: 'info' | 'error'; message: string }
}

export const DEFAULT_SETTINGS: Settings = {
  preset: 'custom',
  userName: 'You',
  language: 'Japanese',
  asrEngine: 'auto',
  sherpaThreads: 4,
  whisperModel: 'large-v3-turbo',
  cloudAsrProvider: 'gemini',
  cloudAsrModel: 'gemini-flash-latest',
  diarization: true,
  inRoomMode: false,
  echoFilter: true,
  captureSystemAudio: true,
  micDeviceId: 'default',
  aiProvider: 'local',
  geminiModel: 'gemini-flash-latest',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  llmModel: 'gemma-4-E4B',
  gpuBackend: 'cuda',
  gpuLayers: 99,
  contextSize: 32768,
  extraLlamaArgs: '',
  liveAssist: true,
  topicAssist: true,
  liveAssistThreshold: 0.45,
  noteTemplate: 'general',
  indexImages: false,
  embedDims: 768,
  retentionDays: 0,
  hotkey: 'CommandOrControl+Shift+Space',
  hfToken: '',
  theme: 'system',
  googleClientId: '',
  googleServices: ['gmail', 'calendar', 'chat'],
  rememberAnswers: true,
  calendarSync: true,
  reminderMinutes: 5,
  briefs: true,
  briefMinutes: 10,
  googleActions: false,
  promiseNudges: true,
  uiLanguage: 'auto',
  captionsLanguage: '',
  captionsHotkey: 'CommandOrControl+Shift+L',
  voiceHotkey: 'CommandOrControl+Shift+K',
  autoDetectCalls: true,
  captureSlides: false,
  weeklyRecap: true,
  msClientId: '',
  msTenant: 'common',
  msActions: false,
  onboarded: false,
  teamFolder: '',
  teamMemberId: '',
  teamShareBusy: true,
  teamWorkStart: 9,
  teamWorkEnd: 18
}
