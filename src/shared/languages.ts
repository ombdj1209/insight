import type { SherpaModel } from './types'

export interface Lang {
  name: string
  code: string
  /** Local engines that handle this language, best first. Empty = Whisper (99 languages) or cloud. */
  engines: SherpaModel[]
}

// Parakeet TDT 0.6B v3 covers 25 European languages; SenseVoice covers zh/en/ja/ko/yue.
const EU: SherpaModel[] = ['parakeet']
const W: SherpaModel[] = [] // Whisper or a cloud engine

/** Meeting (spoken) languages. */
export const LANGUAGES: Lang[] = [
  { name: 'Auto (detect)', code: '', engines: ['sensevoice', 'parakeet'] },
  { name: 'English', code: 'en', engines: ['parakeet', 'sensevoice'] },
  // ReazonSpeech is far more accurate on Japanese; SenseVoice drops kana and drifts into Chinese
  { name: 'Japanese', code: 'ja', engines: ['reazonspeech', 'sensevoice'] },
  { name: 'Japanese + English', code: '', engines: ['sensevoice'] },
  { name: 'Chinese', code: 'zh', engines: ['sensevoice'] },
  { name: 'Cantonese', code: 'yue', engines: ['sensevoice'] },
  { name: 'Korean', code: 'ko', engines: ['sensevoice'] },
  { name: 'Spanish', code: 'es', engines: EU },
  { name: 'French', code: 'fr', engines: EU },
  { name: 'German', code: 'de', engines: EU },
  { name: 'Italian', code: 'it', engines: EU },
  { name: 'Portuguese', code: 'pt', engines: EU },
  { name: 'Dutch', code: 'nl', engines: EU },
  { name: 'Russian', code: 'ru', engines: EU },
  { name: 'Ukrainian', code: 'uk', engines: EU },
  { name: 'Polish', code: 'pl', engines: EU },
  { name: 'Czech', code: 'cs', engines: EU },
  { name: 'Slovak', code: 'sk', engines: EU },
  { name: 'Slovenian', code: 'sl', engines: EU },
  { name: 'Croatian', code: 'hr', engines: EU },
  { name: 'Bulgarian', code: 'bg', engines: EU },
  { name: 'Romanian', code: 'ro', engines: EU },
  { name: 'Hungarian', code: 'hu', engines: EU },
  { name: 'Greek', code: 'el', engines: EU },
  { name: 'Swedish', code: 'sv', engines: EU },
  { name: 'Danish', code: 'da', engines: EU },
  { name: 'Finnish', code: 'fi', engines: EU },
  { name: 'Estonian', code: 'et', engines: EU },
  { name: 'Latvian', code: 'lv', engines: EU },
  { name: 'Lithuanian', code: 'lt', engines: EU },
  { name: 'Maltese', code: 'mt', engines: EU },
  { name: 'Norwegian', code: 'no', engines: W },
  { name: 'Turkish', code: 'tr', engines: W },
  { name: 'Arabic', code: 'ar', engines: W },
  { name: 'Hebrew', code: 'he', engines: W },
  { name: 'Persian', code: 'fa', engines: W },
  { name: 'Hindi', code: 'hi', engines: W },
  { name: 'Bengali', code: 'bn', engines: W },
  { name: 'Urdu', code: 'ur', engines: W },
  { name: 'Marathi', code: 'mr', engines: W },
  { name: 'Gujarati', code: 'gu', engines: W },
  { name: 'Punjabi', code: 'pa', engines: W },
  { name: 'Tamil', code: 'ta', engines: W },
  { name: 'Telugu', code: 'te', engines: W },
  { name: 'Kannada', code: 'kn', engines: W },
  { name: 'Malayalam', code: 'ml', engines: W },
  { name: 'Thai', code: 'th', engines: W },
  { name: 'Vietnamese', code: 'vi', engines: W },
  { name: 'Indonesian', code: 'id', engines: W },
  { name: 'Malay', code: 'ms', engines: W },
  { name: 'Filipino', code: 'tl', engines: W },
  { name: 'Swahili', code: 'sw', engines: W }
]

export const findLang = (name: string): Lang => LANGUAGES.find((l) => l.name === name) ?? LANGUAGES[0]
export const languageCode = (name: string): string => findLang(name).code
/** Name the model understands in prompts (Gemma / cloud). */
export const promptLanguage = (name: string): string =>
  name.startsWith('Auto') ? 'the spoken language' : name === 'Japanese + English' ? 'Japanese and English (keep each word in its original language)' : name

/** Written languages for the interface, translations, captions and the pet. `native` is shown in pickers. */
export interface WorldLang {
  name: string // English name, used in prompts and settings
  native: string
  locale: string // BCP 47, for dates and numbers
  rtl?: boolean
}
export const WORLD: WorldLang[] = [
  { name: 'English', native: 'English', locale: 'en' },
  { name: 'Japanese', native: '日本語', locale: 'ja' },
  { name: 'Chinese (Simplified)', native: '简体中文', locale: 'zh-CN' },
  { name: 'Chinese (Traditional)', native: '繁體中文', locale: 'zh-TW' },
  { name: 'Korean', native: '한국어', locale: 'ko' },
  { name: 'Hindi', native: 'हिन्दी', locale: 'hi' },
  { name: 'Bengali', native: 'বাংলা', locale: 'bn' },
  { name: 'Tamil', native: 'தமிழ்', locale: 'ta' },
  { name: 'Telugu', native: 'తెలుగు', locale: 'te' },
  { name: 'Kannada', native: 'ಕನ್ನಡ', locale: 'kn' },
  { name: 'Marathi', native: 'मराठी', locale: 'mr' },
  { name: 'Urdu', native: 'اردو', locale: 'ur', rtl: true },
  { name: 'Arabic', native: 'العربية', locale: 'ar', rtl: true },
  { name: 'Hebrew', native: 'עברית', locale: 'he', rtl: true },
  { name: 'Persian', native: 'فارسی', locale: 'fa', rtl: true },
  { name: 'Turkish', native: 'Türkçe', locale: 'tr' },
  { name: 'Spanish', native: 'Español', locale: 'es' },
  { name: 'French', native: 'Français', locale: 'fr' },
  { name: 'German', native: 'Deutsch', locale: 'de' },
  { name: 'Italian', native: 'Italiano', locale: 'it' },
  { name: 'Portuguese', native: 'Português', locale: 'pt' },
  { name: 'Dutch', native: 'Nederlands', locale: 'nl' },
  { name: 'Russian', native: 'Русский', locale: 'ru' },
  { name: 'Ukrainian', native: 'Українська', locale: 'uk' },
  { name: 'Polish', native: 'Polski', locale: 'pl' },
  { name: 'Czech', native: 'Čeština', locale: 'cs' },
  { name: 'Greek', native: 'Ελληνικά', locale: 'el' },
  { name: 'Swedish', native: 'Svenska', locale: 'sv' },
  { name: 'Danish', native: 'Dansk', locale: 'da' },
  { name: 'Norwegian', native: 'Norsk', locale: 'nb' },
  { name: 'Finnish', native: 'Suomi', locale: 'fi' },
  { name: 'Romanian', native: 'Română', locale: 'ro' },
  { name: 'Hungarian', native: 'Magyar', locale: 'hu' },
  { name: 'Thai', native: 'ไทย', locale: 'th' },
  { name: 'Vietnamese', native: 'Tiếng Việt', locale: 'vi' },
  { name: 'Indonesian', native: 'Bahasa Indonesia', locale: 'id' },
  { name: 'Malay', native: 'Bahasa Melayu', locale: 'ms' },
  { name: 'Filipino', native: 'Filipino', locale: 'fil' },
  { name: 'Swahili', native: 'Kiswahili', locale: 'sw' }
]
export const findWorld = (name: string): WorldLang => WORLD.find((l) => l.name === name) ?? WORLD[0]

/** Best written language for a BCP 47 locale such as "ja-JP" or "pt-BR". */
export function worldFromLocale(locale: string): WorldLang {
  const l = locale.toLowerCase()
  if (l.startsWith('zh')) return findWorld(/tw|hk|hant/.test(l) ? 'Chinese (Traditional)' : 'Chinese (Simplified)')
  if (l.startsWith('nb') || l.startsWith('nn') || l.startsWith('no')) return findWorld('Norwegian')
  return WORLD.find((w) => l.startsWith(w.locale.toLowerCase())) ?? WORLD[0]
}

/** Written language that matches a meeting (spoken) language, for follow-ups and notes. */
export function writtenFor(meetingLanguage: string): string {
  if (meetingLanguage === 'Chinese' || meetingLanguage === 'Cantonese') return 'Chinese (Simplified)'
  if (meetingLanguage.startsWith('Auto') || meetingLanguage === 'Japanese + English') return 'English'
  return WORLD.some((w) => w.name === meetingLanguage) ? meetingLanguage : 'English'
}
