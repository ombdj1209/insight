import type { ReactNode } from 'react'
import type { Mood, PetConfig } from '../../../shared/pet'
import { shapePath, type ShapeKind } from '../../../shared/shapes'

/** Pose: everything that animates. The pet window and the customiser drive it from a rAF loop. */
export interface Pose {
  t: number // ms
  mood: Mood
  look: { x: number; y: number } // -1..1
  blink: boolean
  squash: number // + squashed, - stretched
  lean: number // degrees
  walkPhase: number
  shape: { from: ShapeKind; to: ShapeKind; m: number }
}

export const MOOD_SHAPE: Record<Mood, ShapeKind> = {
  stressed: 'clover',
  idle: 'cookie',
  happy: 'puffy',
  excited: 'sunny',
  sleepy: 'circle',
  listening: 'cookie',
  writing: 'cookie',
  eating: 'puffy',
  dance: 'sunny',
  stretch: 'flower',
  carried: 'clover',
  flying: 'clover',
  walking: 'cookie',
  sad: 'circle'
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)))
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('')}`
}
const lum = (hex: string): number => {
  const n = parseInt(hex.replace('#', ''), 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

const CX = 100
const CY = 118

/** body outline path per species (blob morphs between Material shapes) */
function bodyPath(c: PetConfig, p: Pose, breathe: number): string {
  const sy = 0.9 * breathe
  switch (c.species) {
    case 'blob':
      return shapePath(CX, CY, 64, p.shape.from, p.shape.to, p.shape.m, p.t / 4000, sy * 0.98)
    case 'robot': {
      const w = 116, h = 104 * breathe, x = CX - w / 2, y = CY - h / 2 + 4, r = 26
      return `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`
    }
    case 'ghost': {
      const top = CY - 62 * breathe, w = 60, base = CY + 50
      let d = `M${CX - w} ${base}V${CY - 6}C${CX - w} ${top - 8} ${CX + w} ${top - 8} ${CX + w} ${CY - 6}V${base}`
      const waves = 4
      for (let i = 0; i < waves; i++) {
        const x1 = CX + w - ((i + 0.5) * 2 * w) / waves
        const x2 = CX + w - ((i + 1) * 2 * w) / waves
        const wob = Math.sin(p.t / 260 + i) * 4
        d += `Q${x1} ${base + 14 + wob} ${x2} ${base}`
      }
      return d + 'Z'
    }
    default: {
      const rx = 62, ry = 56 * breathe, y = CY + 6 - (ry - 56)
      return `M${CX - rx} ${y}C${CX - rx} ${y - ry * 1.25} ${CX + rx} ${y - ry * 1.25} ${CX + rx} ${y}C${CX + rx} ${y + ry * 0.92} ${CX - rx} ${y + ry * 0.92} ${CX - rx} ${y}Z`
    }
  }
}

function Eyes({ c, p }: { c: PetConfig; p: Pose }): ReactNode {
  const lx = p.look.x * 4, ly = p.look.y * 3
  const y = CY - 6 + ly
  const xs = [CX - 22 + lx, CX + 22 + lx]
  const ink = c.species === 'robot' ? '#7CF2FF' : c.species === 'penguin' || lum(c.color) < 0.3 ? '#1F1F1F' : '#1F1F1F'
  const mood = p.mood
  const closed = p.blink || mood === 'sleepy'
  const happy = mood === 'happy' || mood === 'dance' || c.eyes === 'happy'
  if (closed) return xs.map((x) => <path key={x} d={`M${x - 7} ${y}Q${x} ${y + (mood === 'sleepy' ? 4 : 2)} ${x + 7} ${y}`} stroke={ink} strokeWidth={4} fill="none" strokeLinecap="round" />)
  if (mood === 'carried' || mood === 'flying') return xs.map((x, i) => <path key={x} d={i ? `M${x - 6} ${y - 6}L${x + 4} ${y}L${x - 6} ${y + 6}` : `M${x + 6} ${y - 6}L${x - 4} ${y}L${x + 6} ${y + 6}`} stroke={ink} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />)
  if (happy) return xs.map((x) => <path key={x} d={`M${x - 8} ${y + 3}Q${x} ${y - 9} ${x + 8} ${y + 3}`} stroke={ink} strokeWidth={4.5} fill="none" strokeLinecap="round" />)
  const big = mood === 'excited' ? 1.2 : 1
  return xs.map((x) => {
    switch (c.eyes) {
      case 'dots':
        return <ellipse key={x} cx={x} cy={y} rx={5.5 * big} ry={6.5 * big} fill={ink} />
      case 'sleepy':
        return (
          <g key={x}>
            <ellipse cx={x} cy={y + 1} rx={7} ry={6} fill={ink} />
            <path d={`M${x - 9} ${y - 2}H${x + 9}`} stroke={c.color} strokeWidth={6} />
          </g>
        )
      case 'anime':
        return (
          <g key={x}>
            <ellipse cx={x} cy={y} rx={8.5 * big} ry={12 * big} fill={ink} />
            <ellipse cx={x} cy={y + 3} rx={6 * big} ry={7 * big} fill={shade(c.accent === '#FFFFFF' ? '#4285F4' : c.accent, -0.2)} opacity={0.65} />
            <circle cx={x - 3} cy={y - 5} r={3.6} fill="#fff" />
            <circle cx={x + 3} cy={y + 4} r={1.6} fill="#fff" />
          </g>
        )
      default:
        return (
          <g key={x}>
            <ellipse cx={x} cy={y} rx={7.5 * big} ry={9 * big} fill={ink} />
            <circle cx={x - 2.5} cy={y - 3.5} r={3} fill="#fff" />
            <circle cx={x + 3} cy={y + 3} r={1.4} fill="#fff" />
          </g>
        )
    }
  })
}

function Mouth({ c, p }: { c: PetConfig; p: Pose }): ReactNode {
  const y = CY + 14 + p.look.y * 2
  const x = CX + p.look.x * 3
  const ink = c.species === 'robot' ? '#7CF2FF' : '#1F1F1F'
  if (p.mood === 'eating') return <ellipse cx={x} cy={y + 2} rx={8 + Math.abs(Math.sin(p.t / 90)) * 3} ry={6 + Math.abs(Math.sin(p.t / 90)) * 4} fill="#5A1F1F" />
  if (p.mood === 'excited' || p.mood === 'carried' || p.mood === 'flying') return <ellipse cx={x} cy={y + 2} rx={6} ry={7} fill="#5A1F1F" />
  if (p.mood === 'sleepy') return <ellipse cx={x} cy={y + 2} rx={3} ry={2.5} fill={ink} opacity={0.7} />
  if (p.mood === 'stressed') return <path d={`M${x - 9} ${y + 3}q3 -4 6 0t6 0t6 0`} stroke={ink} strokeWidth={3} fill="none" strokeLinecap="round" />
  if (p.mood === 'sad') return <path d={`M${x - 7} ${y + 5}Q${x} ${y - 2} ${x + 7} ${y + 5}`} stroke={ink} strokeWidth={3.5} fill="none" strokeLinecap="round" />
  if (c.species === 'cat' || c.species === 'fox') return <path d={`M${x - 8} ${y}Q${x - 4} ${y + 6} ${x} ${y}Q${x + 4} ${y + 6} ${x + 8} ${y}`} stroke={ink} strokeWidth={3.2} fill="none" strokeLinecap="round" />
  if (c.species === 'penguin') return <path d={`M${x - 8} ${y - 4}L${x + 8} ${y - 4}L${x} ${y + 6}Z`} fill="#FBBC04" stroke="#E37400" strokeWidth={2} strokeLinejoin="round" />
  const open = p.mood === 'happy' || p.mood === 'dance'
  return open ? (
    <path d={`M${x - 9} ${y - 1}Q${x} ${y + 14} ${x + 9} ${y - 1}Z`} fill="#5A1F1F" />
  ) : (
    <path d={`M${x - 7} ${y}Q${x} ${y + 8} ${x + 7} ${y}`} stroke={ink} strokeWidth={3.5} fill="none" strokeLinecap="round" />
  )
}

/** species ears, tails, horns… (drawn behind the body when `back`) */
function Parts({ c, p, back }: { c: PetConfig; p: Pose; back: boolean }): ReactNode {
  const col = c.color
  const dark = shade(col, -0.18)
  const inner = c.accent === '#FFFFFF' ? '#F8BBD0' : c.accent
  const twitch = Math.sin(p.t / 180) > 0.97 ? 6 : 0
  const swish = Math.sin(p.t / 420) * 12 + (p.mood === 'happy' || p.mood === 'excited' ? Math.sin(p.t / 90) * 14 : 0)
  const sleepy = p.mood === 'sleepy'
  const o = { stroke: 'rgba(0,0,0,.16)', strokeWidth: 3, strokeLinejoin: 'round' as const }
  switch (c.species) {
    case 'cat':
      return back ? (
        <path d="M156 150 C190 150 186 112 176 104" stroke={col} strokeWidth={13} fill="none" strokeLinecap="round" transform={`rotate(${swish} 156 150)`} />
      ) : (
        <>
          {[1, -1].map((s) => (
            <g key={s} transform={`rotate(${s * (twitch - (sleepy ? 10 : 0))} ${CX - s * 36} 74)`}>
              <path d={`M${CX - s * 58} 84 L${CX - s * 46} 42 L${CX - s * 20} 70 Z`} fill={col} {...o} />
              <path d={`M${CX - s * 50} 76 L${CX - s * 45} 54 L${CX - s * 30} 70 Z`} fill={inner} />
            </g>
          ))}
          {[1, -1].map((s) => (
            <g key={'w' + s} stroke="rgba(0,0,0,.35)" strokeWidth={2} strokeLinecap="round">
              <path d={`M${CX + s * 34} ${CY + 10}L${CX + s * 56} ${CY + 6}`} />
              <path d={`M${CX + s * 34} ${CY + 16}L${CX + s * 56} ${CY + 18}`} />
            </g>
          ))}
        </>
      )
    case 'fox':
      return back ? (
        <g transform={`rotate(${swish} 150 156)`}>
          <path d="M146 158 C196 166 206 110 172 96 C182 128 166 146 146 146Z" fill={col} {...o} />
          <path d="M172 96 C186 104 190 118 186 126 C180 116 176 104 172 96Z" fill={c.accent} />
        </g>
      ) : (
        <>
          {[1, -1].map((s) => (
            <g key={s} transform={`rotate(${s * twitch} ${CX - s * 36} 74)`}>
              <path d={`M${CX - s * 60} 88 L${CX - s * 52} 30 L${CX - s * 18} 70 Z`} fill={col} {...o} />
              <path d={`M${CX - s * 51} 76 L${CX - s * 49} 46 L${CX - s * 30} 70 Z`} fill="#3E2723" opacity={0.75} />
            </g>
          ))}
          <path d={`M${CX - 40} ${CY + 4} Q${CX} ${CY + 52} ${CX + 40} ${CY + 4} Q${CX} ${CY + 22} ${CX - 40} ${CY + 4}Z`} fill={c.accent} opacity={0.95} />
        </>
      )
    case 'bunny':
      return back ? (
        <circle cx={152} cy={150} r={13} fill={c.accent === '#F8BBD0' ? '#fff' : c.accent} {...o} />
      ) : (
        <>
          {[1, -1].map((s) => (
            <g key={s} transform={`rotate(${s * (-8 - (sleepy ? 38 : 0) - twitch)} ${CX - s * 24} 70)`}>
              <ellipse cx={CX - s * 24} cy={36} rx={13} ry={36} fill={col} {...o} />
              <ellipse cx={CX - s * 24} cy={38} rx={6} ry={26} fill={inner} />
            </g>
          ))}
        </>
      )
    case 'bear':
      return back ? null : (
        <>
          {[1, -1].map((s) => (
            <g key={s}>
              <circle cx={CX - s * 46} cy={72} r={17} fill={col} {...o} />
              <circle cx={CX - s * 46} cy={72} r={9} fill={c.accent} />
            </g>
          ))}
          <ellipse cx={CX} cy={CY + 16} rx={24} ry={16} fill={c.accent} />
          <ellipse cx={CX} cy={CY + 8} rx={6} ry={4.5} fill="#3E2723" />
        </>
      )
    case 'axolotl': {
      const gill = shade(col, -0.25)
      return back ? null : (
        <>
          {[1, -1].map((s) =>
            [0, 1, 2].map((i) => (
              <ellipse key={`${s}${i}`} cx={CX - s * (60 + i * 2)} cy={CY - 36 + i * 18} rx={18} ry={7} fill={gill} transform={`rotate(${s * (-30 + i * 30 + Math.sin(p.t / 300 + i) * 8)} ${CX - s * 52} ${CY - 36 + i * 18})`} />
            ))
          )}
        </>
      )
    }
    case 'robot':
      return back ? null : (
        <>
          <path d={`M${CX} 66 V40`} stroke="#5F6B73" strokeWidth={4} />
          <circle cx={CX} cy={36} r={8} fill={Math.sin(p.t / 400) > 0 ? '#EA4335' : '#FBBC04'} />
          <rect x={CX - 46} y={CY - 30} width={92} height={60} rx={18} fill="#1F2933" />
          {[1, -1].map((s) => (
            <circle key={s} cx={CX - s * 62} cy={CY} r={7} fill="#5F6B73" />
          ))}
        </>
      )
    case 'dragon':
      return back ? (
        <>
          {[1, -1].map((s) => (
            <path key={s} d={`M${CX - s * 40} ${CY - 10} Q${CX - s * 96} ${CY - 60 + Math.sin(p.t / 160) * 10} ${CX - s * 84} ${CY + 10} Q${CX - s * 66} ${CY - 2} ${CX - s * 40} ${CY + 6}Z`} fill={shade(col, -0.15)} {...o} />
          ))}
          <path d="M150 158 C186 160 190 128 176 120" stroke={col} strokeWidth={12} fill="none" strokeLinecap="round" transform={`rotate(${swish * 0.6} 150 158)`} />
        </>
      ) : (
        <>
          {[1, -1].map((s) => (
            <path key={s} d={`M${CX - s * 30} 70 Q${CX - s * 38} 44 ${CX - s * 28} 36 Q${CX - s * 24} 54 ${CX - s * 18} 66Z`} fill={c.accent === '#D4F5DD' ? '#FBBC04' : c.accent} {...o} />
          ))}
          <ellipse cx={CX} cy={CY + 30} rx={30} ry={18} fill={c.accent} opacity={0.9} />
        </>
      )
    case 'penguin':
      return back ? null : (
        <>
          <path d={`M${CX - 42} ${CY + 40} C${CX - 50} ${CY - 30} ${CX - 14} ${CY - 50} ${CX} ${CY - 26} C${CX + 14} ${CY - 50} ${CX + 50} ${CY - 30} ${CX + 42} ${CY + 40} Z`} fill={c.accent} />
          {[1, -1].map((s) => (
            <ellipse key={s} cx={CX - s * 62} cy={CY + 14} rx={9} ry={22} fill={dark} transform={`rotate(${s * (14 + (p.mood === 'excited' ? Math.sin(p.t / 80) * 22 : 0))} ${CX - s * 62} ${CY - 4})`} />
          ))}
        </>
      )
    default:
      return null
  }
}

function Pattern({ c }: { c: PetConfig }): ReactNode {
  if (c.pattern === 'spots') return [[-30, -30], [26, -40], [36, 4], [-38, 14], [4, 30]].map(([x, y], i) => <circle key={i} cx={CX + x} cy={CY + y} r={i % 2 ? 7 : 9} fill={c.accent} opacity={0.75} />)
  if (c.pattern === 'stripes') return [-24, 0, 24].map((x) => <path key={x} d={`M${CX + x - 6} ${CY - 66} Q${CX + x} ${CY - 46} ${CX + x - 2} ${CY - 34}`} stroke={shade(c.color, -0.25)} strokeWidth={7} fill="none" strokeLinecap="round" />)
  if (c.pattern === 'belly') return <ellipse cx={CX} cy={CY + 28} rx={34} ry={22} fill={c.accent} opacity={0.85} />
  return null
}

function Head({ c, mood }: { c: PetConfig; mood: Mood }): ReactNode {
  const y = c.species === 'bunny' ? 58 : c.species === 'robot' ? 62 : 64
  const o = { stroke: 'rgba(0,0,0,.2)', strokeWidth: 2.5, strokeLinejoin: 'round' as const }
  const item = mood === 'listening' && c.head !== 'none' && c.head !== 'halo' ? 'none' : c.head
  switch (item) {
    case 'beanie':
      return (
        <g>
          <path d={`M${CX - 46} ${y + 6} Q${CX} ${y - 58} ${CX + 46} ${y + 6}Z`} fill="#EA4335" {...o} />
          <rect x={CX - 50} y={y - 2} width={100} height={14} rx={7} fill="#C5221F" />
          <circle cx={CX} cy={y - 28} r={10} fill="#fff" {...o} />
        </g>
      )
    case 'cap':
      return (
        <g>
          <path d={`M${CX - 44} ${y + 6} Q${CX - 40} ${y - 44} ${CX + 10} ${y - 40} Q${CX + 46} ${y - 34} ${CX + 44} ${y + 6}Z`} fill="#4285F4" {...o} />
          <path d={`M${CX + 20} ${y + 2} Q${CX + 70} ${y - 4} ${CX + 82} ${y + 10} Q${CX + 50} ${y + 14} ${CX + 20} ${y + 10}Z`} fill="#1A73E8" {...o} />
        </g>
      )
    case 'bow':
      return (
        <g transform={`translate(${CX + 30} ${y - 4}) rotate(-14)`}>
          <path d="M0 0 L-24 -14 L-24 14Z" fill="#F06292" {...o} />
          <path d="M0 0 L24 -14 L24 14Z" fill="#F06292" {...o} />
          <circle r={7} fill="#EC407A" />
        </g>
      )
    case 'flower':
      return (
        <g transform={`translate(${CX - 34} ${y})`}>
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} cx={0} cy={-11} rx={7} ry={11} fill="#FFFFFF" transform={`rotate(${a})`} {...o} />
          ))}
          <circle r={7} fill="#FBBC04" />
        </g>
      )
    case 'crown':
      return <path d={`M${CX - 30} ${y + 2} L${CX - 34} ${y - 30} L${CX - 14} ${y - 14} L${CX} ${y - 38} L${CX + 14} ${y - 14} L${CX + 34} ${y - 30} L${CX + 30} ${y + 2}Z`} fill="#FBBC04" {...o} />
    case 'party':
      return (
        <g transform={`rotate(-10 ${CX} ${y})`}>
          <path d={`M${CX - 24} ${y + 2} L${CX} ${y - 60} L${CX + 24} ${y + 2}Z`} fill="#A142F4" {...o} />
          <path d={`M${CX - 16} ${y - 18} L${CX + 16} ${y - 18}`} stroke="#FBBC04" strokeWidth={5} />
          <circle cx={CX} cy={y - 62} r={8} fill="#FBBC04" />
        </g>
      )
    case 'laurel':
      return (
        <g fill="#34A853" stroke="rgba(0,0,0,.2)" strokeWidth={1.5}>
          {[-1, 1].map((s) =>
            [0, 1, 2, 3, 4].map((i) => (
              <ellipse key={`${s}${i}`} cx={CX + s * (44 - i * 9)} cy={y - 2 - i * 6 + i * i * 0.6} rx={9} ry={4.5} transform={`rotate(${s * (-40 + i * 16)} ${CX + s * (44 - i * 9)} ${y - 2 - i * 6})`} />
            ))
          )}
        </g>
      )
    case 'halo':
      return <ellipse cx={CX} cy={y - 26} rx={34} ry={9} fill="none" stroke="#FBBC04" strokeWidth={6} opacity={0.9} />
    case 'witch':
      return (
        <g>
          <ellipse cx={CX} cy={y + 2} rx={60} ry={10} fill="#3C1E5A" />
          <path d={`M${CX - 30} ${y} L${CX + 10} ${y - 70} Q${CX + 26} ${y - 74} ${CX + 34} ${y - 58} L${CX + 30} ${y}Z`} fill="#4A2670" {...o} />
          <rect x={CX - 30} y={y - 12} width={60} height={9} fill="#FBBC04" />
        </g>
      )
    case 'santa':
      return (
        <g>
          <path d={`M${CX - 44} ${y + 4} Q${CX - 10} ${y - 66} ${CX + 50} ${y - 34} L${CX + 44} ${y + 4}Z`} fill="#EA4335" {...o} />
          <rect x={CX - 50} y={y - 4} width={100} height={16} rx={8} fill="#fff" {...o} />
          <circle cx={CX + 54} cy={y - 34} r={10} fill="#fff" {...o} />
        </g>
      )
    default:
      return null
  }
}

function Face({ c }: { c: PetConfig }): ReactNode {
  const y = CY - 6
  const xs = [CX - 22, CX + 22]
  switch (c.face) {
    case 'glasses':
      return (
        <g fill="none" stroke="#1F1F1F" strokeWidth={3.5}>
          {xs.map((x) => <circle key={x} cx={x} cy={y} r={14} />)}
          <path d={`M${CX - 8} ${y}H${CX + 8}`} />
        </g>
      )
    case 'sunglasses':
      return (
        <g>
          {xs.map((x) => <rect key={x} x={x - 16} y={y - 10} width={32} height={20} rx={9} fill="#1F1F1F" />)}
          <path d={`M${CX - 6} ${y - 4}H${CX + 6}`} stroke="#1F1F1F" strokeWidth={4} />
          {xs.map((x) => <path key={'s' + x} d={`M${x - 10} ${y - 4}L${x - 4} ${y - 4}`} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" opacity={0.7} />)}
        </g>
      )
    case 'monocle':
      return (
        <g fill="none" stroke="#B8860B" strokeWidth={3}>
          <circle cx={xs[1]} cy={y} r={15} />
          <path d={`M${xs[1] + 12} ${y + 10} Q${xs[1] + 24} ${y + 40} ${xs[1] + 10} ${y + 58}`} />
        </g>
      )
    default:
      return null
  }
}

function Neck({ c }: { c: PetConfig }): ReactNode {
  const y = c.species === 'ghost' ? CY + 26 : CY + 36
  const o = { stroke: 'rgba(0,0,0,.2)', strokeWidth: 2.5, strokeLinejoin: 'round' as const }
  switch (c.neck) {
    case 'scarf':
      return (
        <g>
          <path d={`M${CX - 46} ${y - 6} Q${CX} ${y + 14} ${CX + 46} ${y - 6} L${CX + 44} ${y + 6} Q${CX} ${y + 26} ${CX - 44} ${y + 6}Z`} fill="#34A853" {...o} />
          <path d={`M${CX + 16} ${y + 10} L${CX + 30} ${y + 42} L${CX + 42} ${y + 38} L${CX + 32} ${y + 6}Z`} fill="#2E9549" {...o} />
        </g>
      )
    case 'bowtie':
      return (
        <g transform={`translate(${CX} ${y + 6})`}>
          <path d="M0 0 L-18 -10 L-18 10Z" fill="#EA4335" {...o} />
          <path d="M0 0 L18 -10 L18 10Z" fill="#EA4335" {...o} />
          <circle r={5} fill="#C5221F" />
        </g>
      )
    case 'bell':
      return (
        <g>
          <path d={`M${CX - 42} ${y - 4} Q${CX} ${y + 12} ${CX + 42} ${y - 4}`} stroke="#EA4335" strokeWidth={7} fill="none" strokeLinecap="round" />
          <circle cx={CX} cy={y + 12} r={9} fill="#FBBC04" {...o} />
          <path d={`M${CX - 4} ${y + 14}H${CX + 4}`} stroke="#B06000" strokeWidth={2} />
        </g>
      )
    case 'medal':
      return (
        <g>
          <path d={`M${CX - 16} ${y - 6} L${CX - 4} ${y + 16} M${CX + 16} ${y - 6} L${CX + 4} ${y + 16}`} stroke="#4285F4" strokeWidth={8} strokeLinecap="round" />
          <circle cx={CX} cy={y + 22} r={12} fill="#FBBC04" {...o} />
          <path d={`M${CX} ${y + 15} l2.4 5 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z`} fill="#fff" opacity={0.9} />
        </g>
      )
    case 'bandana':
      return <path d={`M${CX - 42} ${y - 4} Q${CX} ${y + 10} ${CX + 42} ${y - 4} L${CX} ${y + 30}Z`} fill="#4285F4" {...o} />
    default:
      return null
  }
}

export function PetSvg({ c, p, size = 200 }: { c: PetConfig; p: Pose; size?: number }) {
  const ghost = c.species === 'ghost'
  const breathe = 1 + Math.sin(p.t / (900 - c.energy * 400)) * 0.018
  const bob = ghost ? Math.sin(p.t / 500) * 6 - 6 : p.mood === 'dance' ? -Math.abs(Math.sin(p.t / 160)) * 14 : p.mood === 'walking' ? -Math.abs(Math.sin(p.walkPhase)) * 6 : 0
  const danceTilt = p.mood === 'dance' ? Math.sin(p.t / 160) * 10 : p.mood === 'stretch' ? Math.sin(p.t / 500) * 6 : 0
  const sx = 1 + p.squash * 0.18
  const sy = 1 - p.squash * 0.18
  const id = `b${c.species}`
  const body = bodyPath(c, p, breathe)
  const feetSwing = p.mood === 'carried' ? Math.sin(p.t / 120) * 8 : 0
  const step = p.mood === 'walking' ? Math.sin(p.walkPhase) * 6 : 0
  const listening = p.mood === 'listening'
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ overflow: 'visible', display: 'block' }}>
      <ellipse cx={CX} cy={190} rx={52 * (ghost ? 0.7 : 1) * (1 + p.squash * 0.2)} ry={7} fill="rgba(0,0,0,.18)" />
      <g transform={`translate(0 ${bob}) rotate(${p.lean + danceTilt} ${CX} 184) translate(${CX} 184) scale(${sx} ${sy}) translate(${-CX} -184)`}>
        <Parts c={c} p={p} back />
        {!ghost && (
          <g fill={shade(c.color, c.species === 'penguin' ? 0 : -0.08)} stroke="rgba(0,0,0,.16)" strokeWidth={3}>
            {c.species === 'penguin' ? (
              <>
                <ellipse cx={CX - 22 + step + feetSwing} cy={176} rx={15} ry={8} fill="#FBBC04" />
                <ellipse cx={CX + 22 - step - feetSwing} cy={176} rx={15} ry={8} fill="#FBBC04" />
              </>
            ) : (
              <>
                <ellipse cx={CX - 26 + step + feetSwing} cy={174} rx={16} ry={10} />
                <ellipse cx={CX + 26 - step - feetSwing} cy={174} rx={16} ry={10} />
              </>
            )}
          </g>
        )}
        <defs>
          <clipPath id={id}>
            <path d={body} />
          </clipPath>
        </defs>
        <path d={body} fill={c.color} stroke="rgba(0,0,0,.16)" strokeWidth={3} opacity={ghost ? 0.94 : 1} />
        <g clipPath={`url(#${id})`}>
          <Pattern c={c} />
          <ellipse cx={CX - 26} cy={CY - 40} rx={16} ry={9} fill="#fff" opacity={0.28} transform={`rotate(-24 ${CX - 26} ${CY - 40})`} />
        </g>
        <Parts c={c} p={p} back={false} />
        {/* cheeks */}
        {c.species !== 'robot' && [1, -1].map((s) => <ellipse key={s} cx={CX - s * 36} cy={CY + 10} rx={9} ry={5.5} fill="#FF6F91" opacity={c.face === 'blush' ? 0.6 : 0.28} />)}
        <Eyes c={c} p={p} />
        <Mouth c={c} p={p} />
        <Face c={c} />
        <Neck c={c} />
        <Head c={c} mood={p.mood} />
        {/* arms: wave when excited / dancing */}
        {c.species !== 'penguin' && c.species !== 'robot' && (
          <g fill={c.color} stroke="rgba(0,0,0,.16)" strokeWidth={3}>
            {[1, -1].map((s) => {
              const up = p.mood === 'excited' || p.mood === 'dance' || p.mood === 'stretch' || p.mood === 'carried'
              const a = up ? s * (-110 + Math.sin(p.t / 110 + (s > 0 ? 0 : 2)) * 25) : s * (-20 + Math.sin(p.t / 700) * 6)
              return <ellipse key={s} cx={CX - s * 62} cy={CY + 26} rx={8} ry={15} transform={`rotate(${a} ${CX - s * 56} ${CY + 14})`} />
            })}
          </g>
        )}
        {listening && (
          <g>
            <path d={`M${CX - 58} ${CY - 6} Q${CX} ${CY - 112} ${CX + 58} ${CY - 6}`} stroke="#1F1F1F" strokeWidth={8} fill="none" strokeLinecap="round" />
            {[1, -1].map((s) => <rect key={s} x={CX - s * 62 - 11} y={CY - 18} width={22} height={34} rx={10} fill="#4285F4" stroke="#1F1F1F" strokeWidth={3} />)}
          </g>
        )}
        {p.mood === 'writing' && (
          <g transform={`translate(${CX + 30} ${CY + 30}) rotate(-12)`}>
            <rect x={-26} y={-20} width={46} height={38} rx={5} fill="#fff" stroke="#1F1F1F" strokeWidth={3} />
            {[0, 1, 2].map((i) => <path key={i} d={`M-18 ${-10 + i * 9}H${-2 + Math.sin(p.t / 100 + i) * 8}`} stroke="#4285F4" strokeWidth={2.5} strokeLinecap="round" />)}
            <path d={`M${14 + Math.sin(p.t / 90) * 4} -4 L30 -26`} stroke="#FBBC04" strokeWidth={5} strokeLinecap="round" />
          </g>
        )}
      </g>
      {p.mood === 'stressed' && (
        <path d={`M${CX + 50} ${70 + ((p.t / 40) % 30)} q-7 12 0 16 q7 -4 0 -16z`} fill="#8AB4F8" stroke="#4285F4" strokeWidth={1.5} opacity={0.9} />
      )}
      {p.mood === 'sleepy' && (
        <g fontFamily="sans-serif" fontWeight={700} fill="#4285F4">
          {[0, 1, 2].map((i) => {
            const k = ((p.t / 1400 + i / 3) % 1)
            return (
              <text key={i} x={CX + 40 + k * 30} y={70 - k * 50} fontSize={14 + k * 12} opacity={1 - k}>
                z
              </text>
            )
          })}
        </g>
      )}
    </svg>
  )
}
