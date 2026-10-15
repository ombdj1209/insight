/** Desktop pet: customisation catalogue, defaults and progression. Shared by main, the pet window and the customiser. */

export type Species = 'blob' | 'cat' | 'fox' | 'bunny' | 'bear' | 'axolotl' | 'robot' | 'ghost' | 'dragon' | 'penguin'
export type Eyes = 'dots' | 'sparkle' | 'sleepy' | 'anime' | 'happy'
export type Pattern = 'none' | 'spots' | 'stripes' | 'belly'
export type HeadItem = 'none' | 'beanie' | 'cap' | 'bow' | 'flower' | 'crown' | 'party' | 'halo' | 'witch' | 'santa' | 'laurel'
export type FaceItem = 'none' | 'glasses' | 'sunglasses' | 'blush' | 'monocle'
export type NeckItem = 'none' | 'scarf' | 'bowtie' | 'bell' | 'bandana' | 'medal'
export type SoundPack = 'none' | 'chirp' | 'meow' | 'beep' | 'bloop'
export type Topic = 'facts' | 'jokes' | 'motivation'
export type Mood = 'stressed' | 'idle' | 'happy' | 'excited' | 'sleepy' | 'listening' | 'writing' | 'eating' | 'dance' | 'stretch' | 'carried' | 'flying' | 'walking' | 'sad'

export interface PetConfig {
  enabled: boolean
  name: string
  species: Species
  color: string
  accent: string
  pattern: Pattern
  eyes: Eyes
  head: HeadItem
  face: FaceItem
  neck: NeckItem
  size: number // 0.6 .. 1.6
  sound: SoundPack
  volume: number // 0..1
  energy: number // 0 calm .. 1 hyper
  chattiness: number // 0 quiet .. 1 chatty
  sassy: boolean
  topics: Record<Topic, boolean>
  smartLines: boolean // let the AI provider write personalised lines
  language: string // a WORLD language name; English and Japanese lines are built in, others are translated
  wander: boolean
  gravity: boolean
  hideFullscreen: boolean
  quietStart: number // hour 0-23, -1 = off
  quietEnd: number
}

export interface PetProgress {
  xp: number
  pets: number
  meetings: number
  lastBrief: string // yyyy-mm-dd
  likes: Record<Topic, number>
  dislikes: Record<Topic, number>
  x: number | null
  y: number | null
  petXpDay: string
  petXpToday: number
  badges: string[]
}

export const DEFAULT_PET: PetConfig = {
  enabled: true,
  name: 'Pip',
  species: 'blob',
  color: '#4285F4',
  accent: '#FFFFFF',
  pattern: 'none',
  eyes: 'sparkle',
  head: 'none',
  face: 'none',
  neck: 'none',
  size: 1,
  sound: 'chirp',
  volume: 0.35,
  energy: 0.5,
  chattiness: 0.5,
  sassy: false,
  topics: { facts: true, jokes: true, motivation: true },
  smartLines: false,
  language: 'English',
  wander: true,
  gravity: false,
  hideFullscreen: true,
  quietStart: 22,
  quietEnd: 8
}

export const DEFAULT_PROGRESS: PetProgress = {
  xp: 0,
  pets: 0,
  meetings: 0,
  lastBrief: '',
  likes: { facts: 0, jokes: 0, motivation: 0 },
  dislikes: { facts: 0, jokes: 0, motivation: 0 },
  x: null,
  y: null,
  petXpDay: '',
  petXpToday: 0,
  badges: []
}

export const SPECIES: { id: Species; label: string; color: string; accent: string }[] = [
  { id: 'blob', label: 'Blob', color: '#4285F4', accent: '#FFFFFF' },
  { id: 'cat', label: 'Cat', color: '#F6AE2D', accent: '#FFF4DF' },
  { id: 'fox', label: 'Fox', color: '#F4733C', accent: '#FFF1E8' },
  { id: 'bunny', label: 'Bunny', color: '#EDE7F6', accent: '#F8BBD0' },
  { id: 'bear', label: 'Bear', color: '#A1887F', accent: '#EFEBE9' },
  { id: 'axolotl', label: 'Axolotl', color: '#F8A5C2', accent: '#FFE3EE' },
  { id: 'robot', label: 'Robot', color: '#90A4AE', accent: '#E3F2FD' },
  { id: 'ghost', label: 'Ghost', color: '#F5F5F5', accent: '#E1E5EA' },
  { id: 'dragon', label: 'Dragon', color: '#34A853', accent: '#D4F5DD' },
  { id: 'penguin', label: 'Penguin', color: '#37474F', accent: '#FFFFFF' }
]

export const PALETTE = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#A142F4', '#12B5CB', '#F4733C', '#F8A5C2', '#A1887F', '#90A4AE', '#37474F', '#F5F5F5', '#1F1F1F', '#7CB342']

/** Level needed to unlock an item (0 = from the start). Seasonal items are free while in season. */
export const UNLOCKS: Record<string, number> = {
  'head:beanie': 0,
  'head:cap': 0,
  'head:bow': 0,
  'head:flower': 1,
  'head:party': 2,
  'head:crown': 5,
  'head:halo': 4,
  'head:witch': 3,
  'head:santa': 3,
  'face:glasses': 0,
  'face:blush': 0,
  'face:sunglasses': 2,
  'face:monocle': 4,
  'neck:scarf': 0,
  'neck:bowtie': 1,
  'neck:bell': 2,
  'neck:bandana': 3,
  'eyes:anime': 1,
  'eyes:happy': 0,
  'pattern:spots': 1,
  'pattern:stripes': 2
}

/** Milestones from real use. Some unlock items that levels can't buy. */
export const BADGES: { id: string; label: string; desc: string; reward?: string }[] = [
  { id: 'first-meeting', label: 'First meeting', desc: 'Took notes in your first meeting' },
  { id: 'meetings-10', label: 'Regular', desc: '10 meetings together' },
  { id: 'meetings-50', label: 'Veteran', desc: '50 meetings together' },
  { id: 'meetings-100', label: 'Centurion', desc: '100 meetings together', reward: 'head:laurel' },
  { id: 'kept-10', label: 'Promise keeper', desc: 'Kept 10 promises', reward: 'neck:medal' },
  { id: 'kept-50', label: 'Action hero', desc: 'Kept 50 promises' },
  { id: 'inbox-zero', label: 'All clear', desc: 'Cleared every open promise' }
]
const BADGE_ITEMS: Record<string, string> = Object.fromEntries(BADGES.filter((b) => b.reward).map((b) => [b.reward!, b.id]))
export const badgeFor = (item: string): string | undefined => BADGE_ITEMS[item]

export function seasonal(id: string, d = new Date()): boolean {
  const m = d.getMonth() + 1
  return (id === 'head:witch' && m === 10) || (id === 'head:santa' && m === 12)
}
export const unlockLevel = (id: string): number => UNLOCKS[id] ?? 0
export const isUnlocked = (id: string, level: number, d = new Date(), badges: string[] = []): boolean =>
  BADGE_ITEMS[id] ? badges.includes(BADGE_ITEMS[id]) : seasonal(id, d) || level >= unlockLevel(id)

/** 100 XP for level 1, each next level needs 50 more */
export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 0, need = 100, rest = xp
  while (rest >= need) {
    rest -= need
    level++
    need += 50
  }
  return { level, into: rest, need }
}

/** A line the pet says, with optional action buttons. */
export interface PetAction {
  label: string
  cmd: 'join' | 'joinNotes' | 'openMeeting' | 'enhance' | 'openAsk' | 'like' | 'dismiss' | 'open' | 'brief' | 'promiseDone' | 'promiseSnooze' | 'listen' | 'stop'
  arg?: string
}
export interface PetLine {
  id: string
  text: string
  topic?: Topic
  mood?: Mood
  actions?: PetAction[]
  sticky?: boolean // stays until dismissed or it expires
  ttl?: number // ms
}
