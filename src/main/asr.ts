import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { OfflineRecognizer } from 'sherpa-onnx-node'
import type { AsrEngine, SherpaModel } from '../shared/types'
import { resolveAsrEngine } from '../shared/engines'
import { findLang, languageCode, promptLanguage } from '../shared/languages'
import { manifest } from './downloader'
import { chat } from './llm'
import { baseUrl, ensureRuntime, isReady } from './runtime'
import { getSecret } from './secrets'
import { getSettings } from './settings'

type SherpaModule = typeof import('sherpa-onnx-node')
let sherpaMod: Promise<SherpaModule> | null = null
export const loadSherpa = (): Promise<SherpaModule> =>
  (sherpaMod ??= import('sherpa-onnx-node').then((m) => ((m as unknown as { default?: SherpaModule }).default ?? m) as SherpaModule))

const recognizers = new Map<string, Promise<OfflineRecognizer>>()

function onnx(dir: string, prefix: string): string {
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.onnx'))
  const pick = files.find((f) => f.includes('int8')) ?? files[0]
  if (!pick) throw new Error(`No ${prefix}*.onnx in ${dir}`)
  return join(dir, pick)
}

const SENSEVOICE_LANGS = ['zh', 'en', 'ja', 'ko', 'yue']

function recognizer(model: SherpaModel): Promise<OfflineRecognizer> {
  const s = getSettings()
  const dir = manifest().sherpa?.[model]
  if (!dir || !existsSync(dir)) throw new Error(`${model} is not installed. Open Setup.`)
  const code = languageCode(s.language)
  const key = `${model}|${s.sherpaThreads}|${code}`
  let r = recognizers.get(key)
  if (!r) {
    const tokens = join(dir, 'tokens.txt')
    const modelConfig: Record<string, unknown> = { tokens, numThreads: s.sherpaThreads, provider: 'cpu', debug: 0 }
    if (model === 'sensevoice') {
      modelConfig.senseVoice = { model: onnx(dir, 'model'), language: SENSEVOICE_LANGS.includes(code) ? code : '', useInverseTextNormalization: 1 }
    } else {
      modelConfig.transducer = { encoder: onnx(dir, 'encoder'), decoder: onnx(dir, 'decoder'), joiner: onnx(dir, 'joiner') }
      if (model === 'parakeet') modelConfig.modelType = 'nemo_transducer'
    }
    r = loadSherpa().then((m) =>
      m.OfflineRecognizer.createAsync({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig,
        // beam search is noticeably more accurate for transducers (ReazonSpeech, Parakeet); SenseVoice is CTC-like and ignores it
        decodingMethod: model === 'sensevoice' ? 'greedy_search' : 'modified_beam_search',
        maxActivePaths: 4
      })
    )
    r.catch(() => recognizers.delete(key))
    recognizers.set(key, r)
  }
  return r
}

export const resetRecognizers = (): void => recognizers.clear()

/** Pull float samples out of a 16-bit PCM WAV. */
export function wavToFloat(wav: Buffer): Float32Array {
  let o = 12
  while (o + 8 <= wav.length) {
    const id = wav.toString('ascii', o, o + 4)
    const size = wav.readUInt32LE(o + 4)
    if (id === 'data') {
      const n = Math.floor(Math.min(size, wav.length - o - 8) / 2)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = wav.readInt16LE(o + 8 + i * 2) / 32768
      return out
    }
    o += 8 + size
  }
  return new Float32Array(0)
}

async function sherpaTranscribe(model: SherpaModel, wav: Buffer): Promise<string> {
  const rec = await recognizer(model)
  const stream = rec.createStream()
  stream.acceptWaveform({ samples: wavToFloat(wav), sampleRate: 16000 })
  const r = await rec.decodeAsync(stream)
  return (r.text ?? '').trim()
}

const NO_SPEECH = /^(\[?(no speech|silence|inaudible|music|blank_audio)\]?\.?|\(.*\))$/i

async function gemmaTranscribe(wav: Buffer, language: string): Promise<string> {
  const lang = promptLanguage(language)
  const text = await chat(
    [
      {
        role: 'user',
        content: [
          { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } },
          {
            type: 'text',
            // Prompt format from the Gemma 4 model card
            text: `Transcribe the following speech segment in ${lang} into ${lang} text.\n\nFollow these specific instructions for formatting the answer:\n* Only output the transcription, with no newlines.\n* When transcribing numbers, write the digits, i.e. write 1.7 and not one point seven, and write 3 instead of three.\n* If there is no speech, output nothing.`
          }
        ]
      }
    ],
    { temperature: 0, maxTokens: 512, local: true }
  )
  return text.replace(/^["“]|["”]$/g, '').trim()
}

async function whisperTranscribe(wav: Buffer): Promise<string> {
  if (!isReady('whisper')) await ensureRuntime()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'segment.wav')
  form.append('response_format', 'json')
  form.append('temperature', '0')
  const res = await fetch(`${baseUrl('whisper')}/inference`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Whisper request failed (HTTP ${res.status})`)
  const j = (await res.json()) as { text?: string }
  const t = (j.text ?? '').replace(/\s+/g, ' ').trim()
  return /^\[.*\]$/.test(t) ? '' : t
}

async function cloudTranscribe(wav: Buffer): Promise<string> {
  const s = getSettings()
  if (s.cloudAsrProvider === 'gemini') {
    const key = getSecret('gemini')
    if (!key) throw new Error('Add your Gemini API key in Settings > AI model.')
    const lang = promptLanguage(s.language)
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.cloudAsrModel)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: 'audio/wav', data: wav.toString('base64') } },
              { text: `Transcribe this ${lang} speech verbatim. Output only the transcription, one line, digits for numbers. Output nothing if there is no speech.` }
            ]
          }
        ],
        generationConfig: { temperature: 0 }
      })
    })
    if (!res.ok) throw new Error(`Gemini transcription failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`)
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
  }
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'segment.wav')
  form.append('model', s.cloudAsrModel)
  const code = languageCode(s.language)
  if (code) form.append('language', code)
  form.append('response_format', 'json')
  const key = getSecret('openai')
  const res = await fetch(`${s.openaiBaseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: form
  })
  if (!res.ok) throw new Error(`Transcription API failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`)
  return (((await res.json()) as { text?: string }).text ?? '').trim()
}

/** Pick the engine to use now: the configured one, or for Auto the best installed fallback. */
export function activeEngine(): Exclude<AsrEngine, 'auto'> {
  const s = getSettings()
  const engine = resolveAsrEngine(s)
  if (s.asrEngine !== 'auto') return engine
  const m = manifest()
  const has = (k: SherpaModel): boolean => !!m.sherpa?.[k] && existsSync(m.sherpa[k]!)
  const preferred = findLang(s.language).engines
  for (const e of preferred) if (has(e)) return e
  if (engine === 'whisper' && m.whisperModel && m.whisperRuntime) return 'whisper'
  for (const e of ['sensevoice', 'parakeet', 'reazonspeech'] as SherpaModel[]) if (has(e)) return e
  if (m.whisperModel && m.whisperRuntime) return 'whisper'
  if (m.llm?.mmproj) return 'gemma'
  throw new Error('No speech model installed. Open Setup and download one.')
}

export async function transcribe(wav: Buffer): Promise<{ text: string; engine: string }> {
  const engine = activeEngine()
  let text: string
  switch (engine) {
    case 'sensevoice':
    case 'parakeet':
    case 'reazonspeech':
      text = await sherpaTranscribe(engine, wav)
      break
    case 'whisper':
      text = await whisperTranscribe(wav)
      break
    case 'gemma':
      text = await gemmaTranscribe(wav, getSettings().language)
      break
    case 'cloud':
      text = await cloudTranscribe(wav)
      break
  }
  text = text.replace(/\s+/g, ' ').trim()
  return { text: NO_SPEECH.test(text) ? '' : text, engine }
}

/** Load the speech model ahead of the first segment so the first line is not delayed. */
export async function warmAsr(): Promise<void> {
  try {
    const e = activeEngine()
    if (e === 'sensevoice' || e === 'parakeet' || e === 'reazonspeech') await recognizer(e)
  } catch {
    /* reported when the first segment fails */
  }
}
