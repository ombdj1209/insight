import type { SoundPack } from '../../../shared/pet'

/** Tiny synthesised voice for the pet (no audio files). */
export type Cue = 'hello' | 'happy' | 'alert' | 'eat' | 'bump' | 'purr' | 'level'

let ctx: AudioContext | null = null
const ac = (): AudioContext => (ctx ??= new AudioContext())

function tone(freq: number, dur: number, vol: number, type: OscillatorType, at = 0, glide?: number): void {
  const a = ac()
  const t = a.currentTime + at
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(a.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

function meow(vol: number, at = 0, pitch = 1): void {
  const a = ac()
  const t = a.currentTime + at
  const o = a.createOscillator()
  const f = a.createBiquadFilter()
  const g = a.createGain()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(520 * pitch, t)
  o.frequency.linearRampToValueAtTime(760 * pitch, t + 0.12)
  o.frequency.linearRampToValueAtTime(430 * pitch, t + 0.42)
  f.type = 'bandpass'
  f.Q.value = 4
  f.frequency.setValueAtTime(900, t)
  f.frequency.linearRampToValueAtTime(1600, t + 0.15)
  f.frequency.linearRampToValueAtTime(700, t + 0.42)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol * 1.4, t + 0.04)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
  o.connect(f).connect(g).connect(a.destination)
  o.start(t)
  o.stop(t + 0.5)
}

function purr(vol: number): void {
  const a = ac()
  const t = a.currentTime
  const o = a.createOscillator()
  const lfo = a.createOscillator()
  const lg = a.createGain()
  const g = a.createGain()
  o.type = 'triangle'
  o.frequency.value = 52
  lfo.frequency.value = 24
  lg.gain.value = vol * 0.5
  lfo.connect(lg).connect(g.gain)
  g.gain.setValueAtTime(vol * 0.5, t)
  g.gain.linearRampToValueAtTime(0.0001, t + 1.1)
  o.connect(g).connect(a.destination)
  o.start(t)
  lfo.start(t)
  o.stop(t + 1.2)
  lfo.stop(t + 1.2)
}

export function play(pack: SoundPack, cue: Cue, volume: number): void {
  if (pack === 'none' || volume <= 0) return
  const v = Math.min(1, volume) * 0.25
  try {
    if (cue === 'purr') return purr(v)
    if (pack === 'meow') {
      if (cue === 'bump') return tone(220, 0.12, v, 'sine', 0, 120)
      meow(v, 0, cue === 'happy' ? 1.15 : cue === 'alert' ? 1.3 : 1)
      if (cue === 'level') meow(v, 0.35, 1.35)
      return
    }
    const type: OscillatorType = pack === 'beep' ? 'square' : 'sine'
    const vv = pack === 'beep' ? v * 0.45 : v
    const base = pack === 'bloop' ? 420 : pack === 'beep' ? 880 : 1100
    switch (cue) {
      case 'hello':
        tone(base, 0.09, vv, type, 0, pack === 'bloop' ? base * 0.6 : base * 1.25)
        tone(base * 1.33, 0.11, vv, type, 0.1, pack === 'bloop' ? base * 0.7 : base * 1.6)
        break
      case 'happy':
        ;[1, 1.25, 1.5].forEach((m, i) => tone(base * m, 0.09, vv, type, i * 0.08))
        break
      case 'alert':
        tone(base * 1.5, 0.14, vv, type, 0)
        tone(base * 1.5, 0.14, vv, type, 0.2)
        break
      case 'eat':
        ;[0, 0.13, 0.26].forEach((at) => tone(pack === 'beep' ? 300 : 260, 0.08, vv, type, at, 180))
        break
      case 'bump':
        tone(pack === 'bloop' ? 300 : base * 0.5, 0.12, vv, type, 0, 110)
        break
      case 'level':
        ;[1, 1.25, 1.5, 2].forEach((m, i) => tone(base * m, 0.12, vv, type, i * 0.1))
        break
    }
  } catch {
    /* audio unavailable */
  }
}
