import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_PET } from '../../../shared/pet'
import type { Visit } from '../../../shared/team'
import { api, useEvent } from '../api'
import { bubbleStyle, btn, FONT } from './PetApp'
import { MOOD_SHAPE, PetSvg } from './PetSvg'
import { play } from './sound'

/** A teammate's pet visiting: main walks the window in, this draws the pet, its line and the buttons. */
const WIN_W = 320
const WIN_H = 380
const BOX = 150

export function VisitorApp() {
  const [v, setV] = useState<Visit | null>(null) // set once the pet has arrived
  const [pet, setPet] = useState<Visit['pet'] | null>(null)
  const [walk, setWalk] = useState(0) // direction while walking, 0 when standing
  const [busy, setBusy] = useState(false)
  const [, setFrame] = useState(0)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const t0 = useRef(performance.now())

  useEffect(
    () =>
      void api.visitorGet().then((x) => {
        if (!x) return
        setPet((p) => p ?? x.pet)
        if (x.visit) setV((old) => old ?? x.visit)
        else setWalk((w) => w || x.dir || 1)
      }),
    []
  )
  useEvent('visitor:show', (x) => {
    setPet(x.pet)
    setWalk(0)
    setV((old) => {
      // your own pet's sound settings, so a muted pet means a quiet visitor too
      if (!old) void api.petGet().then((r) => play(r.config.sound, 'hello', r.config.volume)).catch(() => undefined)
      return x
    })
    setBusy(false)
  })
  useEvent('visitor:motion', (m) => {
    setWalk(m.state === 'walking' ? m.dir || 1 : 0)
  })

  useEffect(() => {
    let raf = 0
    const loop = (): void => {
      setFrame((f) => (f + 1) % 1e9)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // only the pet and the bubble take clicks
  const petLeft = (WIN_W - BOX) / 2
  const petTop = WIN_H - BOX - 6
  useLayoutEffect(() => {
    const rects = [{ x: petLeft - 10, y: petTop - 30, width: BOX + 20, height: BOX + 36 }]
    const b = bubbleRef.current?.getBoundingClientRect()
    if (b) rects.push({ x: b.left - 6, y: b.top - 6, width: b.width + 12, height: b.height + 14 })
    window.insight.petSend('visitor:shape', rects)
  })

  const now = performance.now() - t0.current
  const mood = walk ? 'walking' : v?.reply ? 'happy' : 'excited'
  const c = { ...DEFAULT_PET, ...(pet ?? {}), size: 1 }
  const act = (id: string): void => {
    setBusy(true)
    void api.visitorAct(id).catch(() => setBusy(false))
  }
  return (
    <div style={{ position: 'relative', width: WIN_W, height: WIN_H, fontFamily: FONT }}>
      {v && !walk && (
        <div ref={bubbleRef} style={{ position: 'absolute', left: '50%', bottom: BOX + 14, transform: 'translateX(-50%)', width: 'max-content', maxWidth: 290, minWidth: 120 }}>
          <div style={bubbleStyle}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: '#0B57D0', marginBottom: 3 }}>{`${v.pet.name} · ${v.from}`.toUpperCase()}</div>
            <div style={{ fontSize: 15, lineHeight: 1.4, color: '#1F1F1F' }}>{v.reply ?? v.text}</div>
            {!v.reply && v.actions.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                {v.actions.map((a) => (
                  <button key={a.id} disabled={busy} onClick={() => act(a.id)} style={{ ...btn(!!a.primary), opacity: busy ? 0.6 : 1 }}>
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
      {pet && (
        <div style={{ position: 'absolute', left: petLeft, top: petTop, width: BOX, height: BOX, transform: walk < 0 ? 'scaleX(-1)' : undefined }}>
          <PetSvg
            c={c}
            p={{ t: now, mood, look: { x: walk ? walk * 0.6 : 0, y: 0 }, blink: now % 3600 < 130, squash: walk ? 0 : Math.sin(now / 260) * 0.04, lean: walk * 6, walkPhase: walk ? now / 70 : 0, shape: { from: MOOD_SHAPE[mood], to: MOOD_SHAPE[mood], m: 1 } }}
            size={BOX}
          />
        </div>
      )}
    </div>
  )
}
