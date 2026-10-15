import { useEffect, useRef } from 'react'
import { Box, useTheme } from '@mui/material'
import { recorder } from '../audio/recorder'

/**
 * Live scrolling waveform: your voice in blue rises above the centre line, the other side in purple
 * mirrors below it. Driven by recorder levels (~12 Hz), drawn on a canvas.
 */
export function VoiceRibbon({ height = 56 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const theme = useTheme()
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const mic: number[] = []
    const sys: number[] = []
    let raf = 0
    let last = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 60) return
      last = now
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const st = recorder.state
      const bars = Math.floor(w / 6)
      mic.push(st.paused ? 0 : st.levels.mic)
      sys.push(st.paused ? 0 : st.levels.system)
      while (mic.length > bars) mic.shift()
      while (sys.length > bars) sys.shift()
      const mid = h / 2
      const grad = ctx.createLinearGradient(0, 0, w, 0)
      grad.addColorStop(0, theme.fs.you + '00')
      grad.addColorStop(0.25, theme.fs.you)
      grad.addColorStop(1, theme.fs.you)
      const grad2 = ctx.createLinearGradient(0, 0, w, 0)
      grad2.addColorStop(0, theme.fs.others + '00')
      grad2.addColorStop(0.25, theme.fs.others)
      grad2.addColorStop(1, theme.fs.others)
      const offset = w - mic.length * 6
      for (let i = 0; i < mic.length; i++) {
        const x = offset + i * 6
        const a = Math.max(1.5, Math.min(mid - 2, mic[i] * mid * 1.6))
        const b = Math.max(1.5, Math.min(mid - 2, sys[i] * mid * 1.6))
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.roundRect(x, mid - a - 1, 3, a, 1.5)
        ctx.fill()
        ctx.fillStyle = grad2
        ctx.beginPath()
        ctx.roundRect(x, mid + 1, 3, b, 1.5)
        ctx.fill()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [theme])
  return <Box component="canvas" ref={ref} sx={{ width: '100%', height, display: 'block' }} aria-label="Live audio levels: you above, others below" />
}
