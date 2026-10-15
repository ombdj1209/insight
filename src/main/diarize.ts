import { existsSync } from 'fs'
import type { SpeakerEmbeddingExtractor } from 'sherpa-onnx-node'
import type { Channel, Meeting } from '../shared/types'
import { loadSherpa, wavToFloat } from './asr'
import { manifest } from './downloader'
import { getSettings } from './settings'

let extractor: Promise<SpeakerEmbeddingExtractor> | null = null
const lastSpeaker = new Map<string, string>() // `${meetingId}|${channel}` -> speaker id
const SAME = 0.5
const MAX_SPEAKERS = 10

function getExtractor(): Promise<SpeakerEmbeddingExtractor> | null {
  const file = manifest().speaker?.file
  if (!file || !existsSync(file)) return null
  extractor ??= loadSherpa().then((m) => new m.SpeakerEmbeddingExtractor({ model: file, numThreads: 2, debug: 0 }))
  extractor.catch(() => (extractor = null))
  return extractor
}

function unit(v: Float32Array | number[]): number[] {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return Array.from(v, (x) => x / n)
}

const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i], 0)

/**
 * Online speaker clustering: each segment's voiceprint joins the closest known speaker on the same
 * channel, or starts a new one. Returns the speaker id, or undefined when diarization does not apply.
 */
export async function assignSpeaker(m: Meeting, channel: Channel, wav: Buffer): Promise<string | undefined> {
  const s = getSettings()
  if (!s.diarization) return undefined
  if (channel === 'mic' && !s.inRoomMode) return undefined
  const ex = getExtractor()
  if (!ex) return undefined
  const key = `${m.id}|${channel}`
  const pcm = wavToFloat(wav)
  if (pcm.length < 16000 * 1.2) return lastSpeaker.get(key) // too short for a reliable voiceprint
  const e = await ex
  const stream = e.createStream()
  stream.acceptWaveform({ samples: pcm, sampleRate: 16000 })
  stream.inputFinished()
  if (!e.isReady(stream)) return lastSpeaker.get(key)
  const v = unit(e.compute(stream))

  m.voiceprints ??= {}
  m.speakers ??= {}
  let bestId: string | undefined
  let best = -1
  for (const [id, vp] of Object.entries(m.voiceprints)) {
    if (vp.channel !== channel) continue
    const sim = dot(vp.v, v)
    if (sim > best) {
      best = sim
      bestId = id
    }
  }
  const count = Object.keys(m.voiceprints).length
  if (bestId && (best >= SAME || count >= MAX_SPEAKERS)) {
    const vp = m.voiceprints[bestId]
    const w = Math.min(vp.n, 20)
    vp.v = unit(vp.v.map((x, i) => (x * w + v[i]) / (w + 1)))
    vp.n++
  } else {
    bestId = `S${count + 1}`
    m.voiceprints[bestId] = { v, n: 1, channel }
    const sameChannel = Object.values(m.voiceprints).filter((p) => p.channel === channel).length
    const others = Object.values(m.speakers).filter((n) => /^Speaker \d+$/.test(n)).length
    m.speakers[bestId] = channel === 'mic' && sameChannel === 1 ? s.userName || 'You' : `Speaker ${others + 1}`
  }
  lastSpeaker.set(key, bestId)
  return bestId
}

export async function warmDiarizer(): Promise<void> {
  if (getSettings().diarization) await getExtractor()?.catch(() => undefined)
}
