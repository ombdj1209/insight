import { t as tr } from '../i18n'
import React, { useEffect, useRef, useState } from 'react'
import { Box, Button, ButtonBase, CircularProgress, Collapse, LinearProgress, Switch, TextField, Typography } from '@mui/material'
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded'
import LaptopRounded from '@mui/icons-material/LaptopRounded'
import TuneRounded from '@mui/icons-material/TuneRounded'
import BoltRounded from '@mui/icons-material/BoltRounded'
import CloudRounded from '@mui/icons-material/CloudRounded'
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import { GOOGLE } from '../theme'
import { GeminiText } from '../components/ui'
import type { ComponentStatus, HardwareInfo, PresetId, RuntimeStatus } from '../../../shared/types'
import type { GoogleStatus } from '../../../shared/google'
import { PRESETS } from '../../../shared/presets'
import { DEFAULT_PET, SPECIES, type PetConfig, type Species } from '../../../shared/pet'
import type { AppCtx } from '../App'
import { api, cleanError, fmtBytes, useEvent } from '../api'
import { Logo } from '../components/Sidebar'
import { MOOD_SHAPE, PetSvg } from '../pet/PetSvg'

const PRESET_LOOK: Record<string, [React.ReactNode, string]> = {
  light: [<LaptopRounded key="i" />, GOOGLE.blue],
  balanced: [<TuneRounded key="i" />, GOOGLE.green],
  full: [<BoltRounded key="i" />, GOOGLE.purple],
  cloud: [<CloudRounded key="i" />, GOOGLE.orange]
}
type Step = 'welcome' | 'setup' | 'key' | 'accounts' | 'pet' | 'done'
type MsStatus = { configured: boolean; connected: boolean; email?: string; actionsNeedReconnect: boolean }

/** "What is this?" help that stays out of the way until asked. */
function Help({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Box sx={{ mt: 1.5 }}>
      <Button size="small" startIcon={<HelpOutlineRounded />} onClick={() => setOpen(!open)} sx={{ px: 1 }}>
        {title}
      </Button>
      <Collapse in={open}>
        <Box sx={(t) => ({ mt: 1, p: 2, borderRadius: 4, bgcolor: t.fs.container, fontSize: 14, lineHeight: 1.6, '& li': { mb: 0.5 } })}>{children}</Box>
      </Collapse>
    </Box>
  )
}

function Card({ children, on, onClick, disabled }: { children: React.ReactNode; on?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <ButtonBase
      disabled={disabled}
      onClick={onClick}
      sx={(t) => ({
        display: 'block',
        width: '100%',
        textAlign: 'start',
        p: 2.25,
        borderRadius: 6,
        border: `2px solid ${on ? t.fs.primary : 'transparent'}`,
        bgcolor: on ? t.fs.primaryContainer : t.fs.container,
        color: on ? t.fs.onPrimaryContainer : 'text.primary',
        '&:hover': { bgcolor: on ? t.fs.primaryContainer : t.fs.containerHigh }
      })}
    >
      {children}
    </ButtonBase>
  )
}

export function SetupPage({ ctx, components, runtime }: { ctx: AppCtx; components: ComponentStatus[]; runtime: RuntimeStatus }) {
  const s = ctx.settings
  const [step, setStep] = useState<Step>(s.onboarded ? 'setup' : 'welcome')
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [info, setInfo] = useState<{ googleBuiltIn: boolean; msBuiltIn: boolean; userName: string } | null>(null)
  const [name, setName] = useState(s.userName && s.userName !== 'You' ? s.userName : '')
  const [installing, setInstalling] = useState(false)
  const [installErr, setInstallErr] = useState('')
  const [keyOk, setKeyOk] = useState(false)
  const [key, setKey] = useState('')
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [g, setG] = useState<GoogleStatus | null>(null)
  const [ms, setMs] = useState<MsStatus | null>(null)
  const [signing, setSigning] = useState<'' | 'google' | 'ms'>('')
  const [pet, setPet] = useState<PetConfig | null>(null)
  const autoPicked = useRef(false)

  const needed = components.filter((c) => c.required)
  const allDone = needed.length > 0 && needed.every((c) => c.installed)
  const llmOk = runtime.llm === 'ready' || runtime.llm === 'cloud'
  const ready = allDone && llmOk && runtime.embedder === 'ready'
  const needsKey = s.aiProvider === 'gemini' || (s.asrEngine === 'cloud' && s.cloudAsrProvider === 'gemini')
  const failed = needed.find((c) => c.error)

  // overall download progress across the required pieces
  const totalBytes = needed.reduce((a, c) => a + (c.downloading?.total ?? 0), 0)
  const gotBytes = needed.reduce((a, c) => a + (c.downloading?.received ?? 0), 0)
  const doneShare = needed.length ? needed.filter((c) => c.installed).length / needed.length : 0
  const current = needed.find((c) => c.downloading)

  useEffect(() => {
    void api.hardware().then(setHw)
    void api.setupInfo().then((i) => {
      setInfo(i)
      setName((n) => n || i.userName)
    })
    void api.secretStatus().then((k) => setKeyOk(k.gemini))
    void api.googleStatus().then(setG)
    void api.msStatus().then(setMs)
    void api.petGet().then((r) => setPet(r.config))
  }, [])
  useEvent('google:changed', setG)
  useEvent('ms:changed', setMs)
  useEvent('pet:config', setPet)

  // first run: pre-select the recommended setup once the hardware is known
  useEffect(() => {
    if (!hw || autoPicked.current || s.onboarded || allDone) return
    autoPicked.current = true
    if (s.preset !== hw.recommended) void api.applyPreset(hw.recommended).then(() => ctx.reloadSettings())
  }, [hw, s.onboarded, s.preset, allDone, ctx])

  const choose = async (id: PresetId): Promise<void> => {
    await api.applyPreset(id)
    await ctx.reloadSettings()
  }
  const install = (): void => {
    setInstalling(true)
    setInstallErr('')
    void api
      .install()
      .catch((e) => setInstallErr(cleanError(e)))
      .finally(() => {
        setInstalling(false)
        void api.startRuntime().catch(() => undefined)
      })
  }
  const next = (from: Step): void => {
    const order: Step[] = ['welcome', 'setup', 'key', 'accounts', 'pet', 'done']
    let i = order.indexOf(from) + 1
    if (order[i] === 'key' && !needsKey) i++
    setStep(order[i])
  }
  const back = (from: Step): void => {
    const order: Step[] = ['welcome', 'setup', 'key', 'accounts', 'pet', 'done']
    let i = order.indexOf(from) - 1
    if (order[i] === 'key' && !needsKey) i--
    setStep(order[Math.max(0, i)])
  }
  const checkKey = async (): Promise<void> => {
    setChecking(true)
    setKeyMsg(null)
    const err = await api.checkGeminiKey(key).catch((e) => cleanError(e))
    if (!err) {
      await api.setSecret('gemini', key)
      setKeyOk(true)
      setKeyMsg({ ok: true, text: tr('Key works. Saved, encrypted on this PC.') })
    } else setKeyMsg({ ok: false, text: tr(err) })
    setChecking(false)
  }
  const signIn = async (which: 'google' | 'ms'): Promise<void> => {
    setSigning(which)
    try {
      if (which === 'google') setG(await api.connectGoogle())
      else setMs(await api.msConnect())
      ctx.toast(which === 'google' ? tr('Google connected') : tr('Microsoft 365 connected'))
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setSigning('')
    }
  }
  const finish = async (page: 'home' | 'listen'): Promise<void> => {
    await ctx.saveSettings({ onboarded: true })
    if (page === 'listen') void ctx.startListening()
    else ctx.go({ page: 'home' })
  }

  const steps: Step[] = ['welcome', 'setup', ...(needsKey ? (['key'] as Step[]) : []), 'accounts', 'pet', 'done']
  const best = hw ? [...hw.gpus].sort((a, b) => b.vramMB - a.vramMB)[0] : undefined

  // a small, always-visible download status once installing has started
  const progress = (installing || current || (allDone && !ready)) && (
    <Box sx={(t) => ({ mt: 3, p: 2, borderRadius: 4, bgcolor: t.fs.container })}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {allDone ? (ready ? tr('Everything is ready.') : tr('Downloads finished. Starting the models…')) : current ? tr('Downloading {name}…', { name: tr(current.name) }) : tr('Preparing downloads…')}
      </Typography>
      <LinearProgress sx={{ mt: 1, height: 8, borderRadius: 4 }} variant={totalBytes || doneShare ? 'determinate' : 'indeterminate'} value={(doneShare + (totalBytes ? (gotBytes / totalBytes) * (1 / Math.max(1, needed.length)) : 0)) * 100} />
      {current?.downloading?.total ? (
        <Typography variant="caption" color="text.secondary">
          {fmtBytes(current.downloading.received)} / {fmtBytes(current.downloading.total)} · {tr('You can keep going; downloads continue in the background and resume if interrupted.')}
        </Typography>
      ) : null}
    </Box>
  )

  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      <Box sx={{ maxWidth: 820, mx: 'auto', px: { xs: 3, md: 6 }, pt: 5, pb: 8 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Logo size={40} />
          <Box sx={{ flex: 1 }} />
          {/* progress dots */}
          {steps.map((st) => (
            <Box key={st} sx={(t) => ({ width: st === step ? 26 : 10, height: 10, borderRadius: 5, bgcolor: st === step ? t.fs.primary : steps.indexOf(st) < steps.indexOf(step) ? t.fs.primaryContainer : t.fs.containerHigh, transition: 'width 200ms' })} />
          ))}
        </Box>

        {step !== 'welcome' && step !== 'done' && (
          <Button startIcon={<ArrowBackRounded />} onClick={() => back(step)} sx={{ mt: 2, ml: -1 }}>
            {tr('Back')}
          </Button>
        )}

        {/* ---------- 1. welcome ---------- */}
        {step === 'welcome' && (
          <Box sx={{ mt: 6 }}>
            <Typography variant="h3" component="h1" sx={{ fontVariationSettings: "'ROND' 50" }}>
              <GeminiText>{tr('Welcome to Insight')}</GeminiText>
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ mt: 1.5, fontWeight: 400 }}>
              {tr('Your meetings, understood. Setup takes about two minutes; we will walk you through it.')}
            </Typography>
            <Typography sx={{ mt: 5, fontWeight: 600 }}>{tr('What should we call you?')}</Typography>
            <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Your first name')} sx={{ mt: 1, width: 360, bgcolor: 'background.paper' }} autoFocus />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {tr('Used to label your voice in transcripts and to greet you.')}
            </Typography>
            <Button
              variant="contained"
              size="large"
              sx={{ mt: 4 }}
              onClick={() => {
                void ctx.saveSettings({ userName: name.trim() || 'You' })
                next('welcome')
              }}
            >
              {tr("Let's go")}
            </Button>
          </Box>
        )}

        {/* ---------- 2. setup ---------- */}
        {step === 'setup' && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="h4" component="h1">
              {tr('How should Insight run?')}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {hw
                ? best
                  ? tr('We checked this PC: {gpu}, {ram} GB RAM. The recommended option is selected.', { gpu: best.name, ram: hw.ramGB })
                  : tr('We checked this PC: no dedicated graphics card, {ram} GB RAM. The recommended option is selected.', { ram: hw.ramGB })
                : tr('Checking this PC…')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1.5, mt: 3 }}>
              {PRESETS.map((p) => {
                const [icon, color] = PRESET_LOOK[p.id]
                return (
                  <Card key={p.id} on={s.preset === p.id} disabled={installing} onClick={() => void choose(p.id)}>
                    <Box sx={{ width: 40, height: 40, borderRadius: 3, display: 'grid', placeItems: 'center', color: '#fff', bgcolor: color, mb: 1.25 }}>{icon}</Box>
                    <Typography sx={{ fontWeight: 600 }}>
                      {tr(p.label)}
                      {hw?.recommended === p.id && (
                        <Typography component="span" variant="caption" sx={{ ml: 1, fontWeight: 700, color: GOOGLE.green }}>
                          {tr('Recommended')}
                        </Typography>
                      )}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
                      {tr(p.description)}
                    </Typography>
                  </Card>
                )
              })}
            </Box>
            <Help title={tr('Which one should I pick?')}>
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                <li>{tr('Not sure? Keep the recommended one. You can switch any time in Settings.')}</li>
                <li>{tr('"On this PC" options keep audio and notes completely offline but need a stronger computer.')}</li>
                <li>{tr('Light and Cloud use Google Gemini for notes (a free key, we will help you get one). Speech recognition and search still run on this PC with Light.')}</li>
              </ul>
            </Help>
            {failed && (
              <Typography color="error" sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <ErrorOutlineRounded fontSize="small" /> {tr('{name} could not be downloaded: {err}', { name: tr(failed.name), err: failed.error ?? '' })}
              </Typography>
            )}
            {installErr && <Typography color="error" sx={{ mt: 2 }}>{installErr}</Typography>}
            <Box sx={{ display: 'flex', gap: 1.5, mt: 4, alignItems: 'center' }}>
              <Button
                variant="contained"
                size="large"
                onClick={() => {
                  if (!allDone && !installing) install()
                  next('setup')
                }}
              >
                {allDone ? tr('Continue') : failed ? tr('Retry and continue') : tr('Set it up')}
              </Button>
              {!allDone && (
                <Typography variant="body2" color="text.secondary">
                  {tr('About {size}. Downloads run in the background while you finish the next steps.', { size: needed.filter((c) => !c.installed).map((c) => c.sizeHint).filter(Boolean).join(' + ') || tr('a few minutes') })}
                </Typography>
              )}
            </Box>
            {progress}
          </Box>
        )}

        {/* ---------- 3. Gemini key (only when the setup uses it) ---------- */}
        {step === 'key' && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="h4" component="h1">
              {tr('Get your free Gemini key')}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {tr('Your setup writes notes with Google Gemini. It needs a key, which is free and takes a minute.')}
            </Typography>
            {keyOk ? (
              <Typography sx={{ mt: 4, display: 'flex', alignItems: 'center', gap: 1, fontWeight: 600, color: '#1E8E3E' }}>
                <CheckCircleRounded /> {tr('Your Gemini key is saved.')}
              </Typography>
            ) : (
              <>
                <Box component="ol" sx={{ mt: 3, pl: 3, '& li': { mb: 1.5 } }}>
                  <li>
                    <Button variant="outlined" endIcon={<OpenInNewRounded />} onClick={() => void api.openExternal('https://aistudio.google.com/apikey')}>
                      {tr('Open Google AI Studio')}
                    </Button>
                  </li>
                  <li>{tr('Sign in with any Google account and press "Create API key".')}</li>
                  <li>{tr('Copy the key and paste it here:')}</li>
                </Box>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                  <TextField value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" type="password" sx={{ width: 420, bgcolor: 'background.paper' }} />
                  <Button variant="contained" size="large" disabled={key.trim().length < 20 || checking} onClick={() => void checkKey()} sx={{ height: 56 }}>
                    {checking ? <CircularProgress size={22} /> : tr('Check key')}
                  </Button>
                </Box>
              </>
            )}
            {keyMsg && (
              <Typography sx={{ mt: 1.5, color: keyMsg.ok ? '#1E8E3E' : 'error.main' }} variant="body2">
                {keyMsg.text}
              </Typography>
            )}
            <Help title={tr('Is this safe? What does it cost?')}>
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                <li>{tr('The key is stored encrypted on this PC (Windows DPAPI) and only ever sent to Google.')}</li>
                <li>{tr('Gemini Flash-Lite has a free tier that covers typical meeting use. Google may change its limits.')}</li>
                <li>{tr('Search, your files and the meeting audio stay on this PC with the Light setup.')}</li>
              </ul>
            </Help>
            <Box sx={{ display: 'flex', gap: 1.5, mt: 4 }}>
              <Button variant="contained" size="large" disabled={!keyOk} onClick={() => next('key')}>
                {tr('Continue')}
              </Button>
              <Button size="large" onClick={() => next('key')}>
                {tr('I will add it later')}
              </Button>
            </Box>
            {progress}
          </Box>
        )}

        {/* ---------- 4. accounts ---------- */}
        {step === 'accounts' && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="h4" component="h1">
              {tr('Connect your work accounts')}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {tr('Optional. Adds meeting reminders with a Join button, briefs before meetings, and answers from your mail and calendar.')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 2, mt: 3 }}>
              {(
                [
                  ['google', 'Google', 'Gmail · Calendar · Drive · Chat', GOOGLE.blue, info?.googleBuiltIn || g?.clientConfigured, g?.connected, g?.email],
                  ['ms', 'Microsoft 365', 'Outlook · Calendar · Teams · To Do', '#5B5FC7', info?.msBuiltIn || ms?.configured, ms?.connected, ms?.email]
                ] as [('google' | 'ms'), string, string, string, boolean | undefined, boolean | undefined, string | undefined][]
              ).map(([id, label, what, color, available, connected, email]) => (
                <Box key={id} sx={(t) => ({ p: 2.5, borderRadius: 6, bgcolor: t.fs.container })}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ width: 40, height: 40, borderRadius: 3, bgcolor: color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>{label[0]}</Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>{label}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {what}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ mt: 2 }}>
                    {connected ? (
                      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#1E8E3E', fontWeight: 600 }}>
                        <CheckCircleRounded fontSize="small" /> {email ? tr('Connected as {email}', { email }) : tr('Connected')}
                      </Typography>
                    ) : available ? (
                      <Button variant="contained" disabled={!!signing} onClick={() => void signIn(id)}>
                        {signing === id ? tr('Finish signing in in your browser…') : tr('Connect {name}', { name: label })}
                      </Button>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {tr('One-click sign-in is not set up in this copy of Insight. You can connect your own app later in Settings.')}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
            <Help title={tr('What can Insight see? Is it safe?')}>
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                <li>{tr('Read-only. Insight looks things up only when you ask a question, write a brief, or check a reminder.')}</li>
                <li>{tr('Nothing is uploaded to Insight. The sign-in token stays encrypted on this PC.')}</li>
                <li>{tr('Insight never sends email. Drafts, tasks and invites need "Allow actions" in Settings, and every action asks you first.')}</li>
                <li>{tr('Disconnect any time in Settings; that deletes the token.')}</li>
                <li>{tr('Sign-in opens in your browser. If your company blocks third-party apps, ask your IT admin to approve Insight.')}</li>
              </ul>
            </Help>
            <Box sx={{ display: 'flex', gap: 1.5, mt: 4 }}>
              <Button variant="contained" size="large" onClick={() => next('accounts')}>
                {g?.connected || ms?.connected ? tr('Continue') : tr('Skip for now')}
              </Button>
            </Box>
            {progress}
          </Box>
        )}

        {/* ---------- 5. pet ---------- */}
        {step === 'pet' && pet && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="h4" component="h1">
              {tr('Meet your desk buddy')}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {tr('A little pet that lives on your desktop: it reminds you about meetings, notices calls, keeps your promises and cheers you on. Click-through everywhere except the pet.')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 3 }}>
              <Switch checked={pet.enabled} onChange={(e) => void api.petSet({ enabled: e.target.checked })} />
              <Typography sx={{ fontWeight: 600 }}>{tr('Show a pet on my desktop')}</Typography>
            </Box>
            <Collapse in={pet.enabled}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1.5, mt: 2 }}>
                {SPECIES.map((sp) => (
                  <Card key={sp.id} on={pet.species === sp.id} onClick={() => void api.petSet({ species: sp.id as Species, color: sp.color, accent: sp.accent })}>
                    <Box sx={{ display: 'grid', placeItems: 'center' }}>
                      <PetSvg c={{ ...DEFAULT_PET, ...pet, species: sp.id as Species, color: sp.color, accent: sp.accent }} p={{ t: 0, mood: 'happy', look: { x: 0, y: 0 }, blink: false, squash: 0, lean: 0, walkPhase: 0, shape: { from: MOOD_SHAPE.happy, to: MOOD_SHAPE.happy, m: 0 } }} size={88} />
                    </Box>
                    <Typography variant="body2" sx={{ textAlign: 'center', fontWeight: 600, mt: 0.5 }}>
                      {tr(sp.label)}
                    </Typography>
                  </Card>
                ))}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2.5 }}>
                <Typography sx={{ fontWeight: 600 }}>{tr('Name')}</Typography>
                <TextField size="small" defaultValue={pet.name} onBlur={(e) => void api.petSet({ name: e.target.value.trim().slice(0, 20) || 'Pip' })} sx={{ width: 220, bgcolor: 'background.paper' }} />
                <Typography variant="body2" color="text.secondary">
                  {tr('Colours, outfits and more under Pet.')}
                </Typography>
              </Box>
            </Collapse>
            <Box sx={{ display: 'flex', gap: 1.5, mt: 4 }}>
              <Button variant="contained" size="large" onClick={() => next('pet')}>
                {tr('Continue')}
              </Button>
            </Box>
            {progress}
          </Box>
        )}

        {/* ---------- 6. done ---------- */}
        {step === 'done' && (
          <Box sx={{ mt: 6 }}>
            <Typography variant="h3" component="h1" sx={{ fontVariationSettings: "'ROND' 50" }}>
              <GeminiText>{ready ? tr("You're all set, {name}!", { name: s.userName && s.userName !== 'You' ? s.userName : '' }).replace(', !', '!') : tr('Almost there…')}</GeminiText>
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ mt: 1.5, fontWeight: 400 }}>
              {ready ? tr('Next time a call starts, press Start listening, or let your pet offer it. Notes appear while people talk.') : tr('Insight finishes downloading in the background. You can look around in the meantime.')}
            </Typography>
            {!ready && progress}
            {!ready && !installing && !current && !allDone && (
              <Button sx={{ mt: 2 }} variant="outlined" onClick={install}>
                {tr('Start the download')}
              </Button>
            )}
            {runtime.message && !ready && allDone && (
              <Typography variant="body2" color="error" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>
                {runtime.message}
              </Typography>
            )}
            <Box sx={(t) => ({ mt: 4, p: 2.5, borderRadius: 5, bgcolor: t.fs.container })}>
              <Typography sx={{ fontWeight: 600, mb: 1 }}>{tr('Good to know')}</Typography>
              <Typography variant="body2" sx={{ lineHeight: 1.8 }}>
                {tr('Ctrl + Shift + Space starts or stops listening from any app.')}
                <br />
                {tr('Ctrl + K searches your meetings and files.')}
                <br />
                {tr('Add your project folders under Knowledge so Insight can answer from them.')}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, mt: 4 }}>
              <Button variant="contained" size="large" disabled={!ready} onClick={() => void finish('listen')}>
                {tr('Try it: start listening')}
              </Button>
              <Button size="large" variant={ready ? 'text' : 'contained'} onClick={() => void finish('home')}>
                {tr('Open Insight')}
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}
