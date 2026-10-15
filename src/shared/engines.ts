import { findLang } from './languages'
import type { AsrEngine, Settings, SherpaModel } from './types'

export const ENGINE_LABELS: Record<AsrEngine, string> = {
  auto: 'Auto (best for the language)',
  sensevoice: 'SenseVoice (Chinese/English/Korean; poor on Japanese)',
  parakeet: 'Parakeet v3 (25 European languages)',
  reazonspeech: 'ReazonSpeech (best for Japanese)',
  whisper: 'Whisper large-v3-turbo (99 languages)',
  gemma: 'Gemma 4 audio (GPU)',
  cloud: 'Cloud API (Gemini / OpenAI-compatible)'
}

/** Engine that 'auto' should use for this language. Falls back to Whisper for languages no sherpa model covers. */
export function autoEngine(language: string): SherpaModel | 'whisper' {
  const l = findLang(language)
  return l.engines[0] ?? 'whisper'
}

export function resolveAsrEngine(s: Pick<Settings, 'asrEngine' | 'language'>): Exclude<AsrEngine, 'auto'> {
  return s.asrEngine === 'auto' ? autoEngine(s.language) : s.asrEngine
}

/** Does the current configuration need the local Gemma server? */
export const needsLocalLlm = (s: Settings): boolean => s.aiProvider === 'local' || resolveAsrEngine(s) === 'gemma'
