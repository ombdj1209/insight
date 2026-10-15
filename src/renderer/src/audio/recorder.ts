import type { Channel } from '../../../shared/types'

const SR = 16000
const FRAME = 480 // 30 ms
const FRAME_MS = 30
const PREROLL = 10 // frames (300 ms)
const HANGOVER = 34 // frames of silence that end a segment (~1 s; Japanese has short mid-sentence pauses)
const MIN_SPEECH = 8 // frames (~240 ms) so short replies like "はい" are kept
const MAX_FRAMES = Math.floor(15_000 / FRAME_MS) // shorter chunks = faster lines and better ASR accuracy
const ABS_GATE = -58 // dBFS; quiet or distant voices still pass
const DYN_RANGE = 22 // dB below the recent speech level that still counts as speech

export class Vad {
  floor = -60
  peak = -100 // recent speech level (smoothed, decays slowly)
  smooth = -100
  speaking = false
  silence = 0
  speechFrames = 0
  frames: Float32Array[] = []
  energies: number[] = []
  pre: Float32Array[] = []
  startMs = 0
  level = 0

  constructor(
    private channel: Channel,
    private emit: (ch: Channel, pcm: Float32Array, startMs: number, endMs: number) => void
  ) {}

  push(frame: Float32Array, nowMs: number): void {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / frame.length)
    const db = 20 * Math.log10(rms + 1e-9)
    this.level = this.level * 0.7 + Math.min(1, rms * 8) * 0.3
    // minimum-statistics style floor: drops fast, rises slowly
    this.floor = db < this.floor ? db : this.floor + 0.015
    // track the recent speech level so room noise between sentences is treated as silence
    this.smooth = this.smooth * 0.8 + db * 0.2
    this.peak = this.smooth > this.peak ? this.smooth : this.peak - 0.05
    const isSpeech = db > ABS_GATE && db > this.floor + 9 && db > this.peak - DYN_RANGE

    if (!this.speaking) {
      this.pre.push(frame)
      if (this.pre.length > PREROLL) this.pre.shift()
      if (isSpeech) {
        this.speaking = true
        this.frames = [...this.pre]
        this.energies = this.pre.map(() => -100)
        this.startMs = nowMs - this.pre.length * FRAME_MS
        this.pre = []
        this.silence = 0
        this.speechFrames = 1
      }
      return
    }
    this.frames.push(frame)
    this.energies.push(db)
    if (isSpeech) {
      this.silence = 0
      this.speechFrames++
    } else this.silence++

    if (this.silence >= HANGOVER) this.flush(nowMs, this.frames.length - Math.floor(HANGOVER / 2))
    else if (this.frames.length >= MAX_FRAMES) {
      // cut at the quietest frame in the last 3 s so we don't split words
      const from = this.frames.length - 100
      let cut = this.frames.length
      let min = Infinity
      for (let i = from; i < this.frames.length; i++)
        if (this.energies[i] < min) {
          min = this.energies[i]
          cut = i
        }
      this.flush(nowMs, cut, true)
    }
  }

  private flush(nowMs: number, cutAt: number, carry = false): void {
    const keep = this.frames.slice(0, cutAt)
    const rest = this.frames.slice(cutAt)
    const restE = this.energies.slice(cutAt)
    const endMs = this.startMs + keep.length * FRAME_MS
    if (this.speechFrames >= MIN_SPEECH && keep.length) {
      const pcm = new Float32Array(keep.length * FRAME)
      keep.forEach((f, i) => pcm.set(f, i * FRAME))
      this.emit(this.channel, pcm, Math.max(0, this.startMs), endMs)
    }
    if (carry) {
      this.frames = rest
      this.energies = restE
      this.startMs = endMs
      this.speechFrames = rest.length
      this.silence = 0
    } else {
      this.speaking = false
      this.frames = []
      this.energies = []
      this.speechFrames = 0
      this.silence = 0
    }
    void nowMs
  }

  end(nowMs: number): void {
    if (this.speaking && this.frames.length) this.flush(nowMs, this.frames.length)
  }
}

export function encodeWav(pcm: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string): void => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, SR, true)
  v.setUint32(28, SR * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.length * 2, true)
  // light peak normalisation helps quiet loopback audio
  let peak = 0
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]))
  const gain = peak > 0 && peak < 0.5 ? Math.min(4, 0.7 / peak) : 1
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i] * gain)) * 0x7fff, true)
  return buf
}

export interface RecorderState {
  meetingId: string | null
  recording: boolean
  paused: boolean
  elapsedMs: number
  levels: { mic: number; system: number }
  systemAudio: boolean
  error?: string
}

type Listener = (s: RecorderState) => void

/**
 * Watches the shared-screen video track for new slides: compares tiny grayscale thumbnails every 3 s and saves a
 * full frame once a change has stayed stable for one more sample (so animations and scrolling don't flood it).
 */
class SlideWatcher {
  private video = document.createElement('video')
  private small = document.createElement('canvas')
  private timer: number | undefined
  private saved: Uint8Array | null = null
  private prev: Uint8Array | null = null
  private lastAt = 0
  private count = 0
  constructor(
    private track: MediaStreamTrack,
    private onSlide: (jpeg: ArrayBuffer) => void
  ) {
    this.small.width = 48
    this.small.height = 27
  }
  start(): void {
    void this.track.applyConstraints({ frameRate: { max: 2 } }).catch(() => undefined)
    this.video.muted = true
    this.video.srcObject = new MediaStream([this.track])
    void this.video.play().catch(() => undefined)
    this.timer = window.setInterval(() => this.sample(), 3000)
  }
  private sig(): Uint8Array | null {
    const c = this.small.getContext('2d', { willReadFrequently: true })
    if (!c || this.video.readyState < 2) return null
    c.drawImage(this.video, 0, 0, 48, 27)
    const d = c.getImageData(0, 0, 48, 27).data
    const g = new Uint8Array(48 * 27)
    for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0
    return g
  }
  private static diff(a: Uint8Array, b: Uint8Array): number {
    let s = 0
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
    return s / a.length
  }
  private sample(): void {
    const s = this.sig()
    if (!s) return
    const stable = this.prev && SlideWatcher.diff(s, this.prev) < 4
    const changed = !this.saved || SlideWatcher.diff(s, this.saved) > 10
    if (stable && changed && Date.now() - this.lastAt > 8000 && this.count < 80) {
      this.saved = s
      this.lastAt = Date.now()
      this.count++
      this.capture()
    }
    this.prev = s
  }
  private capture(): void {
    const w = Math.min(1600, this.video.videoWidth || 1600)
    const h = Math.round((w * (this.video.videoHeight || 900)) / (this.video.videoWidth || 1600))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')?.drawImage(this.video, 0, 0, w, h)
    c.toBlob((b) => void b?.arrayBuffer().then(this.onSlide), 'image/jpeg', 0.82)
  }
  stop(): void {
    window.clearInterval(this.timer)
    this.track.stop()
    this.video.srcObject = null
  }
}

class Recorder {
  private ctx: AudioContext | null = null
  private streams: MediaStream[] = []
  private vads: Partial<Record<Channel, Vad>> = {}
  private t0 = 0
  private offsetMs = 0
  private pausedAt = 0
  private pausedTotal = 0
  private timer: number | undefined
  private listeners = new Set<Listener>()
  private slides: SlideWatcher | null = null
  state: RecorderState = { meetingId: null, recording: false, paused: false, elapsedMs: 0, levels: { mic: 0, system: 0 }, systemAudio: false }

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    l(this.state)
    return () => this.listeners.delete(l)
  }
  private set(p: Partial<RecorderState>): void {
    this.state = { ...this.state, ...p }
    this.listeners.forEach((l) => l(this.state))
  }
  private now(): number {
    return this.offsetMs + (performance.now() - this.t0 - this.pausedTotal)
  }

  private onSegment = (ch: Channel, pcm: Float32Array, startMs: number, endMs: number): void => {
    if (!this.state.meetingId) return
    window.insight.sendSegment({ meetingId: this.state.meetingId, channel: ch, startMs, endMs, wav: encodeWav(pcm) })
  }

  async start(meetingId: string, opts: { micDeviceId: string; captureSystem: boolean; offsetMs: number; captureSlides?: boolean }): Promise<void> {
    if (this.state.recording) await this.stop()
    const ctx = new AudioContext({ sampleRate: SR })
    await ctx.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).href)
    const sink = ctx.createGain()
    sink.gain.value = 0
    sink.connect(ctx.destination)

    const attach = (stream: MediaStream, ch: Channel): void => {
      const src = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'pcm-framer')
      const vad = new Vad(ch, this.onSegment)
      this.vads[ch] = vad
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!this.state.paused) vad.push(e.data, this.now())
      }
      src.connect(node)
      node.connect(sink)
    }

    let systemAudio = false
    let error: string | undefined
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: opts.micDeviceId && opts.micDeviceId !== 'default' ? { exact: opts.micDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      })
      this.streams.push(mic)
      attach(mic, 'mic')
    } catch (e) {
      error = `Microphone unavailable: ${(e as Error).message}`
    }
    if (opts.captureSystem) {
      try {
        const disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        const video = disp.getVideoTracks()[0]
        // keep the screen track only when slide capture is on (opt-in); otherwise stop it right away
        if (opts.captureSlides && video) {
          this.slides = new SlideWatcher(video, (jpeg) => void window.insight.invoke('slides:add', meetingId, this.now(), jpeg))
          this.slides.start()
        }
        disp.getVideoTracks().forEach((t) => t !== video || !opts.captureSlides ? t.stop() : undefined)
        if (disp.getAudioTracks().length) {
          const audioOnly = new MediaStream(disp.getAudioTracks())
          this.streams.push(disp, audioOnly)
          attach(audioOnly, 'system')
          systemAudio = true
        }
      } catch (e) {
        error = `${error ? error + '. ' : ''}System audio unavailable: ${(e as Error).message}`
      }
    }
    if (!this.streams.length) {
      await ctx.close()
      throw new Error(error ?? 'No audio source available')
    }
    this.ctx = ctx
    this.t0 = performance.now()
    this.offsetMs = opts.offsetMs
    this.pausedTotal = 0
    this.set({ meetingId, recording: true, paused: false, elapsedMs: opts.offsetMs, systemAudio, error })
    this.timer = window.setInterval(() => {
      this.set({
        elapsedMs: this.state.paused ? this.state.elapsedMs : this.now(),
        levels: { mic: this.vads.mic?.level ?? 0, system: this.vads.system?.level ?? 0 }
      })
    }, 80)
  }

  pause(): void {
    if (!this.state.recording || this.state.paused) return
    const t = this.now()
    Object.values(this.vads).forEach((v) => v?.end(t))
    this.pausedAt = performance.now()
    this.set({ paused: true })
  }

  resume(): void {
    if (!this.state.paused) return
    this.pausedTotal += performance.now() - this.pausedAt
    this.set({ paused: false })
  }

  async stop(): Promise<{ meetingId: string | null; durationMs: number }> {
    const t = this.now()
    Object.values(this.vads).forEach((v) => v?.end(t))
    window.clearInterval(this.timer)
    this.slides?.stop()
    this.slides = null
    this.streams.forEach((s) => s.getTracks().forEach((tr) => tr.stop()))
    this.streams = []
    this.vads = {}
    await this.ctx?.close().catch(() => undefined)
    this.ctx = null
    const meetingId = this.state.meetingId
    this.set({ meetingId: null, recording: false, paused: false, levels: { mic: 0, system: 0 } })
    return { meetingId, durationMs: t }
  }
}

export const recorder = new Recorder()
