import { t as tr } from '../i18n'
import { useEffect, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Box, Button, ButtonBase, CircularProgress, Dialog, DialogActions, DialogContent, Typography } from '@mui/material'
import IosShareRounded from '@mui/icons-material/IosShareRounded'
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded'
import type { Recap } from '../../../shared/types'
import { DEFAULT_PET, type PetConfig } from '../../../shared/pet'
import type { AppCtx } from '../App'
import { api, cleanError } from '../api'
import { MOOD_SHAPE, PetSvg } from '../pet/PetSvg'

// Monday-first short weekday names in the interface language (2024-01-01 was a Monday)
const DAYS = (): string[] => [...Array(7)].map((_, i) => new Intl.DateTimeFormat(document.documentElement.lang || undefined, { weekday: 'short' }).format(new Date(2024, 0, 1 + i)))
const hm = (ms: number): string => {
  const h = Math.floor(ms / 3600_000)
  const m = Math.round((ms % 3600_000) / 60_000)
  return h ? tr("{h} h {m} min", { h, m }) : tr("{m} min", { m })
}
const range = (r: Recap): string => {
  const f = (t: number): string => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${f(r.from)} – ${f(r.to - 1)}`
}

/** 1200x630 share image: the user's pet plus the week in numbers (solid colours, no gradients). */
async function shareCard(r: Recap, pet: PetConfig): Promise<string> {
  await document.fonts.ready
  const c = document.createElement('canvas')
  c.width = 1200
  c.height = 630
  const g = c.getContext('2d')!
  g.direction = 'ltr' // fixed card layout; Arabic and Hebrew glyphs still shape correctly
  g.fillStyle = '#F8F9FA'
  g.fillRect(0, 0, 1200, 630)
  g.fillStyle = '#4285F4'
  g.fillRect(0, 0, 470, 630)
  const svg = renderToStaticMarkup(
    <PetSvg c={pet} p={{ t: 1200, mood: 'dance', look: { x: 0.2, y: 0 }, blink: false, squash: 0, lean: 0, walkPhase: 0, shape: { from: MOOD_SHAPE.dance, to: MOOD_SHAPE.dance, m: 1 } }} size={360} />
  ).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  const img = new Image()
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('pet image'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
  g.drawImage(img, 55, 150, 360, 360)
  const font = '"Google Sans Flex Variable", "Segoe UI", sans-serif'
  g.fillStyle = '#FFFFFF'
  g.font = `700 40px ${font}`
  g.fillText(pet.name || 'Insight', 60, 110)
  g.fillStyle = '#1F1F1F'
  g.font = `700 54px ${font}`
  g.fillText(tr('My week with Insight'), 530, 120)
  g.fillStyle = '#5E5E5E'
  g.font = `500 26px ${font}`
  g.fillText(range(r), 532, 165)
  const stats: [string, string][] = [
    [String(r.meetings), r.meetings === 1 ? 'meeting' : 'meetings'],
    [hm(r.totalMs), 'in meetings'],
    [String(r.promisesKept), 'promises kept'],
    [r.talkShare === null ? '–' : `${Math.round(r.talkShare * 100)}%`, 'of the talking was me']
  ]
  stats.forEach(([v, l], i) => {
    const x = 530 + (i % 2) * 320
    const y = 270 + Math.floor(i / 2) * 150
    g.fillStyle = ['#4285F4', '#EA4335', '#34A853', '#F29900'][i]
    g.font = `700 64px ${font}`
    g.fillText(v, x, y)
    g.fillStyle = '#444746'
    g.font = `500 26px ${font}`
    g.fillText(tr(l), x, y + 40)
  })
  g.fillStyle = '#1F1F1F'
  g.font = `700 24px ${font}`
  g.fillText(tr('Insight · Your meetings, understood.'), 530, 590)
  return c.toDataURL('image/png')
}

export function RecapDialog({ ctx, onClose }: { ctx: AppCtx; onClose: () => void }) {
  const [week, setWeek] = useState(0)
  const [r, setR] = useState<Recap | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setR(null)
    void api.recap(week).then(setR)
  }, [week])
  const card = async (copy: boolean): Promise<void> => {
    if (!r) return
    setBusy(true)
    try {
      const pet = (await api.petGet().catch(() => null))?.config ?? DEFAULT_PET
      const url = await shareCard(r, pet)
      if (copy) {
        await api.copyImage(url)
        ctx.toast(tr("Share card copied. Paste it anywhere."))
      } else if (await api.savePng(url, `insight-week-${new Date(r.from).toISOString().slice(0, 10)}.png`)) ctx.toast(tr("Share card saved."))
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const max = r ? Math.max(1, ...r.perDayMs) : 1
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogContent sx={{ pt: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="h5" sx={{ flex: 1 }}>
            {week === 0 ? tr("This week") : week === 1 ? tr("Last week") : tr("{week} weeks ago", { week })}
          </Typography>
          {[0, 1, 2].map((w) => (
            <Button key={w} size="small" variant={week === w ? 'contained' : 'text'} onClick={() => setWeek(w)}>
              {w === 0 ? tr("This week") : w === 1 ? tr("Last week") : tr("2 weeks ago")}
            </Button>
          ))}
        </Box>
        {!r ? (
          <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {range(r)}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.5, mt: 2 }}>
              {[
                [String(r.meetings), 'meetings'],
                [hm(r.totalMs), 'in meetings'],
                [`${r.promisesKept}/${r.promisesMade}`, 'promises kept'],
                [String(r.actionItems), 'action items'],
                [String(r.waitingOn), 'waiting on others']
              ].map(([v, l]) => (
                <Box key={l} sx={(t) => ({ p: 2, borderRadius: 4, bgcolor: t.fs.container })}>
                  <Typography sx={{ fontSize: 28, fontWeight: 700 }}>{v}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tr(l)}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
              {tr("Time in meetings by day")}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 110 }}>
              {r.perDayMs.map((ms, i) => (
                <Box key={i} sx={{ flex: 1, textAlign: 'center' }}>
                  <Box sx={(t) => ({ height: Math.max(4, (ms / max) * 80), borderRadius: 2, bgcolor: i === r.busiestDay ? t.fs.primary : t.fs.containerHighest })} title={hm(ms)} />
                  <Typography variant="caption" color="text.secondary">
                    {DAYS()[i]}
                  </Typography>
                </Box>
              ))}
            </Box>
            {r.talkShare !== null && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
                  {tr("Talk time: you spoke {pct}%", { pct: Math.round(r.talkShare * 100) })}
                </Typography>
                <Box sx={(t) => ({ height: 10, borderRadius: 5, bgcolor: t.fs.containerHighest, overflow: 'hidden' })}>
                  <Box sx={(t) => ({ width: `${r.talkShare! * 100}%`, height: '100%', bgcolor: t.fs.primary })} />
                </Box>
              </>
            )}
            {r.longest && (
              <Typography variant="body2" sx={{ mt: 2.5 }}>
                {tr("Longest meeting:")}{' '}
                <ButtonBase onClick={() => (onClose(), ctx.go({ page: 'meeting', meetingId: r.longest!.id }))} sx={{ color: 'primary.main', fontWeight: 600, verticalAlign: 'baseline' }}>
                  {r.longest.title}
                </ButtonBase>{' '}
                ({tr("{m} min", { m: r.longest.minutes })})
              </Typography>
            )}
            {r.couldBeEmail.length > 0 && (
              <Box sx={{ mt: 2.5 }}>
                <Typography variant="subtitle2">{tr("Could these have been an email?")}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {tr("No decisions or action items came out of them.")}
                </Typography>
                {r.couldBeEmail.map((m) => (
                  <Box key={m.id}>
                    <ButtonBase onClick={() => (onClose(), ctx.go({ page: 'meeting', meetingId: m.id }))} sx={{ color: 'primary.main', fontSize: 14 }}>
                      {m.title}
                    </ButtonBase>{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {tr("{m} min", { m: m.minutes })}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button startIcon={<ContentCopyRounded />} disabled={!r || busy} onClick={() => void card(true)}>
          {tr("Copy share card")}
        </Button>
        <Button startIcon={busy ? <CircularProgress size={16} /> : <IosShareRounded />} disabled={!r || busy} onClick={() => void card(false)}>
          {tr("Save share card")}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={onClose}>
          {tr("Done")}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** Compact "this week" strip for the home page. */
export function WeekStrip({ ctx }: { ctx: AppCtx }) {
  const [r, setR] = useState<Recap | null>(null)
  useEffect(() => void api.recap(0).then(setR), [])
  if (!r || !r.meetings) return null
  return (
    <ButtonBase onClick={ctx.openRecap} sx={(t) => ({ mt: 2.5, width: '100%', justifyContent: 'flex-start', gap: 3, px: 2.5, py: 1.75, borderRadius: 5, bgcolor: t.fs.container, textAlign: 'start', flexWrap: 'wrap', '&:hover': { bgcolor: t.fs.containerHigh } })}>
      <Typography sx={{ fontWeight: 700 }}>{tr("This week")}</Typography>
      <Typography color="text.secondary">
        {tr("{n} meetings · {time} · {kept} promises kept", { n: r.meetings, time: hm(r.totalMs), kept: r.promisesKept })}
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Typography sx={{ color: 'primary.main', fontWeight: 600 }}>{tr("See recap")}</Typography>
    </ButtonBase>
  )
}
