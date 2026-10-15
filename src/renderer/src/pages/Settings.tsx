import { t as tr } from '../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { Box, Button, Chip, MenuItem, Select, Slider, Switch, TextField, Typography } from '@mui/material'
import type { AsrEngine, PresetId, RuntimeStatus, UserSecret, Settings } from '../../../shared/types'
import { LANGUAGES, WORLD } from '../../../shared/languages'
import { ENGINE_LABELS, resolveAsrEngine } from '../../../shared/engines'
import { PRESETS } from '../../../shared/presets'
import { TEMPLATES } from '../../../shared/templates'
import type { AppCtx } from '../App'
import { api, cleanError, useEvent } from '../api'
import { Segmented } from '../components/ui'
import { GOOGLE } from '../theme'
import TuneRounded from '@mui/icons-material/TuneRounded'
import RecordVoiceOverRounded from '@mui/icons-material/RecordVoiceOverRounded'
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded'
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded'
import TipsAndUpdatesRounded from '@mui/icons-material/TipsAndUpdatesRounded'
import FolderCopyRounded from '@mui/icons-material/FolderCopyRounded'
import PaletteRounded from '@mui/icons-material/PaletteRounded'
import ShieldRounded from '@mui/icons-material/ShieldRounded'
import AccountCircleRounded from '@mui/icons-material/AccountCircleRounded'
import { GOOGLE_SERVICE_IDS, GOOGLE_SERVICES, OAUTH_REDIRECT, type GoogleStatus } from '../../../shared/google'

const SECTION_ICONS: Record<string, [ReactNode, string]> = {
  'Setup preset': [<TuneRounded key="i" />, GOOGLE.blue],
  'Meeting language and speech recognition': [<RecordVoiceOverRounded key="i" />, GOOGLE.green],
  'Audio and speakers': [<GraphicEqRounded key="i" />, GOOGLE.cyan],
  'AI model for notes, chat and Live Assistance': [<AutoAwesomeRounded key="i" />, GOOGLE.purple],
  'Notes and Live Assistance': [<TipsAndUpdatesRounded key="i" />, GOOGLE.orange],
  Knowledge: [<FolderCopyRounded key="i" />, GOOGLE.pink],
  App: [<PaletteRounded key="i" />, GOOGLE.blue],
  'Storage and privacy': [<ShieldRounded key="i" />, GOOGLE.green],
  'Google account': [<AccountCircleRounded key="i" />, GOOGLE.blue]
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const [icon, color] = SECTION_ICONS[title] ?? [null, GOOGLE.blue]
  return (
    <Box component="section" sx={{ mt: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25, px: 0.5 }}>
        {icon && <Box sx={{ width: 36, height: 36, borderRadius: 2.5, display: 'grid', placeItems: 'center', color, bgcolor: `${color}1F` }}>{icon}</Box>}
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
          {tr(title)}
        </Typography>
      </Box>
      <Box sx={(t) => ({ borderRadius: 6, bgcolor: t.fs.container, overflow: 'hidden' })}>{children}</Box>
    </Box>
  )
}

export function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Box
      sx={(t) => ({
        display: 'grid',
        gridTemplateColumns: '1fr minmax(220px, auto)',
        alignItems: 'center',
        gap: 3,
        px: 3,
        py: 2,
        '& + &': { borderTop: `1px solid ${t.fs.sheet}` }
      })}
    >
      <Box>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {title}
        </Typography>
        {hint && (
          <Typography variant="body2" color="text.secondary" component="div">
            {hint}
          </Typography>
        )}
      </Box>
      <Box sx={{ justifySelf: 'end' }}>{children}</Box>
    </Box>
  )
}

export function KeyField({ name, saved, onSaved, placeholder = tr('Paste API key') }: { name: UserSecret; saved: boolean; onSaved: (s: Record<UserSecret, boolean>) => void; placeholder?: string }) {
  const [v, setV] = useState('')
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
      <TextField
        size="small"
        type="password"
        placeholder={saved ? tr("Saved (encrypted)") : placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        sx={{ width: 220, bgcolor: 'background.paper' }}
      />
      <Button variant="outlined" disabled={!v} onClick={() => void api.setSecret(name, v).then((s) => (onSaved(s), setV('')))}>
        {tr("Save")}
      </Button>
      {saved && (
        <Button color="error" onClick={() => void api.setSecret(name, '').then(onSaved)}>
          {tr("Remove")}
        </Button>
      )}
    </Box>
  )
}

export function SettingsPage({ ctx, runtime }: { ctx: AppCtx; runtime: RuntimeStatus }) {
  const s = ctx.settings
  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => void ctx.saveSettings({ [k]: v } as Partial<Settings>)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [home, setHome] = useState('')
  const [keys, setKeys] = useState<Record<UserSecret, boolean>>({ gemini: false, openai: false, googleClientSecret: false })

  useEffect(() => {
    void navigator.mediaDevices.enumerateDevices().then((d) => setMics(d.filter((x) => x.kind === 'audioinput')))
    void api.home().then(setHome)
    void api.secretStatus().then(setKeys)
  }, [])

  const sel = (value: string, onChange: (v: string) => void, items: [string, string][], width = 260) => (
    <Select size="small" value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: width, bgcolor: 'background.paper' }}>
      {items.map(([v, l]) => (
        <MenuItem key={v} value={v}>
          {tr(l)}
        </MenuItem>
      ))}
    </Select>
  )
  const text = (k: 'googleClientId' | 'msClientId' | 'msTenant' | 'voiceHotkey' | 'captionsHotkey' | 'geminiModel' | 'openaiBaseUrl' | 'openaiModel' | 'cloudAsrModel' | 'hotkey' | 'extraLlamaArgs' | 'hfToken', width = 260, type = 'text') => (
    <TextField key={`${k}-${s[k]}`} size="small" type={type} defaultValue={s[k]} onBlur={(e) => set(k, e.target.value.trim())} sx={{ width, bgcolor: 'background.paper' }} />
  )
  const usesCloud = s.aiProvider !== 'local' || s.asrEngine === 'cloud'
  const resolved = resolveAsrEngine(s)

  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      <Box sx={{ maxWidth: 920, mx: 'auto', px: { xs: 3, md: 6 }, pt: 5, pb: 10 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h4" component="h1" sx={{ flex: 1 }}>
            {tr("Settings")}
          </Typography>
          <Chip
            label={usesCloud ? tr("Uses cloud APIs") : tr("Fully offline")}
            sx={(t) => ({
              fontWeight: 600,
              bgcolor: usesCloud ? (t.palette.mode === 'light' ? '#FFF0D1' : '#4A3200') : t.fs.tertiaryContainer,
              color: usesCloud ? (t.palette.mode === 'light' ? '#5C3B00' : '#FFDDB0') : t.fs.onTertiaryContainer
            })}
          />
        </Box>

        <Section title="Setup preset">
          <Row title={tr("Preset")} hint={PRESETS.find((p) => p.id === s.preset)?.description ?? tr("Custom combination of the options below.")}>
            {sel(s.preset, (v) => v !== 'custom' && void api.applyPreset(v as PresetId).then(() => ctx.reloadSettings()), [
              ...PRESETS.map((p) => [p.id, p.label] as [string, string]),
              ['custom', 'Custom']
            ])}
          </Row>
        </Section>

        <Section title="Meeting language and speech recognition">
          <Row title={tr("Meeting language")} hint={tr("Japanese + English keeps both languages as spoken.")}>
            {sel(s.language, (v) => set('language', v), LANGUAGES.map((l) => [l.name, l.name]))}
          </Row>
          <Row
            title={tr("Engine")}
            hint={
              s.asrEngine === 'auto' ? tr("For {language}: {v1}. Falls back to any installed engine.", { language: tr(s.language), v1: tr(ENGINE_LABELS[resolved]) }) : tr("Engines not yet downloaded can be added from Setup.")
            }
          >
            {sel(s.asrEngine, (v) => set('asrEngine', v as AsrEngine), Object.entries(ENGINE_LABELS) as [string, string][], 320)}
          </Row>
          <Row title={tr("CPU threads for speech")} hint={tr("More threads transcribe faster. Half your cores is a good default.")}>
            <TextField
              size="small"
              type="number"
              defaultValue={s.sherpaThreads}
              onBlur={(e) => set('sherpaThreads', Math.max(1, Math.min(32, Number(e.target.value) || 4)))}
              sx={{ width: 100, bgcolor: 'background.paper' }}
            />
          </Row>
          {(s.asrEngine === 'whisper' || resolved === 'whisper') && (
            <Row title={tr("Whisper model")}>
              {sel(s.whisperModel, (v) => set('whisperModel', v as Settings['whisperModel']), [
                ['large-v3-turbo', 'large-v3-turbo (best, ~550 MB)'],
                ['base', 'base (fast, ~150 MB)']
              ])}
            </Row>
          )}
          {s.asrEngine === 'cloud' && (
            <>
              <Row title={tr("Cloud transcription provider")} hint={tr("Audio segments are sent to this service.")}>
                <Segmented value={s.cloudAsrProvider} onChange={(v) => set('cloudAsrProvider', v)} options={[['gemini', 'Gemini'], ['openai', 'OpenAI-compatible']]} />
              </Row>
              <Row title={tr("Transcription model")} hint={s.cloudAsrProvider === 'gemini' ? tr("e.g. gemini-flash-latest") : tr("e.g. whisper-1, gpt-4o-transcribe, whisper-large-v3-turbo (Groq)")}>
                {text('cloudAsrModel')}
              </Row>
            </>
          )}
        </Section>

        <Section title="Audio and speakers">
          <Row title={tr("Microphone")}>
            {sel(s.micDeviceId, (v) => set('micDeviceId', v), [
              ['default', 'System default'],
              ...mics.filter((m) => m.deviceId !== 'default').map((m) => [m.deviceId, m.label || 'Microphone'] as [string, string])
            ])}
          </Row>
          <Row title={tr("Capture system audio")} hint={tr("Records what your PC plays: Teams, Zoom, Meet in a browser. Uses Windows loopback; no bot joins the call.")}>
            <Switch checked={s.captureSystemAudio} onChange={(e) => set('captureSystemAudio', e.target.checked)} />
          </Row>
          <Row title={tr("Tell speakers apart")} hint={tr("Labels each voice Speaker 1, 2, 3 instead of Others. Click a name in the transcript to rename it.")}>
            <Switch checked={s.diarization} onChange={(e) => set('diarization', e.target.checked)} />
          </Row>
          <Row title={tr("In-room meeting")} hint={tr("Several people share your microphone. Speakers are separated on the mic too, and the echo filter is off.")}>
            <Switch checked={s.inRoomMode} onChange={(e) => set('inRoomMode', e.target.checked)} />
          </Row>
          <Row title={tr("Echo filter")} hint={tr("On speakers, your mic also hears the other side. Drops those duplicate lines. Turn off with headphones.")}>
            <Switch checked={s.echoFilter} onChange={(e) => set('echoFilter', e.target.checked)} />
          </Row>
          <Row title={tr("Notice when a call starts")} hint={tr("When Zoom, Teams, Meet, Webex or Slack starts using your microphone, your pet (or a notification) offers to take notes.")}>
            <Switch checked={s.autoDetectCalls} onChange={(e) => set('autoDetectCalls', e.target.checked)} />
          </Row>
          <Row
            title={tr("Capture slides")}
            hint={tr("While listening, saves each new slide or shared document from your screen and reads its text into the notes and search. Insight samples your primary screen only while recording; images stay on this PC, their text goes to your AI provider.")}
          >
            <Switch checked={s.captureSlides} disabled={!s.captureSystemAudio} onChange={(e) => set('captureSlides', e.target.checked)} />
          </Row>
        </Section>

        <Section title="Live captions">
          <Row title={tr("Translate captions to")} hint={tr("A small always-on-top bar shows what is said while Insight listens, with a translation underneath. Each line is translated by your AI provider.")}>
            <Select size="small" value={s.captionsLanguage} onChange={(e) => set('captionsLanguage', e.target.value)} sx={{ minWidth: 240, bgcolor: 'background.paper' }} MenuProps={{ PaperProps: { sx: { maxHeight: 420 } } }}>
              <MenuItem value="">{tr("No translation")}</MenuItem>
              {WORLD.map((w) => (
                <MenuItem key={w.name} value={w.name}>
                  {w.native}
                  {w.native !== w.name ? ` · ${w.name}` : ''}
                </MenuItem>
              ))}
            </Select>
          </Row>
          <Row title={tr("Show or hide captions")} hint={tr("Also in the tray menu and your pet's menu.")}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              {text('captionsHotkey', 240)}
              <Button variant="outlined" onClick={() => void api.captionsToggle()}>
                {tr("Toggle now")}
              </Button>
            </Box>
          </Row>
        </Section>

        <Section title="AI model for notes, chat and Live Assistance">
          <Row title={tr("Provider")} hint={tr("Search always stays on this PC. With a cloud provider, transcripts (never audio) are sent for notes and answers.")}>
            <Segmented value={s.aiProvider} onChange={(v) => set('aiProvider', v)} options={[['local', 'On this PC'], ['gemini', 'Gemini'], ['openai', 'OpenAI-compatible']]} />
          </Row>
          {s.aiProvider === 'local' && (
            <>
              <Row title={tr("Gemma 4 model")} hint={tr("Changing the model downloads it from Setup.")}>
                {sel(s.llmModel, (v) => set('llmModel', v as Settings['llmModel']), [
                  ['gemma-4-E4B', 'Gemma 4 E4B Q8_0 (recommended)'],
                  ['gemma-4-E4B-Q4', 'Gemma 4 E4B Q4_K_M (8 GB GPUs)'],
                  ['gemma-4-E2B', 'Gemma 4 E2B (light)']
                ])}
              </Row>
              <Row title={tr("GPU layers")} hint={tr("99 puts the whole model on the GPU. Lower it if you run out of VRAM.")}>
                <TextField size="small" type="number" defaultValue={s.gpuLayers} onBlur={(e) => set('gpuLayers', Math.max(0, Number(e.target.value) || 0))} sx={{ width: 120, bgcolor: 'background.paper' }} />
              </Row>
              <Row title={tr("Context size")} hint={tr("Shared by two slots. 32k fits about an hour of transcript per pass.")}>
                {sel(String(s.contextSize), (v) => set('contextSize', Number(v)), [
                  ['16384', '16k'],
                  ['32768', '32k'],
                  ['65536', '64k']
                ])}
              </Row>
              <Row title={tr("Extra llama-server arguments")} hint={tr("Advanced. Example: -fa on")}>
                {text('extraLlamaArgs', 240)}
              </Row>
            </>
          )}
          {(s.aiProvider === 'gemini' || (s.asrEngine === 'cloud' && s.cloudAsrProvider === 'gemini')) && (
            <>
              {s.aiProvider === 'gemini' && <Row title={tr("Gemini model")} hint={tr("e.g. gemini-flash-latest or gemini-flash-lite-latest")}>{text('geminiModel')}</Row>}
              <Row title={tr("Gemini API key")} hint={tr("Get one at aistudio.google.com. Stored encrypted with Windows DPAPI.")}>
                <KeyField name="gemini" saved={keys.gemini} onSaved={setKeys} />
              </Row>
            </>
          )}
          {(s.aiProvider === 'openai' || (s.asrEngine === 'cloud' && s.cloudAsrProvider === 'openai')) && (
            <>
              <Row title={tr("Base URL")} hint={tr("OpenAI https://api.openai.com/v1 · Groq https://api.groq.com/openai/v1 · Ollama http://127.0.0.1:11434/v1")}>
                {text('openaiBaseUrl', 320)}
              </Row>
              {s.aiProvider === 'openai' && <Row title={tr("Model")}>{text('openaiModel')}</Row>}
              <Row title={tr("API key")} hint={tr("Leave empty for local servers like Ollama or LM Studio.")}>
                <KeyField name="openai" saved={keys.openai} onSaved={setKeys} />
              </Row>
            </>
          )}
          <Row title={tr("Acceleration")} hint={tr("CUDA for NVIDIA, Vulkan for AMD and Intel GPUs, CPU otherwise. Also used for the search model.")}>
            <Segmented value={s.gpuBackend} onChange={(v) => set('gpuBackend', v)} options={[['cuda', 'CUDA'], ['vulkan', 'Vulkan'], ['cpu', 'CPU']]} />
          </Row>
          <Row title={tr("Model servers")} hint={runtime.message ?? tr("Gemma: {llm} · Search: {embedder} · Speech: {asr}", { llm: runtime.llm, embedder: runtime.embedder, asr: runtime.asr })}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="outlined" onClick={() => ctx.go({ page: 'setup' })}>
                {tr("Setup")}
              </Button>
              <Button variant="contained" onClick={() => void api.restartRuntime()}>
                {tr("Restart")}
              </Button>
            </Box>
          </Row>
        </Section>

        <GoogleSection ctx={ctx} keys={keys} setKeys={setKeys} clientIdField={text('googleClientId', 320)} />
        <MicrosoftSection ctx={ctx} clientIdField={text('msClientId', 320)} tenantField={text('msTenant', 200)} />

        <Section title="Notes and Live Assistance">
          <Row title={tr("Default note template")} hint={tr("Each meeting can override this.")}>
            {sel(s.noteTemplate, (v) => set('noteTemplate', v), TEMPLATES.map((t) => [t.id, t.label]))}
          </Row>
          <Row title={tr("Answer questions automatically")} hint={tr("When someone asks a question, Insight searches your knowledge and shows a cited answer.")}>
            <Switch checked={s.liveAssist} onChange={(e) => set('liveAssist', e.target.checked)} />
          </Row>
          <Row title={tr("Surface related files")} hint={tr("Shows a context card when the conversation turns to something in your files, even without a question.")}>
            <Switch checked={s.topicAssist} disabled={!s.liveAssist} onChange={(e) => set('topicAssist', e.target.checked)} />
          </Row>
          <Row title={tr("Sensitivity")} hint={tr("Higher shows fewer, more confident cards.")}>
            <Slider sx={{ width: 220 }} min={0.3} max={0.7} step={0.05} defaultValue={s.liveAssistThreshold} onChangeCommitted={(_e, v) => set('liveAssistThreshold', v as number)} valueLabelDisplay="auto" />
          </Row>
        </Section>

        <Section title="Knowledge">
          <Row title={tr("Index images and diagrams")} hint={tr("The AI model reads each image once so it becomes searchable. Slower to index.")}>
            <Switch checked={s.indexImages} onChange={(e) => set('indexImages', e.target.checked)} />
          </Row>
          <Row title={tr("Embedding size")} hint={tr("Smaller vectors use less disk. Changing this rebuilds the index.")}>
            {sel(String(s.embedDims), (v) => set('embedDims', Number(v) as Settings['embedDims']), [
              ['768', '768 (best)'],
              ['512', '512'],
              ['256', '256'],
              ['128', '128 (smallest)']
            ])}
          </Row>
        </Section>

        <Section title="App">
          <Row title={tr("Your name")} hint={tr("Labels your microphone in transcripts.")}>
            <TextField size="small" defaultValue={s.userName} onBlur={(e) => set('userName', e.target.value.trim() || 'You')} sx={{ bgcolor: 'background.paper' }} />
          </Row>
          <Row title={tr("Interface language")} hint={tr("Auto follows Windows. Languages other than English are translated once by your AI provider and remembered.")}>
            <Select size="small" value={s.uiLanguage} onChange={(e) => set('uiLanguage', e.target.value)} sx={{ minWidth: 240, bgcolor: 'background.paper' }} MenuProps={{ PaperProps: { sx: { maxHeight: 420 } } }}>
              <MenuItem value="auto">{tr("Auto (Windows language)")}</MenuItem>
              {WORLD.map((w) => (
                <MenuItem key={w.name} value={w.name}>
                  {w.native}
                  {w.native !== w.name ? ` · ${w.name}` : ''}
                </MenuItem>
              ))}
            </Select>
          </Row>
          <Row title={tr("Start / stop shortcut")} hint={tr("Works system-wide, even while Teams or Zoom has focus. Example: CommandOrControl+Shift+Space")}>
            {text('hotkey')}
          </Row>
          <Row title={tr("Ask your pet by voice")} hint={tr("Press, ask your question, and your pet answers from your files, meetings and connected accounts.")}>
            {text('voiceHotkey')}
          </Row>
          <Row title={tr("Weekly recap")} hint={tr("On Friday afternoon your pet presents your week: meetings, time, promises kept, and meetings that could have been an email.")}>
            <Switch checked={s.weeklyRecap} onChange={(e) => set('weeklyRecap', e.target.checked)} />
          </Row>
          <Row title={tr("Theme")}>
            <Segmented value={s.theme} onChange={(v) => set('theme', v)} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} />
          </Row>
        </Section>

        <Section title="Storage and privacy">
          <Row title={tr("Delete meeting audio after")} hint={tr("Transcripts and notes are kept. Checked at startup.")}>
            {sel(String(s.retentionDays), (v) => set('retentionDays', Number(v)), [
              ['0', 'Never'],
              ['7', '7 days'],
              ['30', '30 days'],
              ['90', '90 days']
            ], 160)}
          </Row>
          <Row title={tr("Data folder")} hint={tr("{home} — models, meetings, audio and the search index. Delete it to remove everything.", { home })}>
            <Button variant="outlined" onClick={() => void api.open(home)}>
              {tr("Open folder")}
            </Button>
          </Row>
          <Row title={tr("Hugging Face token")} hint={tr("Only needed if a model repository requires sign-in. Used for downloads only.")}>
            {text('hfToken', 240, 'password')}
          </Row>
        </Section>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 3, px: 0.5 }}>
          {tr("In offline mode Insight makes no network requests after setup. Model servers listen only on 127.0.0.1. Recording people may require their consent where you live, so tell participants before you start listening.")}
        </Typography>
      </Box>
    </Box>
  )
}

function GoogleSection({
  ctx,
  keys,
  setKeys,
  clientIdField
}: {
  ctx: AppCtx
  keys: Record<UserSecret, boolean>
  setKeys: (k: Record<UserSecret, boolean>) => void
  clientIdField: ReactNode
}) {
  const s = ctx.settings
  const [g, setG] = useState<GoogleStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [memory, setMemory] = useState(0)
  useEffect(() => {
    void api.googleStatus(true).then(setG)
    void api.memoryCount().then(setMemory)
  }, [])
  useEvent('google:changed', setG)

  const run = async (fn: () => Promise<GoogleStatus>, done: string): Promise<void> => {
    setBusy(true)
    try {
      setG(await fn())
      ctx.toast(done)
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const toggle = (id: (typeof GOOGLE_SERVICE_IDS)[number]): void =>
    void ctx.saveSettings({ googleServices: s.googleServices.includes(id) ? s.googleServices.filter((x) => x !== id) : [...s.googleServices, id] })
  const failing = g?.services.filter((x) => x.error) ?? []

  return (
    <Section title="Google account">
      <Row
        title={tr("OAuth client")}
        hint={
          <>
            {tr("In Google Cloud Console create an OAuth client of type")}{' '}<b>{tr("Web application")}</b>{tr(", tick")}{' '}<b>{tr("Use this client for an AI-powered agent")}</b>{tr(", and add the redirect URI")}{' '}
            <Box component="code" sx={{ userSelect: 'all', fontSize: 12.5 }}>
              {OAUTH_REDIRECT}
            </Box>
            {tr(". Enable the API and the MCP API for each service turned on below.")}
          </>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
          {clientIdField}
          <KeyField name="googleClientSecret" saved={keys.googleClientSecret} onSaved={setKeys} placeholder={tr("Client secret")} />
        </Box>
      </Row>
      <Row title={tr("Services")} hint={tr("Read-only. Ask looks things up live when a question needs them. Reconnect after changing services.")}>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 360 }}>
          {GOOGLE_SERVICE_IDS.map((id) => {
            const on = s.googleServices.includes(id)
            const st = g?.services.find((x) => x.id === id)
            return (
              <Chip
                key={id}
                label={`${GOOGLE_SERVICES[id].label}${on && st?.tools ? ` · ${st.tools} tools` : ''}`}
                color={on && st?.error ? 'error' : on ? 'primary' : 'default'}
                variant={on ? 'filled' : 'outlined'}
                title={st?.error}
                onClick={() => toggle(id)}
              />
            )
          })}
        </Box>
      </Row>
      <Row
        title={g?.connected ? `Connected${g.email ? ` as ${g.email}` : ''}` : tr("Not connected")}
        hint={
          g?.missingScopes.length
            ? tr("Reconnect to grant access to {v0}.", { v0: g.missingScopes.map((x) => GOOGLE_SERVICES[x].label).join(', ') })
            : failing.length
              ? failing.map((x) => `${GOOGLE_SERVICES[x.id].label}: ${x.error}`).join(' · ')
              : tr("Sign-in opens in your browser. The token is stored encrypted on this PC.")
        }
      >
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="contained" disabled={busy || !g?.clientConfigured} onClick={() => void run(api.connectGoogle, tr("Google connected"))}>
            {busy ? tr("Waiting for browser…") : g?.connected ? tr("Reconnect") : tr("Connect")}
          </Button>
          {g?.connected && (
            <Button color="error" disabled={busy} onClick={() => void run(api.disconnectGoogle, tr("Google disconnected"))}>
              {tr("Disconnect")}
            </Button>
          )}
        </Box>
      </Row>
      <Row title={tr("Remember answers")} hint={tr("Answers that needed a Google lookup are saved in the local search index, so later questions can use them. {memory} saved.", { memory })}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Button disabled={!memory} onClick={() => void api.clearMemory().then(() => setMemory(0))}>
            {tr("Clear")}
          </Button>
          <Switch checked={s.rememberAnswers} onChange={(e) => void ctx.saveSettings({ rememberAnswers: e.target.checked })} />
        </Box>
      </Row>
      <Row title={tr("Pre-meeting briefs")} hint={tr("Before each meeting with other people, Insight reads your past notes, open promises, files and recent email with the attendees, and writes a short brief.")}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Select size="small" value={String(s.briefMinutes)} disabled={!s.briefs} onChange={(e) => void ctx.saveSettings({ briefMinutes: Number(e.target.value) })} sx={{ bgcolor: 'background.paper' }}>
            {[5, 10, 15, 30, 60].map((m) => (
              <MenuItem key={m} value={String(m)}>
                {m}{' '}{tr("min before")}
              </MenuItem>
            ))}
          </Select>
          <Switch checked={s.briefs} onChange={(e) => void ctx.saveSettings({ briefs: e.target.checked })} />
        </Box>
      </Row>
      <Row
        title={tr("Allow actions")}
        hint={
          g?.actionsNeedReconnect
            ? tr("Reconnect above to grant permission for drafts, tasks and events.")
            : tr("Draft follow-up emails in Gmail, add action items to Google Tasks and book follow-up meetings. Every action asks you to confirm first; drafts are never sent for you.")
        }
      >
        <Switch checked={s.googleActions} onChange={(e) => void ctx.saveSettings({ googleActions: e.target.checked })} />
      </Row>
      <Row title={tr("Promise reminders")} hint={tr("Nudges you (through your pet) before promises you made in meetings are due.")}>
        <Switch checked={s.promiseNudges} onChange={(e) => void ctx.saveSettings({ promiseNudges: e.target.checked })} />
      </Row>
      <Row title={tr("Meeting reminders")} hint={tr("Syncs your primary Google Calendar every 5 minutes and shows a reminder with a Join button.")}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Select
            size="small"
            value={String(s.reminderMinutes)}
            disabled={!s.calendarSync}
            onChange={(e) => void ctx.saveSettings({ reminderMinutes: Number(e.target.value) })}
            sx={{ bgcolor: 'background.paper' }}
          >
            {[0, 1, 2, 5, 10, 15, 30].map((m) => (
              <MenuItem key={m} value={String(m)}>
                {m ? tr("{m} min before", { m }) : tr("At start")}
              </MenuItem>
            ))}
          </Select>
          <Switch checked={s.calendarSync} onChange={(e) => void ctx.saveSettings({ calendarSync: e.target.checked })} />
        </Box>
      </Row>
    </Section>
  )
}

function MicrosoftSection({ ctx, clientIdField, tenantField }: { ctx: AppCtx; clientIdField: ReactNode; tenantField: ReactNode }) {
  const s = ctx.settings
  const [st, setSt] = useState<{ configured: boolean; connected: boolean; email?: string; actionsNeedReconnect: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => void api.msStatus().then(setSt), [])
  useEvent('ms:changed', setSt)
  const run = async (fn: () => Promise<typeof st>, done: string): Promise<void> => {
    setBusy(true)
    try {
      setSt(await fn())
      ctx.toast(done)
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Microsoft 365">
      <Row
        title={tr("App registration")}
        hint={
          <>
            {tr("In the Microsoft Entra admin center, register an app, add the platform")}{' '}<b>{tr("Mobile and desktop applications")}</b>{' '}{tr("with the redirect URI")}{' '}
            <Box component="code" sx={{ userSelect: 'all', fontSize: 12.5 }}>
              http://localhost
            </Box>
            {tr(", and allow public client flows. Paste its Application (client) ID. Tenant:")}{' '}<b>common</b>{' '}{tr("for any account, or your tenant ID to restrict it to your organization.")}
          </>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
          {clientIdField}
          {tenantField}
        </Box>
      </Row>
      <Row title={st?.connected ? `Connected${st.email ? ` as ${st.email}` : ''}` : tr("Not connected")} hint={tr("Outlook mail and calendar for Ask, briefs, reminders and promises (read-only). Sign-in opens in your browser; the token is stored encrypted on this PC.")}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="contained" disabled={busy || !s.msClientId.trim()} onClick={() => void run(api.msConnect, tr("Microsoft 365 connected"))}>
            {busy ? tr("Waiting for browser…") : st?.connected ? tr("Reconnect") : tr("Connect")}
          </Button>
          {st?.connected && (
            <Button color="error" disabled={busy} onClick={() => void run(api.msDisconnect, tr("Microsoft 365 disconnected"))}>
              {tr("Disconnect")}
            </Button>
          )}
        </Box>
      </Row>
      <Row title={tr("Allow actions")} hint={st?.actionsNeedReconnect ? tr("Reconnect above to grant permission for drafts, tasks and events.") : tr("Draft follow-ups in Outlook, add action items to Microsoft To Do and book follow-ups with a Teams link. Every action asks you to confirm first; nothing is sent for you.")}>
        <Switch checked={s.msActions} onChange={(e) => void ctx.saveSettings({ msActions: e.target.checked })} />
      </Row>
    </Section>
  )
}
