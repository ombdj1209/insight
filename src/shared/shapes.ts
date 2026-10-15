/** Material 3 Expressive style shapes as radius functions, so one shape can morph into another. */
export type ShapeKind = 'circle' | 'cookie' | 'clover' | 'sunny' | 'flower' | 'puffy'

const SHAPES: Record<ShapeKind, { k: number; a: number; p?: number }> = {
  circle: { k: 1, a: 0 },
  cookie: { k: 9, a: 0.07 },
  clover: { k: 4, a: 0.16 },
  sunny: { k: 10, a: 0.08, p: 0.5 },
  flower: { k: 6, a: 0.12 },
  puffy: { k: 7, a: 0.09 }
}

const radius = (kind: ShapeKind, th: number): number => {
  const { k, a, p } = SHAPES[kind]
  const c = Math.cos(k * th)
  const w = p ? Math.sign(c) * Math.pow(Math.abs(c), p) : c
  return (1 + a * w) / (1 + a)
}

/** SVG path for shape `a` morphed toward `b` by m (0..1), centred at (cx, cy). sy squashes vertically. */
export function shapePath(cx: number, cy: number, r: number, a: ShapeKind, b: ShapeKind = a, m = 0, rot = 0, sy = 1, n = 96): string {
  let d = ''
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2
    const rr = r * (radius(a, th) * (1 - m) + radius(b, th) * m)
    const x = cx + Math.cos(th + rot) * rr
    const y = cy + Math.sin(th + rot) * rr * sy
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d + 'Z'
}
