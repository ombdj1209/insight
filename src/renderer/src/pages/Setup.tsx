import { t as tr } from '../i18n'
import React, { useEffect, useState } from 'react'
import { Box, Button, ButtonBase, CircularProgress, LinearProgress, Typography } from '@mui/material'
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded'
import MemoryRounded from '@mui/icons-material/MemoryRounded'
import LaptopRounded from '@mui/icons-material/LaptopRounded'
import TuneRounded from '@mui/icons-material/TuneRounded'
import BoltRounded from '@mui/icons-material/BoltRounded'
import CloudRounded from '@mui/icons-material/CloudRounded'
import { GOOGLE } from '../theme'
import { GeminiText } from '../components/ui'

const PRESET_LOOK: Record<string, [React.ReactNode, string]> = {
  light: [<LaptopRounded key="i" />, GOOGLE.blue],
  balanced: [<TuneRounded key="i" />, GOOGLE.green],
  full: [<BoltRounded key="i" />, GOOGLE.purple],
  cloud: [<CloudRounded key="i" />, GOOGLE.orange]
}
import type { ComponentStatus, HardwareInfo, PresetId, RuntimeStatus, UserSecret } from '../../../shared/types'
import { PRESETS } from '../../../shared/presets'
import type { AppCtx } from '../App'
import { api, fmtBytes } from '../api'
import { Logo } from '../components/Sidebar'
import { KeyField } from './Settings'

export function SetupPage({ ctx, components, runtime }: { ctx: AppCtx; components: ComponentStatus[]; runtime: RuntimeStatus }) {
  const [busy, setBusy] = useState(false)
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [keys, setKeys] = useState<Record<UserSecret, boolean>>({ gemini: false, openai: false, googleClientSecret: false })
  const s = ctx.settings
  const needed = components.filter((c) => c.required)
  const optional = components.filter((c) => !c.required)
  const allDone = needed.every((c) => c.installed)
  const llmOk = runtime.llm === 'ready' || runtime.llm === 'cloud'
  const ready = llmOk && runtime.embedder === 'ready'
  const needsGeminiKey = s.aiProvider === 'gemini' || (s.asrEngine === 'cloud' && s.cloudAsrProvider === 'gemini')

  useEffect(() => {
    void api.hardware().then(setHw)
    void api.secretStatus().then(setKeys)
  }, [])

  const run = async (ids?: ComponentStatus['id'][]) => {
    setBusy(true)
    try {
      await api.install(ids)
    } finally {
      setBusy(false)
    }
  }

  const choose = async (id: PresetId) => {
    await api.applyPreset(id)
    await ctx.reloadSettings()
  }

  const row = (c: ComponentStatus) => {
    const d = c.downloading
    return (
      <Box key={c.id} sx={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 1.5, alignItems: 'center', py: 1.25 }}>
        {c.installed ? (
          <CheckCircleRounded sx={{ color: '#1E8E3E' }} />
        ) : c.error ? (
          <ErrorOutlineRounded color="error" />
        ) : d ? (
          <CircularProgress size={20} />
        ) : (
          <RadioButtonUncheckedRounded sx={{ color: 'text.secondary' }} />
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body1" sx={{ fontWeight: 500 }}>
            {tr(c.name)}
            {c.sizeHint && !c.installed && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {c.sizeHint}
              </Typography>
            )}
          </Typography>
          <Typography variant="body2" color={c.error ? 'error' : 'text.secondary'}>
            {c.error ?? tr(c.description)}
          </Typography>
          {d && (
            <Box sx={{ mt: 1 }}>
              <LinearProgress variant={d.total ? 'determinate' : 'indeterminate'} value={d.total ? (d.received / d.total) * 100 : 0} />
              <Typography variant="caption" color="text.secondary">
                {d.file} {d.total ? tr("· {v0} of {v1}", { v0: fmtBytes(d.received), v1: fmtBytes(d.total) }) : ''}
              </Typography>
            </Box>
          )}
        </Box>
        {!c.installed && !d && !busy && (
          <Button size="small" onClick={() => void run([c.id])}>
            {c.error ? tr("Retry") : tr("Download")}
          </Button>
        )}
      </Box>
    )
  }

  const best = hw ? [...hw.gpus].sort((a, b) => b.vramMB - a.vramMB)[0] : undefined

  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      <Box sx={{ maxWidth: 920, mx: 'auto', px: { xs: 3, md: 6 }, pt: 6, pb: 8 }}>
        <Logo size={48} />
        <Typography variant="h3" component="h1" sx={{ mt: 2.5, fontVariationSettings: "'ROND' 50" }}>
          <GeminiText>{tr("Set up Insight")}</GeminiText>
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
          {tr("Pick how much runs on this PC. Speech recognition and search run locally in every option except Cloud. Downloads resume if interrupted.")}
        </Typography>

        <Box sx={(t) => ({ display: 'flex', gap: 2, alignItems: 'center', p: 2.5, borderRadius: 5, bgcolor: t.fs.container, mb: 2 })}>
          <MemoryRounded sx={(t) => ({ color: t.fs.primary })} />
          <Box sx={{ flex: 1 }}>
            {hw ? (
              <>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  {best ? tr("{name} · {v1} GB", { name: best.name, v1: (best.vramMB / 1024).toFixed(best.vramMB >= 10240 ? 0 : 1) }) : tr("No dedicated GPU found")} · {hw.ramGB}{' '}{tr("GB RAM ·")}{' '}{hw.cores}{' '}{tr("CPU threads")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {hw.reason}
                </Typography>
              </>
            ) : (
              <Typography color="text.secondary">{tr("Checking your hardware…")}</Typography>
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 1.5, mb: 3 }}>
          {PRESETS.map((p) => {
            const on = s.preset === p.id
            const [icon, color] = PRESET_LOOK[p.id]
            return (
              <ButtonBase
                key={p.id}
                disabled={busy}
                onClick={() => void choose(p.id)}
                sx={(t) => ({
                  display: 'block',
                  textAlign: 'start',
                  p: 2.25,
                  borderRadius: 6,
                  border: `2px solid ${on ? t.fs.primary : 'transparent'}`,
                  bgcolor: on ? t.fs.primaryContainer : t.fs.container,
                  color: on ? t.fs.onPrimaryContainer : 'text.primary',
                  transition: 'background 150ms, border-color 150ms',
                  '&:hover': { bgcolor: on ? t.fs.primaryContainer : t.fs.containerHigh }
                })}
              >
                <Box sx={{ width: 44, height: 44, borderRadius: 3, display: 'grid', placeItems: 'center', color: '#fff', bgcolor: color, mb: 1.5 }}>{icon}</Box>
                <Typography sx={{ fontWeight: 600, fontSize: 16 }}>
                  {tr(p.label)}
                  {hw?.recommended === p.id && (
                    <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.8 }}>
                      {tr("Recommended")}
                    </Typography>
                  )}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
                  {tr(p.description)}
                </Typography>
              </ButtonBase>
            )
          })}
        </Box>

        {needsGeminiKey && (
          <Box sx={(t) => ({ p: 2.5, borderRadius: 5, bgcolor: t.fs.container, mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' })}>
            <Box sx={{ flex: 1, minWidth: 260 }}>
              <Typography sx={{ fontWeight: 500 }}>{tr("Gemini API key")}</Typography>
              <Typography variant="body2" color="text.secondary">
                {tr("Create one free at aistudio.google.com. It is stored encrypted on this PC.")}
              </Typography>
            </Box>
            <KeyField name="gemini" saved={keys.gemini} onSaved={setKeys} />
          </Box>
        )}

        <Typography variant="h6">{tr("Required for this setup")}</Typography>
        {needed.map(row)}

        <Box sx={{ display: 'flex', gap: 1.5, mt: 2, alignItems: 'center' }}>
          {!allDone ? (
            <Button variant="contained" size="large" disabled={busy} onClick={() => void run()}>
              {busy ? tr("Downloading…") : tr("Download and set up")}
            </Button>
          ) : ready ? (
            <Button variant="contained" size="large" onClick={() => ctx.go({ page: 'home' })}>
              {tr("Start using Insight")}
            </Button>
          ) : (
            <Button variant="contained" size="large" onClick={() => void api.startRuntime()} disabled={runtime.embedder === 'starting' || runtime.llm === 'starting'}>
              {runtime.llm === 'starting' || runtime.embedder === 'starting' ? tr("Loading models…") : tr("Load models")}
            </Button>
          )}
        </Box>
        {runtime.message && (
          <Typography variant="body2" color="error" sx={{ mt: 2, whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace', fontSize: 12 }}>
            {runtime.message}
          </Typography>
        )}

        {optional.length > 0 && (
          <>
            <Typography variant="h6" sx={{ mt: 5 }}>
              {tr("More engines")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {tr("Install any of these to switch engines per meeting language without downloading later.")}
            </Typography>
            {optional.map(row)}
          </>
        )}
      </Box>
    </Box>
  )
}
