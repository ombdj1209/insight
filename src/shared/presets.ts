import type { PresetId, Settings } from './types'

export interface Preset {
  id: PresetId
  label: string
  description: string
  settings: Partial<Settings>
}

export const PRESETS: Preset[] = [
  {
    id: 'light',
    label: 'Light',
    description: 'Any laptop, no GPU needed. Local speech recognition on CPU, notes and chat through the Gemini API. Search stays on this PC.',
    settings: { preset: 'light', gpuBackend: 'cpu', gpuLayers: 0, asrEngine: 'auto', aiProvider: 'gemini', llmModel: 'gemma-4-E2B', contextSize: 16384 }
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: '6-8 GB GPU. Local speech recognition plus Gemma 4 (smaller quant) for notes. Fully offline.',
    settings: { preset: 'balanced', asrEngine: 'auto', aiProvider: 'local', llmModel: 'gemma-4-E4B-Q4', gpuLayers: 99, contextSize: 16384 }
  },
  {
    id: 'full',
    label: 'Full offline',
    description: '10 GB+ GPU. Gemma 4 E4B Q8 for notes, chat and Live Assistance, best local speech engine per language. Fully offline.',
    settings: { preset: 'full', asrEngine: 'auto', aiProvider: 'local', llmModel: 'gemma-4-E4B', gpuLayers: 99, contextSize: 32768 }
  },
  {
    id: 'cloud',
    label: 'Cloud',
    description: 'Lowest local load. Audio and notes go to the Gemini API; search stays local. Needs internet and an API key.',
    settings: { preset: 'cloud', gpuBackend: 'cpu', gpuLayers: 0, asrEngine: 'cloud', cloudAsrProvider: 'gemini', aiProvider: 'gemini', contextSize: 16384 }
  }
]
