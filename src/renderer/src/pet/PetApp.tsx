import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_PET, DEFAULT_PROGRESS, levelOf, type Mood, type PetAction, type PetConfig, type PetLine, type PetProgress, type Topic } from '../../../shared/pet'
import { lineSet, POOLS, say } from '../../../shared/petLines'
import type { CalEvent } from '../../../shared/google'
import { api, useEvent } from '../api'
import { MOOD_SHAPE, PetSvg, type Pose } from './PetSvg'
import { play, type Cue } from './sound'
import { encodeWav, Vad } from '../audio/recorder'

const WIN_W = 420
const WIN_H = 460
const FONT = '"Google Sans Flex Variable", "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif'
const send = window.insight.petSend
const rid = (): string => Math.random().toString(36).slice(2)
const todayKey = (): string => new Date().toISOString().slice(0, 10)
const hm = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

interface Bubble extends PetLine {
  until: number
}
interface Heart {
  id: string
  x: number
  born: number
}

function inQuiet(c: PetConfig, d = new Date()): boolean {
  if (c.quietStart < 0 || c.quietStart === c.quietEnd) return false
  const h = d.getHours()
  return c.quietStart < c.quietEnd ? h >= c.quietStart && h < c.quietEnd : h >= c.quietStart || h < c.quietEnd
}

/** pick a topic, weighted by what the user liked or dismissed before */
function pickTopic(c: PetConfig, p: PetProgress): Topic | null {
  const ts = (Object.keys(c.topics) as Topic[]).filter((t) => c.topics[t])
  if (!ts.length) return null
  const w = ts.map((t) => (1 + p.likes[t] * 0.4) / (1 + p.dislikes[t] * 0.4))
  let r = Math.random() * w.reduce((a, b) => a + b, 0)
  for (let i = 0; i < ts.length; i++) if ((r -= w[i]) <= 0) return ts[i]
  return ts[0]
}

export function PetApp() {
  const [cfg, setCfg] = useState<PetConfig>(DEFAULT_PET)
  const [prog, setProg] = useState<PetProgress>(DEFAULT_PROGRESS)
  const [ready, setReady] = useState(false)
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [hearts, setHearts] = useState<Heart[]>([])
  const [confetti, setConfetti] = useState(0)
  const [hover, setHover] = useState(false)
  const [, setFrame] = useState(0)
  const cfgRef = useRef(cfg)
  const progRef = useRef(prog)
  cfgRef.current = cfg
  progRef.current = prog

  // ---------- animation state (mutable, read in the rAF loop) ----------
  const st = useRef({
    mood: 'idle' as Mood,
    tempMood: null as Mood | null,
    tempUntil: 0,
    recording: false,
    motion: '' as string,
    walkDir: 0,
    walkPhase: 0,
    squash: 0,
    squashV: 0,
    lean: 0,
    look: { x: 0, y: 0 },
    lookTarget: { x: 0, y: 0 },
    lastPointer: 0,
    blinkUntil: 0,
    nextBlink: 0,
    shape: { from: 'cookie' as Pose['shape']['from'], to: 'cookie' as Pose['shape']['to'], start: 0 },
    lastInteract: Date.now(),
    lastChat: Date.now(),
    nextChatGap: 0,
    dragging: false,
    down: null as null | { sx: number; sy: number; ox: number; oy: number; moved: boolean; samples: { x: number; y: number; t: number }[] },
    rub: { dist: 0, since: 0, lx: 0, ly: 0 },
    clickTimer: 0 as number,
    lastClick: 0,
    notified: new Set<string>(),
    recordedToday: 0,
    recordedDay: todayKey(),
    stressedUntil: 0,
    busyToldDay: '',
    stretched: '',
    friday: ''
  }).current

  const L = useCallback(() => say(cfgRef.current.language, cfgRef.current.sassy), [])
  const sound = useCallback((cue: Cue) => play(cfgRef.current.sound, cue, cfgRef.current.volume), [])
  const setTemp = useCallback((m: Mood, ms: number) => {
    st.tempMood = m
    st.tempUntil = performance.now() + ms
  }, [st])
  const kick = useCallback((amt: number) => {
    st.squashV += amt
  }, [st])

  const show = useCallback(
    (line: Omit<PetLine, 'id'> & { id?: string }, opts: { cue?: Cue; mood?: Mood; moodMs?: number } = {}) => {
      // languages other than English/Japanese: translate the line and its buttons (cached in main), then show
      const lang = cfgRef.current.language
      if (lineSet(lang) === 'en' && lang !== 'English' && !(line as { translated?: boolean }).translated) {
        const texts = [line.text, ...(line.actions ?? []).map((a) => a.label)]
        void api
          .translate(lang, texts)
          .catch(() => texts)
          .then((tr) => show({ ...line, text: tr[0], actions: line.actions?.map((a, i) => ({ ...a, label: tr[i + 1] ?? a.label })), translated: true } as typeof line, opts))
        return
      }
      const ttl = line.ttl ?? (line.sticky ? 10 * 60_000 : Math.min(16_000, 5000 + line.text.length * 70))
      setBubble({ ...line, id: line.id ?? rid(), until: Date.now() + ttl })
      if (opts.mood) setTemp(opts.mood, opts.moodMs ?? 2500)
      if (opts.cue) sound(opts.cue)
      kick(0.08)
    },
    [setTemp, sound, kick]
  )

  // ---------- load config ----------
  useEffect(() => {
    void api.petGet().then((r) => {
      setCfg(r.config)
      setProg(r.progress)
      setReady(true)
    })
  }, [])
  useEvent('pet:config', setCfg)
  useEvent('pet:progress', setProg)

  // ---------- events from the app ----------
  useEvent('calendar:reminder', (e) => {
    st.notified.add(`now:${e.id}@${e.start}`)
    const mins = Math.round((e.start - Date.now()) / 60_000)
    const actions: PetAction[] = e.joinUrl
      ? [
          { label: 'Join', cmd: 'join', arg: e.joinUrl },
          { label: 'Join + notes', cmd: 'joinNotes', arg: JSON.stringify(e) }
        ]
      : [{ label: 'Take notes', cmd: 'joinNotes', arg: JSON.stringify(e) }]
    show({ text: mins > 0 ? L().soon(e.title, mins) : L().now(e.title), sticky: true, ttl: Math.max(60_000, e.start - Date.now() + 5 * 60_000), actions: [...actions, { label: 'Later', cmd: 'dismiss' }] }, { cue: 'alert', mood: 'excited', moodMs: 3000 })
  })
  useEvent('meeting:state', (m) => {
    st.recording = m.recording
    if (m.recording) {
      show({ text: L().listening(), ttl: 5000 }, { cue: 'hello' })
      return
    }
    const day = todayKey()
    if (st.recordedDay !== day) {
      st.recordedDay = day
      st.recordedToday = 0
    }
    st.recordedToday += m.durationMs
    if (m.durationMs < 60_000) return
    show(
      { text: L().done(m.title), ttl: 60_000, actions: [{ label: 'Write notes', cmd: 'enhance', arg: m.meetingId }, { label: 'Open', cmd: 'openMeeting', arg: m.meetingId }] },
      { cue: 'happy', mood: 'happy', moodMs: 2000 }
    )
  })
  useEvent('meeting:enhanced', (m) => {
    show({ text: L().notes(m.actionItems), ttl: 30_000, actions: [{ label: 'Open notes', cmd: 'openMeeting', arg: m.meetingId }] }, { cue: 'happy', mood: 'dance', moodMs: 2600 })
    setConfetti(Date.now())
    if (st.recordedToday > 2 * 3600_000 && st.stretched !== todayKey()) {
      st.stretched = todayKey()
      setTimeout(() => show({ text: L().stretch() }, { mood: 'stretch', moodMs: 6000 }), 9000)
    }
  })
  useEvent('brief:ready', ({ brief, event }) => {
    show(
      { text: L().briefReady(event.title), ttl: Math.max(60_000, event.start - Date.now() + 5 * 60_000), sticky: true, actions: [{ label: 'Read brief', cmd: 'brief', arg: brief.key }, ...(event.joinUrl ? [{ label: 'Join + notes', cmd: 'joinNotes' as const, arg: JSON.stringify(event) }] : []), { label: 'Later', cmd: 'dismiss' }] },
      { cue: 'alert', mood: 'writing', moodMs: 2500 }
    )
  })
  useEvent('recap:ready', (r) => {
    const h = Math.floor(r.totalMs / 3600_000)
    const m = Math.round((r.totalMs % 3600_000) / 60_000)
    show({ text: L().recap(r.meetings, h ? `${h} h ${m} min` : `${m} min`, r.promisesKept), ttl: 120_000, actions: [{ label: 'See my week', cmd: 'open', arg: 'recap' }] }, { cue: 'level', mood: 'dance', moodMs: 2600 })
    setConfetti(Date.now())
  })
  useEvent('call:detected', ({ app }) => {
    show({ text: L().callStarted(app), ttl: 90_000, actions: [{ label: 'Take notes', cmd: 'listen' }, { label: 'Not now', cmd: 'dismiss' }] }, { cue: 'alert', mood: 'excited', moodMs: 2500 })
  })
  useEvent('call:ended', () => {
    show({ text: L().callEnded(), ttl: 90_000, actions: [{ label: 'Stop', cmd: 'stop' }, { label: 'Keep going', cmd: 'dismiss' }] }, { cue: 'hello' })
  })
  useEvent('commitment:nudge', ({ c, evidence }) => {
    show(
      {
        text: evidence ? `${L().promise(c.text, c.due, c.forPerson)} ${evidence}` : L().promise(c.text, c.due, c.forPerson),
        ttl: 5 * 60_000,
        actions: [{ label: evidence ? 'Yes, done' : 'Done ✓', cmd: 'promiseDone', arg: c.id }, { label: 'Tomorrow', cmd: 'promiseSnooze', arg: c.id }, { label: 'Open', cmd: 'openMeeting', arg: c.meetingId }]
      },
      { cue: 'alert', mood: 'excited', moodMs: 2500 }
    )
  })
  useEvent('pet:motion', (m) => {
    st.motion = m.state
    if (m.state === 'walking') st.walkDir = m.dir ?? 0
    if (m.state === 'stopped' || m.state === 'landed') st.walkDir = 0
    if (m.state === 'bump') {
      kick(Math.min(0.9, (m.speed ?? 10) / 40))
      sound('bump')
    }
    if (m.state === 'landed') {
      const thrown = (m.speed ?? 0) > 8
      kick(thrown ? 0.5 : 0.25)
      if (thrown && Math.random() < 0.35) show({ text: L().thrown(), ttl: 2600 })
    }
  })
  useEvent('pet:cmd', (c) => {
    if (c.type === 'chat') void chatter(true)
    if (c.type === 'voice') void voice()
    if (c.type === 'badge') {
      setConfetti(Date.now())
      show({ text: L().badge(c.label, c.reward), ttl: 9000, actions: c.reward ? [{ label: 'Customize', cmd: 'open', arg: 'pet' }] : undefined }, { cue: 'level', mood: 'dance', moodMs: 3000 })
    }
    if (c.type === 'shoo') show({ text: L().shoo(), ttl: 1400 }, { mood: 'happy', moodMs: 1400 })
    if (c.type === 'back') show({ text: L().hello(), ttl: 3000 }, { cue: 'hello', mood: 'excited', moodMs: 1500 })
    if (c.type === 'line') show(c.line, { cue: 'hello', mood: c.line.mood ?? 'excited', moodMs: 2000 })
    if (c.type === 'levelup') {
      setConfetti(Date.now())
      show({ text: L().level(c.level, c.unlocked.join(', ')), ttl: 9000, actions: [{ label: 'Customize', cmd: 'open', arg: 'pet' }] }, { cue: 'level', mood: 'dance', moodMs: 3500 })
    }
  })

  // ---------- voice questions (hotkey or menu) ----------
  const mic = useRef<{ stop: (send: boolean) => void } | null>(null)
  const voice = useCallback(async () => {
    if (mic.current) return mic.current.stop(true) // second press: answer now
    interact()
    show({ text: L().voiceListen(), ttl: 12_000 }, { cue: 'hello', mood: 'listening', moodMs: 12_000 })
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    const chunks: Float32Array[] = []
    const finish = async (send: boolean): Promise<void> => {
      if (!mic.current) return
      mic.current = null
      clearTimeout(limit)
      stream?.getTracks().forEach((t) => t.stop())
      await ctx?.close().catch(() => undefined)
      st.tempMood = null
      if (!send || !chunks.length) return void (send && show({ text: L().voiceMiss(), ttl: 5000 }, { mood: 'sad', moodMs: 1500 }))
      const pcm = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
      let o = 0
      for (const c of chunks) {
        pcm.set(c, o)
        o += c.length
      }
      show({ text: L().voiceThink(), ttl: 60_000 }, { mood: 'writing', moodMs: 60_000 })
      try {
        const r = await api.petVoiceAsk(encodeWav(pcm))
        st.tempMood = null
        if (!r.question) return void show({ text: L().voiceMiss(), ttl: 5000 }, { mood: 'sad', moodMs: 1500 })
        const plain = r.answer.replace(/\[\d+\]/g, '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim()
        show({ text: `“${r.question}”  ${plain.length > 300 ? plain.slice(0, 297) + '…' : plain}`, ttl: 45_000, actions: [{ label: 'Open in Ask', cmd: 'openAsk' }] }, { cue: 'happy', mood: 'happy', moodMs: 1800 })
      } catch (e) {
        st.tempMood = null
        show({ text: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 160), ttl: 8000 }, { mood: 'sad', moodMs: 1500 })
      }
    }
    mic.current = { stop: (send) => void finish(send) }
    const limit = window.setTimeout(() => mic.current?.stop(true), 12_000)
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      ctx = new AudioContext({ sampleRate: 16000 })
      await ctx.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).href)
      const src = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'pcm-framer')
      const sink = ctx.createGain()
      sink.gain.value = 0
      // the meeting VAD decides when the question is over: first full utterance ends the recording
      const vad = new Vad('mic', (_ch, pcm) => {
        chunks.push(pcm)
        mic.current?.stop(true)
      })
      let t = 0
      node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
        vad.push(ev.data, (t += 30))
      }
      src.connect(node)
      node.connect(sink).connect(ctx.destination)
    } catch (e) {
      mic.current = null
      clearTimeout(limit)
      show({ text: `Microphone unavailable: ${(e as Error).message}`, ttl: 6000 }, { mood: 'sad', moodMs: 1500 })
    }
  }, [show, L, st]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- chatter ----------
  const chatter = useCallback(
    async (forced = false) => {
      const c = cfgRef.current
      const topic = pickTopic(c, progRef.current)
      if (!topic) return
      let text = ''
      if (c.smartLines && (forced || Math.random() < 0.5)) {
        const evs = await api.calendar().catch(() => [] as CalEvent[])
        const now = Date.now()
        const left = evs.filter((e) => !e.allDay && e.start > now && new Date(e.start).toDateString() === new Date().toDateString())
        text = await api
          .petSmart({ meetingsLeft: left.length, nextInMin: left[0] ? Math.round((left[0].start - now) / 60_000) : null, hour: new Date().getHours(), weekday: new Date().toLocaleDateString('en-US', { weekday: 'long' }) })
          .catch(() => '')
      }
      if (!text) {
        const set = lineSet(c.language)
        const pool = POOLS[topic][set].length ? POOLS[topic][set] : POOLS[topic].en
        text = pool[Math.floor(Math.random() * pool.length)]
      }
      st.lastChat = Date.now()
      show({ text, topic, actions: [{ label: '👍', cmd: 'like', arg: topic }, { label: '✕', cmd: 'dismiss', arg: topic }] }, { cue: 'hello', mood: topic === 'jokes' ? 'happy' : 'excited', moodMs: 1800 })
    },
    [show, st]
  )

  // ---------- brain tick (every 10 s) ----------
  useEffect(() => {
    if (!ready) return
    let alive = true
    const tick = async (): Promise<void> => {
      if (!alive) return
      const c = cfgRef.current
      const now = Date.now()
      const d = new Date()
      const quiet = inQuiet(c, d)
      // morning brief, once a day
      if (progRef.current.lastBrief !== todayKey() && d.getHours() >= 5 && !st.recording && !bubble) {
        const evs = await api.calendar().catch(() => [] as CalEvent[])
        const todays = evs.filter((e) => !e.allDay && e.end > now && new Date(e.start).toDateString() === d.toDateString()).sort((a, b) => a.start - b.start)
        const user = (await api.getSettings().catch(() => null))?.userName
        const name = user && user !== 'You' ? user.split(' ')[0] : ''
        show({ text: `${L().greet(name, d.getHours())} ${L().brief(todays.length, todays[0]?.title, todays[0] ? hm(todays[0].start) : '')}`, ttl: 20_000 }, { cue: 'hello', mood: 'excited', moodMs: 2500 })
        void api.petBriefed()
        progRef.current = { ...progRef.current, lastBrief: todayKey() }
        return
      }
      // 10-minute heads-up before meetings (the real reminder comes from calendar:reminder)
      const evs = await api.calendar().catch(() => [] as CalEvent[])
      // back-to-back days: 3+ meetings with gaps of 10 min or less -> visibly busy pet during that stretch
      const day = evs.filter((e) => !e.allDay && new Date(e.start).toDateString() === d.toDateString()).sort((a, b) => a.start - b.start)
      let chainStart = 0, chainEnd = 0, run = 0
      st.stressedUntil = 0
      for (let i = 0; i < day.length; i++) {
        if (i && day[i].start - day[i - 1].end <= 10 * 60_000) {
          run++
          chainEnd = Math.max(chainEnd, day[i].end)
        } else {
          run = 1
          chainStart = day[i].start
          chainEnd = day[i].end
        }
        if (run >= 3 && now >= chainStart - 30 * 60_000 && now <= chainEnd) st.stressedUntil = chainEnd
      }
      if (st.stressedUntil && st.busyToldDay !== todayKey() && !quiet) {
        st.busyToldDay = todayKey()
        show({ text: L().busy(), ttl: 8000 }, { mood: 'stressed', moodMs: 3000 })
        return
      }
      for (const e of evs) {
        const mins = (e.start - now) / 60_000
        const key = `soon:${e.id}@${e.start}`
        if (!e.allDay && mins > 6 && mins <= 10 && !st.notified.has(key)) {
          st.notified.add(key)
          show({ text: L().soon(e.title, Math.round(mins)), ttl: 15_000 }, { cue: 'alert', mood: 'excited', moodMs: 2000 })
          return
        }
      }
      // Friday afternoon cheer
      if (d.getDay() === 5 && d.getHours() >= 15 && st.friday !== todayKey() && !quiet) {
        st.friday = todayKey()
        show({ text: L().friday() }, { mood: 'dance', moodMs: 2500, cue: 'happy' })
        return
      }
      // random chatter, spaced by personality
      if (!st.nextChatGap) st.nextChatGap = (60 - 52 * c.chattiness) * 60_000 * (0.7 + Math.random() * 0.6)
      if (c.chattiness > 0 && !quiet && !st.recording && !bubble && now - st.lastChat > st.nextChatGap && now - st.lastInteract > 20_000) {
        st.nextChatGap = 0
        await chatter()
        return
      }
      // wander
      if (c.wander && !st.recording && !bubble && !st.dragging && st.motion !== 'walking' && st.motion !== 'flying' && !quiet && Math.random() < 0.08 + c.energy * 0.25) {
        const dist = (80 + Math.random() * 260) * (Math.random() < 0.5 ? -1 : 1)
        send('pet:walk', dist)
      }
    }
    const t = setInterval(() => void tick(), 10_000)
    const first = setTimeout(() => void tick(), 2500)
    return () => {
      alive = false
      clearInterval(t)
      clearTimeout(first)
    }
  }, [ready, bubble, show, chatter, L, st])

  // expire bubbles
  useEffect(() => {
    if (!bubble) return
    const t = setTimeout(() => setBubble((b) => (b && b.id === bubble.id ? null : b)), Math.max(0, bubble.until - Date.now()))
    return () => clearTimeout(t)
  }, [bubble])

  // ---------- rAF loop ----------
  useEffect(() => {
    let raf = 0
    const loop = (): void => {
      const now = performance.now()
      if (st.tempMood && now > st.tempUntil) st.tempMood = null
      const idleLong = Date.now() - st.lastInteract > 15 * 60_000
      const night = inQuiet(cfgRef.current)
      const stressed = Date.now() < st.stressedUntil
      const base: Mood = st.recording ? 'listening' : stressed && !st.dragging && st.motion !== 'walking' && st.motion !== 'flying' ? 'stressed' : st.dragging || st.motion === 'carried' ? 'carried' : st.motion === 'flying' ? 'flying' : st.motion === 'walking' ? 'walking' : idleLong && (night || !bubble) ? 'sleepy' : 'idle'
      const mood = st.motion === 'carried' || st.dragging ? 'carried' : st.tempMood ?? base
      if (mood !== st.mood) {
        st.shape = { from: st.shape.to, to: MOOD_SHAPE[mood], start: now }
        st.mood = mood
      }
      // squash spring
      st.squashV += -0.18 * st.squash - 0.16 * st.squashV
      st.squash += st.squashV
      // look: follow the pointer, else drift
      if (now - st.lastPointer > 2500 && Math.random() < 0.01) st.lookTarget = { x: Math.random() * 2 - 1, y: Math.random() * 1.2 - 0.6 }
      st.look.x += (st.lookTarget.x - st.look.x) * 0.15
      st.look.y += (st.lookTarget.y - st.look.y) * 0.15
      // blink
      if (now > st.nextBlink) {
        st.blinkUntil = now + 130
        st.nextBlink = now + 2200 + Math.random() * 4200
      }
      if (st.motion === 'walking') st.walkPhase += 0.22 + cfgRef.current.energy * 0.12
      const leanTarget = st.motion === 'walking' ? st.walkDir * 6 : hover ? st.look.x * 6 : 0
      st.lean += (leanTarget - st.lean) * 0.12
      setFrame((f) => (f + 1) % 1e9)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [st, hover, bubble])

  // ---------- window shape: only the pet and the bubble take clicks ----------
  const petRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const box = Math.round(200 * cfg.size)
  const petLeft = (WIN_W - box) / 2
  const petTop = WIN_H - box - 6
  useLayoutEffect(() => {
    const rects = [{ x: petLeft - 14, y: petTop - 40, width: box + 28, height: box + 46 }]
    const b = bubbleRef.current?.getBoundingClientRect()
    if (b) rects.push({ x: b.left - 6, y: b.top - 6, width: b.width + 12, height: b.height + 14 })
    send('pet:shape', rects)
  })

  // ---------- interactions ----------
  const interact = (): void => {
    if (st.mood === 'sleepy' && Date.now() - st.lastInteract > 15 * 60_000) show({ text: L().wake(), ttl: 2500 }, { mood: 'excited', moodMs: 1200 })
    st.lastInteract = Date.now()
  }
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    st.down = { sx: e.screenX, sy: e.screenY, ox: e.screenX - window.screenX, oy: e.screenY - window.screenY, moved: false, samples: [{ x: e.screenX, y: e.screenY, t: performance.now() }] }
    interact()
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const r = petRef.current?.getBoundingClientRect()
    if (r) {
      st.lookTarget = { x: Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2))), y: Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.45)) / (r.height / 2))) }
      st.lastPointer = performance.now()
    }
    const d = st.down
    if (d) {
      if (!d.moved && Math.hypot(e.screenX - d.sx, e.screenY - d.sy) > 5) {
        d.moved = true
        st.dragging = true
        send('pet:grab')
        kick(-0.6)
        sound('hello')
      }
      if (d.moved) {
        send('pet:moveTo', e.screenX - d.ox, e.screenY - d.oy)
        d.samples.push({ x: e.screenX, y: e.screenY, t: performance.now() })
        if (d.samples.length > 8) d.samples.shift()
      }
      return
    }
    // petting: rubbing back and forth over the pet
    const rub = st.rub
    const now = performance.now()
    if (now - rub.since > 1600) {
      rub.dist = 0
      rub.since = now
    }
    if (rub.lx) rub.dist += Math.hypot(e.clientX - rub.lx, e.clientY - rub.ly)
    rub.lx = e.clientX
    rub.ly = e.clientY
    if (rub.dist > 260) {
      rub.dist = 0
      rub.since = now
      petted()
    }
  }
  const petted = (): void => {
    interact()
    setTemp('happy', 1800)
    kick(0.25)
    sound(Math.random() < 0.5 ? 'purr' : 'happy')
    const t = Date.now()
    setHearts((h) => [...h.filter((x) => t - x.born < 1600), ...[0, 1, 2].map((i) => ({ id: rid(), x: petLeft + box * (0.3 + Math.random() * 0.4) + i * 4, born: t + i * 120 }))])
    if (Math.random() < 0.3 && !bubble) show({ text: L().petted(), ttl: 2200 })
    void api.petPetted()
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    const d = st.down
    st.down = null
    if (!d) return
    if (d.moved) {
      st.dragging = false
      const s = d.samples
      const a = s[0], b = s[s.length - 1]
      const dt = Math.max(16, b.t - a.t)
      const vx = ((b.x - a.x) / dt) * 16.7
      const vy = ((b.y - a.y) / dt) * 16.7
      send('pet:throw', vx, vy)
      return
    }
    // click vs double-click
    const now = performance.now()
    if (now - st.lastClick < 320) {
      clearTimeout(st.clickTimer)
      st.lastClick = 0
      void api.petOpen('chat')
      return
    }
    st.lastClick = now
    st.clickTimer = window.setTimeout(() => {
      kick(0.4)
      setTemp('happy', 900)
      sound('hello')
      if (!bubble || !bubble.sticky) void chatter(true)
    }, 320)
    void e
  }

  // feeding: drop a file or folder on the pet
  const [hungry, setHungry] = useState(false)
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setHungry(false)
    const files = [...e.dataTransfer.files]
    if (!files.length) return
    setTemp('eating', 1600)
    sound('eat')
    let fed = 0, last = ''
    for (const f of files.slice(0, 20)) {
      const p = window.insight.pathForFile(f)
      const r = await api.addPath(p).catch(() => ({ ok: false, name: f.name }))
      if (r.ok) {
        fed++
        last = r.name
      }
    }
    if (fed) show({ text: L().fed(fed > 1 ? `${last} + ${fed - 1} more` : last), ttl: 5000 }, { mood: 'happy', moodMs: 1800, cue: 'happy' })
    else show({ text: L().fedErr(), ttl: 4000 }, { mood: 'sad', moodMs: 1800 })
  }

  const act = async (a: PetAction, line: Bubble): Promise<void> => {
    interact()
    const close = (): void => setBubble((b) => (b?.id === line.id ? null : b))
    switch (a.cmd) {
      case 'join':
        if (a.arg) void api.openExternal(a.arg)
        close()
        break
      case 'joinNotes':
        if (a.arg) void api.petJoinNotes(JSON.parse(a.arg) as CalEvent)
        close()
        break
      case 'openMeeting':
        void api.petOpen('meeting', a.arg)
        close()
        break
      case 'open':
        void api.petOpen(a.arg ?? 'home')
        close()
        break
      case 'openAsk':
        void api.petOpen('chat')
        close()
        break
      case 'enhance':
        if (!a.arg) return
        show({ text: L().writing(), ttl: 120_000 }, { mood: 'writing', moodMs: 120_000 })
        try {
          await api.enhance(a.arg)
          st.tempMood = null
        } catch (err) {
          st.tempMood = null
          show({ text: L().notesErr(String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 140)), ttl: 9000 }, { mood: 'sad', moodMs: 2000 })
        }
        break
      case 'brief':
        if (a.arg) void api.petOpen('brief', a.arg)
        close()
        break
      case 'promiseDone':
        if (a.arg) void api.updateCommitment(a.arg, { status: 'done' })
        show({ text: L().promiseDone(), ttl: 3500 }, { mood: 'dance', moodMs: 2200, cue: 'happy' })
        setConfetti(Date.now())
        break
      case 'listen':
        void api.petListen()
        close()
        break
      case 'stop':
        void api.petStop()
        close()
        break
      case 'promiseSnooze':
        if (a.arg) void api.updateCommitment(a.arg, { snoozeUntil: Date.now() + 20 * 3600_000 })
        close()
        break
      case 'like':
        if (a.arg) void api.petFeedback(a.arg as Topic, true)
        setTemp('happy', 1200)
        sound('happy')
        close()
        break
      case 'dismiss':
        if (a.arg) void api.petFeedback(a.arg as Topic, false)
        close()
        break
    }
  }

  // ---------- render ----------
  const now = performance.now()
  const m = Math.min(1, (now - st.shape.start) / 320)
  const pose: Pose = {
    t: now,
    mood: hungry ? 'eating' : st.mood,
    look: st.look,
    blink: now < st.blinkUntil,
    squash: st.squash,
    lean: st.lean,
    walkPhase: st.walkPhase,
    shape: { from: st.shape.from, to: st.shape.to, m: m < 1 ? 0.5 - Math.cos(m * Math.PI) / 2 : 1 }
  }
  const lv = levelOf(prog.xp)
  const confettiAge = Date.now() - confetti

  if (!ready || !cfg.enabled) return null
  return (
    <div style={{ position: 'relative', width: WIN_W, height: WIN_H, fontFamily: FONT }}>
      {bubble && (
        <div ref={bubbleRef} style={{ position: 'absolute', left: '50%', bottom: box + 14, transform: 'translateX(-50%)', width: 'max-content', maxWidth: 360, minWidth: 120 }}>
          <div style={bubbleStyle}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: '#0B57D0', marginBottom: 3 }}>{cfg.name.toUpperCase()}</div>
            <div style={{ fontSize: 15, lineHeight: 1.4, color: '#1F1F1F' }}>{bubble.text}</div>
            {bubble.actions && (
              <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                {bubble.actions.map((a, i) => (
                  <button key={i} onClick={() => void act(a, bubble)} style={btn(i === 0 && a.cmd !== 'like' && a.cmd !== 'dismiss')}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <svg width={22} height={12} style={{ position: 'absolute', left: '50%', bottom: -11, transform: 'translateX(-50%)' }}>
            <path d="M0 0 L11 11 L22 0Z" fill="#fff" />
          </svg>
        </div>
      )}
      {hover && !bubble && (
        <div style={{ position: 'absolute', left: '50%', top: petTop - 34, transform: 'translateX(-50%)', padding: '4px 11px', borderRadius: 999, background: 'rgba(31,31,31,.86)', color: '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {cfg.name} · Lv {lv.level}
          <span style={{ display: 'inline-block', width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.25)', marginLeft: 8, verticalAlign: 'middle', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${(lv.into / lv.need) * 100}%`, height: '100%', background: '#FBBC04' }} />
          </span>
        </div>
      )}
      <div
        ref={petRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => {
          setHover(false)
          st.rub.lx = 0
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          void api.petMenu()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!hungry) setHungry(true)
        }}
        onDragLeave={() => setHungry(false)}
        onDrop={(e) => void onDrop(e)}
        style={{ position: 'absolute', left: petLeft, top: petTop, width: box, height: box, cursor: st.dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <PetSvg c={cfg} p={pose} size={box} />
      </div>
      {hearts.map((h) => {
        const age = (Date.now() - h.born) / 1600
        if (age < 0 || age > 1) return null
        return (
          <div key={h.id} style={{ position: 'absolute', left: h.x, top: petTop + box * 0.25 - age * 70, fontSize: 20 + age * 8, color: '#EA4335', opacity: 1 - age, pointerEvents: 'none', transform: `translateX(${Math.sin(age * 6) * 8}px)` }}>
            ♥
          </div>
        )
      })}
      {confettiAge < 2200 &&
        Array.from({ length: 26 }).map((_, i) => {
          const k = confettiAge / 2200
          const x = petLeft + ((i * 37) % box)
          const y = petTop - 30 + k * (box + 20) + ((i * 13) % 30)
          return <div key={i} style={{ position: 'absolute', left: x, top: y, width: 7, height: 11, background: ['#4285F4', '#EA4335', '#FBBC04', '#34A853'][i % 4], transform: `rotate(${k * 720 + i * 30}deg)`, opacity: 1 - k, pointerEvents: 'none' }} />
        })}
    </div>
  )
}

const bubbleStyle: CSSProperties = {
  background: '#fff',
  borderRadius: 18,
  padding: '10px 14px 11px',
  boxShadow: '0 1px 3px rgba(0,0,0,.18), 0 8px 24px -8px rgba(0,0,0,.35)',
  border: '1px solid rgba(0,0,0,.06)'
}
const btn = (primary: boolean): CSSProperties => ({
  border: primary ? 'none' : '1.5px solid #C4C7C5',
  background: primary ? '#0B57D0' : '#fff',
  color: primary ? '#fff' : '#1F1F1F',
  borderRadius: 999,
  padding: '5px 12px',
  fontFamily: FONT,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer'
})
