import { t as tr } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Autocomplete, Box, Button, ButtonBase, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputBase, Menu, MenuItem,
  Select, Switch, Tab, Tabs, TextField, Tooltip, Typography
} from '@mui/material'
import MicRounded from '@mui/icons-material/MicRounded'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import TipsAndUpdatesOutlined from '@mui/icons-material/TipsAndUpdatesOutlined'
import TipsAndUpdatesRounded from '@mui/icons-material/TipsAndUpdatesRounded'
import ManageSearchRounded from '@mui/icons-material/ManageSearchRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import PauseRounded from '@mui/icons-material/PauseRounded'
import StopRounded from '@mui/icons-material/StopRounded'
import ClosedCaptionRounded from '@mui/icons-material/ClosedCaptionRounded'
import CloudOutlined from '@mui/icons-material/CloudOutlined'
import WifiOffRounded from '@mui/icons-material/WifiOffRounded'
import LinkRounded from '@mui/icons-material/LinkRounded'
import EditNoteRounded from '@mui/icons-material/EditNoteRounded'
import NotesRounded from '@mui/icons-material/NotesRounded'
import type { AssistCard, Citation, Meeting, TranscriptLine } from '../../../shared/types'
import { TEMPLATES } from '../../../shared/templates'
import type { AppCtx } from '../App'
import { api, cleanError, fmtTime, useEvent } from '../api'
import { recorder } from '../audio/recorder'
import { Markdown } from '../components/Markdown'
import { FollowThrough } from '../components/Commitments'
import { SlidesTab } from '../components/Slides'
import SlideshowOutlined from '@mui/icons-material/SlideshowOutlined'
import { WORLD, writtenFor } from '../../../shared/languages'
import { CitationList, openCitation } from '../components/Citations'
import { useRecorder } from '../components/ListeningPill'
import { VoiceRibbon } from '../components/VoiceRibbon'
import { Shimmer, Sparkle, SpeakerAvatar } from '../components/ui'
import { speakerColor } from '../theme'

const TRANSLATE_LANGS = [
  'English', 'Japanese', 'Chinese (Simplified)', 'Chinese (Traditional)', 'Korean', 'Hindi', 'Spanish', 'French',
  'German', 'Portuguese', 'Italian', 'Vietnamese', 'Thai', 'Indonesian', 'Arabic', 'Russian'
]

function useDebounced(fn: (v: string) => void, ms: number): (v: string) => void {
  const t = useRef<number>(undefined)
  return (v: string) => {
    window.clearTimeout(t.current)
    t.current = window.setTimeout(() => fn(v), ms)
  }
}

function AssistCardView({ card }: { card: AssistCard }) {
  const [hl, setHl] = useState<number | null>(null)
  const context = card.kind === 'context'
  return (
    <Box
      sx={(t) => ({
        p: 2,
        borderRadius: 5,
        bgcolor: context ? t.fs.sheet : t.fs.assist,
        border: context ? `1px solid ${t.fs.outlineVariant}` : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        animation: 'fsFadeIn 260ms cubic-bezier(.2,0,0,1)'
      })}
    >
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        {context ? <LinkRounded sx={{ fontSize: 18, color: 'text.secondary' }} /> : <Sparkle size={16} />}
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, flex: 1 }}>
          {context ? tr("Related to the conversation") : tr("Question answered")}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {fmtTime(card.atMs)}
        </Typography>
      </Box>
      <Typography sx={{ fontWeight: context ? 400 : 600, fontSize: 14.5, fontStyle: context ? 'italic' : 'normal', color: context ? 'text.secondary' : 'text.primary' }}>
        {context ? `“${card.question}”` : card.question}
      </Typography>
      {!context && <Markdown text={card.answer} citations={card.citations} onCite={(c) => setHl(c.n)} />}
      <CitationList citations={card.citations} dense highlight={hl} />
    </Box>
  )
}

interface Group {
  key: string
  lines: TranscriptLine[]
}

function groupLines(lines: TranscriptLine[]): Group[] {
  const out: Group[] = []
  for (const l of lines) {
    const key = l.speakerId ?? `${l.channel}:${l.speaker}`
    const last = out[out.length - 1]
    if (last && last.key === key && l.startMs - last.lines[last.lines.length - 1].endMs < 45_000) last.lines.push(l)
    else out.push({ key, lines: [l] })
  }
  return out
}

export function MeetingPage({ ctx, meetingId }: { ctx: AppCtx; meetingId: string }) {
  const [m, setM] = useState<Meeting | null>(null)
  const [tab, setTab] = useState(0)
  const [enhancing, setEnhancing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(0)
  const [assistOpen, setAssistOpen] = useState(true)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState<{ q: string; text: string; citations: Citation[]; loading: boolean } | null>(null)
  const reqId = useRef('')
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null)
  const [follow, setFollow] = useState<{ open: boolean; language: string; tone: 'formal' | 'friendly'; busy: boolean }>({
    open: false,
    language: writtenFor(ctx.settings.language),
    tone: 'formal',
    busy: false
  })
  const [trState, setTr] = useState<{ language: string | null; busy: boolean }>({ language: null, busy: false })
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const transcriptEnd = useRef<HTMLDivElement>(null)
  const rec = useRecorder()
  const recordingThis = rec.recording && rec.meetingId === meetingId

  useEffect(() => {
    void api.meeting(meetingId).then(setM)
  }, [meetingId])

  useEvent('transcript:line', (p) => {
    if (p.meetingId !== meetingId) return
    setM((cur) => (cur ? { ...cur, transcript: [...cur.transcript, p.line].sort((a, b) => a.startMs - b.startMs) } : cur))
  }, [meetingId])
  useEvent('transcript:remove', (p) => {
    if (p.meetingId === meetingId) setM((cur) => (cur ? { ...cur, transcript: cur.transcript.filter((l) => l.id !== p.lineId) } : cur))
  }, [meetingId])
  useEvent('slides:changed', (p) => {
    if (p.meetingId === meetingId) setM((cur) => (cur ? { ...cur, slides: p.slides } : cur))
  }, [meetingId])
  useEvent('transcript:update', (p) => {
    if (p.meetingId === meetingId) setM((cur) => (cur ? { ...cur, transcript: p.transcript, speakers: p.speakers } : cur))
  }, [meetingId])
  useEvent('assist:card', (p) => {
    if (p.meetingId === meetingId) setM((cur) => (cur ? { ...cur, assist: [...cur.assist, p.card] } : cur))
  }, [meetingId])
  useEvent('enhance:delta', (p) => {
    if (p.meetingId === meetingId) setDraft(p.text)
  }, [meetingId])
  useEvent('asr:busy', (p) => setPending(p.pending))
  useEvent('chat:delta', (p) => {
    if (p.requestId === reqId.current) setAnswer((a) => (a ? { ...a, text: a.text + p.text } : a))
  })

  useEffect(() => {
    if (tab === 1) transcriptEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [m?.transcript.length, tab])

  const saveNotes = useDebounced((notes) => void api.updateMeeting(meetingId, { notes }), 500)
  const saveTitle = useDebounced((title) => void api.updateMeeting(meetingId, { title }).then(() => ctx.refreshMeetings()), 600)
  const groups = useMemo(() => groupLines(m?.transcript ?? []), [m?.transcript])

  if (!m) return null

  const enhance = async (): Promise<void> => {
    setEnhancing(true)
    setDraft('')
    setTab(0)
    try {
      const out = await api.enhance(meetingId)
      const fresh = await api.meeting(meetingId)
      setM(fresh ? { ...fresh, enhanced: out } : fresh)
      ctx.refreshMeetings()
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setEnhancing(false)
    }
  }

  const askMeeting = async (): Promise<void> => {
    const question = q.trim()
    if (!question) return
    setQ('')
    reqId.current = crypto.randomUUID()
    setAnswer({ q: question, text: '', citations: [], loading: true })
    try {
      const r = await api.ask(reqId.current, question, { meetingId }, [], false)
      setAnswer({ q: question, text: r.answer, citations: r.citations, loading: false })
    } catch (e) {
      setAnswer({ q: question, text: cleanError(e), citations: [], loading: false })
    }
  }

  const lookUp = async (question: string, atMs: number): Promise<void> => {
    setAssistOpen(true)
    try {
      const card = await api.assist(meetingId, question, atMs)
      if (!card) ctx.toast(tr("Nothing in your knowledge matches that."))
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    }
  }

  const play = async (l: TranscriptLine): Promise<void> => {
    if (playing === l.id) {
      audioRef.current?.pause()
      setPlaying(null)
      return
    }
    const bytes = await api.segmentAudio(meetingId, l.startMs, l.channel)
    if (!bytes) return ctx.toast(tr("Audio for this line was not kept."))
    audioRef.current?.pause()
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }))
    const a = new Audio(url)
    audioRef.current = a
    setPlaying(l.id)
    a.onended = () => {
      URL.revokeObjectURL(url)
      setPlaying(null)
    }
    void a.play()
  }

  const draftFollowUp = async (): Promise<void> => {
    setFollow((f) => ({ ...f, busy: true }))
    try {
      const text = await api.followUp(meetingId, follow.language, follow.tone)
      setM((cur) => (cur ? { ...cur, followUp: text } : cur))
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setFollow((f) => ({ ...f, busy: false }))
    }
  }

  const trLanguage = trState.language ?? m.translation?.language ?? ''
  const translate = async (): Promise<void> => {
    if (!trLanguage.trim()) return ctx.toast(tr("Type a language to translate into, e.g. English."))
    setTr((t) => ({ ...t, busy: true }))
    try {
      const text = await api.translateNotes(meetingId, trLanguage)
      setM((cur) => (cur ? { ...cur, translation: { language: trLanguage.trim(), text } } : cur))
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setTr((t) => ({ ...t, busy: false }))
    }
  }

  const enhancedText = enhancing ? draft : m.enhanced
  const showSplit = enhancing || !!m.enhanced
  const date = new Date(m.createdAt)
  const speakerName = (l: TranscriptLine): string => (l.speakerId ? m.speakers?.[l.speakerId] ?? l.speaker : l.speaker)

  const notesEditor = (
    <InputBase
      multiline
      fullWidth
      defaultValue={m.notes}
      placeholder={tr("Jot down shorthand as the meeting goes.\n\n- budget q3 slip?\n- who owns launch\n\nInsight fills in the details from the conversation.")}
      onChange={(e) => {
        saveNotes(e.target.value)
        setM((cur) => (cur ? { ...cur, notes: e.target.value } : cur))
      }}
      inputProps={{ 'aria-label': tr("My notes") }}
      sx={{ alignItems: 'flex-start', fontSize: 15.5, lineHeight: 1.75, '& textarea': { minHeight: '46vh' } }}
    />
  )

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* header */}
        <Box sx={{ px: 4, pt: 3, pb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <InputBase
              key={m.title}
              defaultValue={m.title}
              onChange={(e) => saveTitle(e.target.value)}
              inputProps={{ 'aria-label': tr("Meeting title") }}
              multiline
              maxRows={2}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLElement).blur())}
              sx={{ fontSize: 30, fontWeight: 450, width: '100%', lineHeight: 1.25, fontVariationSettings: "'ROND' 40" }}
            />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 0.25, flex: 'none' }}>
            {!recordingThis && (
              <Button variant="outlined" startIcon={<MicRounded />} disabled={rec.recording} onClick={() => void ctx.startListening(meetingId)} >
                {m.transcript.length ? tr("Resume") : tr("Start listening")}
              </Button>
            )}
            <ButtonBase
              onClick={() => void enhance()}
              disabled={enhancing}
              sx={(t) => ({
                                height: 40,
                px: 2.5,
                gap: 1,
                borderRadius: 20,
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
                background: t.fs.gemini,
                boxShadow: t.fs.elevation,
                opacity: enhancing ? 0.8 : 1,
                '&:hover': { boxShadow: t.fs.elevationHigh, filter: 'saturate(1.15)' },
                '&:focus-visible': { outline: `3px solid ${t.fs.primary}`, outlineOffset: 2 }
              })}
            >
              {enhancing ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <Box component="span" sx={{ fontSize: 18, lineHeight: 0 }}>✦</Box>}
              {enhancing ? tr("Writing notes…") : m.enhanced ? tr("Enhance again") : tr("Enhance notes")}
            </ButtonBase>
            <Tooltip title={assistOpen ? tr("Hide Live Assistance") : tr("Show Live Assistance")}>
              <IconButton onClick={() => setAssistOpen((v) => !v)} aria-label={tr("Toggle Live Assistance")} sx={(t) => ({ bgcolor: assistOpen ? t.fs.secondaryContainer : 'transparent', color: assistOpen ? t.fs.onSecondaryContainer : 'inherit' })}>
                {assistOpen ? <TipsAndUpdatesRounded /> : <TipsAndUpdatesOutlined />}
              </IconButton>
            </Tooltip>
            <IconButton onClick={(e) => setMenu(e.currentTarget)} aria-label={tr("More")} >
              <MoreVertRounded />
            </IconButton>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.25, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
              {date.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })} · {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              {m.durationMs > 0 && ` · ${fmtTime(m.durationMs)}`}
            </Typography>
            <Select
              size="small"
              variant="standard"
              disableUnderline
              value={m.template ?? ctx.settings.noteTemplate}
              onChange={(e) => {
                const template = e.target.value
                setM((cur) => (cur ? { ...cur, template } : cur))
                void api.updateMeeting(meetingId, { template })
              }}
              renderValue={(v) => (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <NotesRounded sx={{ fontSize: 16 }} />
                  {tr(TEMPLATES.find((t) => t.id === v)?.label ?? "General")}
                </Box>
              )}
              sx={(t) => ({ height: 28, px: 1.25, borderRadius: 2, border: `1px solid ${t.fs.outlineVariant}`, fontSize: 13, fontWeight: 500, '& .MuiSelect-select': { py: 0, pr: '24px !important' } })}
              inputProps={{ 'aria-label': tr("Note template") }}
            >
              {TEMPLATES.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {tr(t.label)}
                </MenuItem>
              ))}
            </Select>
            {m.cloudUsed?.length ? (
              <Tooltip title={tr("Parts of this meeting were processed by a cloud API")}>
                <Chip size="small" icon={<CloudOutlined />} label={tr("Cloud: {v0}", { v0: m.cloudUsed.join(', ') })} sx={(t) => ({ height: 28, bgcolor: t.palette.mode === 'light' ? '#FFF0D1' : '#4A3200', color: t.palette.mode === 'light' ? '#5C3B00' : '#FFDDB0', '& .MuiChip-icon': { color: 'inherit' } })} />
              </Tooltip>
            ) : (
              <Tooltip title={tr("Everything in this meeting stayed on this PC")}>
                <Chip size="small" icon={<WifiOffRounded />} label={tr("Offline")} sx={(t) => ({ height: 28, bgcolor: t.fs.tertiaryContainer, color: t.fs.onTertiaryContainer, '& .MuiChip-icon': { color: 'inherit' } })} />
              </Tooltip>
            )}
          </Box>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            <MenuItem
              onClick={() => {
                setMenu(null)
                setFollow((f) => ({ ...f, open: true }))
              }}
            >
              {tr("Draft follow-up email")}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenu(null)
                void api.exportMeeting(meetingId).then((ok) => ok && ctx.toast(tr("Exported as Markdown")))
              }}
            >
              {tr("Export as Markdown")}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenu(null)
                void navigator.clipboard.writeText(m.transcript.map((l) => `[${fmtTime(l.startMs)}] ${speakerName(l)}: ${l.text}`).join('\n'))
                ctx.toast(tr("Transcript copied"))
              }}
            >
              {tr("Copy transcript")}
            </MenuItem>
            <MenuItem
              disabled={recordingThis}
              onClick={async () => {
                setMenu(null)
                await api.deleteMeeting(meetingId)
                ctx.refreshMeetings()
                ctx.go({ page: 'home' })
              }}
              sx={{ color: 'error.main' }}
            >
              {tr("Delete meeting")}
            </MenuItem>
          </Menu>
        </Box>

        {/* live bar */}
        {recordingThis && (
          <Box sx={{ px: 4, pb: 1.5 }}>
            <Box sx={(t) => ({ display: 'flex', alignItems: 'center', gap: 2, pl: 2.5, pr: 1, py: 1, borderRadius: 7, bgcolor: t.fs.container })}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: 'none', minWidth: 112 }}>
                <Box sx={(t) => ({ width: 10, height: 10, borderRadius: 5, bgcolor: t.fs.record, animation: rec.paused ? 'none' : 'fsPulse 1.4s ease-in-out infinite' })} />
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{rec.paused ? tr("Paused") : fmtTime(rec.elapsedMs)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {pending > 0 ? tr("Transcribing {pending}…", { pending }) : rec.systemAudio ? tr("You + system audio") : tr("Microphone only")}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <VoiceRibbon height={48} />
              </Box>
              <Tooltip title={rec.paused ? tr("Resume") : tr("Pause")}>
                <IconButton onClick={() => (rec.paused ? recorder.resume() : recorder.pause())} aria-label={rec.paused ? tr("Resume") : tr("Pause")} sx={(t) => ({ width: 48, height: 48, bgcolor: t.fs.containerHighest })}>
                  {rec.paused ? <PlayArrowRounded /> : <PauseRounded />}
                </IconButton>
              </Tooltip>
              <Tooltip title={tr("Live captions")}>
                <IconButton onClick={() => void api.captionsToggle()} aria-label={tr("Live captions")} sx={(t) => ({ width: 48, height: 48, bgcolor: t.fs.containerHighest })}>
                  <ClosedCaptionRounded />
                </IconButton>
              </Tooltip>
              <Button
                onClick={() => void ctx.stopListening().then(() => api.meeting(meetingId).then(setM))}
                startIcon={<StopRounded />}
                sx={(t) => ({ height: 48, borderRadius: 24, bgcolor: t.fs.record, color: t.palette.mode === 'light' ? '#fff' : '#601410', '&:hover': { bgcolor: t.fs.record, filter: 'brightness(1.08)' } })}
              >
                {tr("Stop")}
              </Button>
            </Box>
          </Box>
        )}

        <Box sx={(t) => ({ px: 3, borderBottom: `1px solid ${t.fs.outlineVariant}` })}>
          <Tabs value={tab} onChange={(_e, v: number) => setTab(v)}>
            <Tab icon={<EditNoteRounded />} iconPosition="start" label={tr("Notes")} />
            <Tab
              icon={<NotesRounded />}
              iconPosition="start"
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {tr("Transcript")}
                  {m.transcript.length > 0 && (
                    <Box sx={(t) => ({ fontSize: 11, fontWeight: 700, px: 0.9, py: 0.1, borderRadius: 8, bgcolor: t.fs.secondaryContainer, color: t.fs.onSecondaryContainer })}>{m.transcript.length}</Box>
                  )}
                </Box>
              }
            />
            {(ctx.settings.captureSlides || (m.slides?.length ?? 0) > 0) && (
              <Tab
                icon={<SlideshowOutlined />}
                iconPosition="start"
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {tr("Slides")}
                    {(m.slides?.length ?? 0) > 0 && <Box sx={(t) => ({ fontSize: 11, fontWeight: 700, px: 0.9, py: 0.1, borderRadius: 8, bgcolor: t.fs.secondaryContainer, color: t.fs.onSecondaryContainer })}>{m.slides!.length}</Box>}
                  </Box>
                }
              />
            )}
          </Tabs>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {tab === 0 &&
            (showSplit ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, .85fr) minmax(0, 1.25fr)', gap: 2, p: 3 }}>
                <Box sx={(t) => ({ p: 3, borderRadius: 6, bgcolor: t.fs.container, alignSelf: 'start' })}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, color: 'text.secondary' }}>
                    <EditNoteRounded fontSize="small" />
                    <Typography variant="subtitle2">{tr("My notes")}</Typography>
                  </Box>
                  {notesEditor}
                </Box>
                <Box sx={(t) => ({ p: 3, borderRadius: 6, border: `1px solid ${t.fs.outlineVariant}`, position: 'relative', overflow: 'hidden' })}>
                  <Box sx={(t) => ({ position: 'absolute', inset: 0, height: 4, background: t.fs.gemini })} />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Sparkle size={18} spinning={enhancing && !draft} />
                    <Typography variant="subtitle2" sx={{ flex: 1 }}>
                      {tr("Enhanced notes")}
                    </Typography>
                    {!enhancing && (
                      <Tooltip title={tr("Copy as Markdown")}>
                        <IconButton size="small" onClick={() => void navigator.clipboard.writeText(m.enhanced).then(() => ctx.toast(tr("Notes copied")))} aria-label={tr("Copy enhanced notes")}>
                          <ContentCopyRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                  {enhancedText ? <Markdown text={enhancedText} /> : <Shimmer lines={6} />}
                  {!enhancing && m.enhanced && (
                    <Box sx={(t) => ({ mt: 3, pt: 2, borderTop: `1px solid ${t.fs.outlineVariant}` })}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Autocomplete
                          freeSolo
                          size="small"
                          options={TRANSLATE_LANGS}
                          inputValue={trLanguage}
                          onInputChange={(_e, v) => setTr((t) => ({ ...t, language: v }))}
                          // show the full list even when a language is already typed
                          filterOptions={(opts, { inputValue }) => (TRANSLATE_LANGS.includes(inputValue) ? opts : opts.filter((o) => o.toLowerCase().includes(inputValue.toLowerCase())))}
                          slotProps={{ popper: { placement: 'top-start' }, listbox: { sx: { maxHeight: 280 } } }}
                          sx={{ flex: 1, maxWidth: 280 }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label={tr("Translate to")}
                              placeholder={tr("Type or pick a language")}
                              onKeyDown={(e) => e.key === 'Enter' && trLanguage.trim() && void translate()}
                              inputProps={{ ...params.inputProps, 'aria-label': tr("Translate notes to language") }}
                            />
                          )}
                        />
                        <Button variant="outlined" onClick={() => void translate()} disabled={trState.busy || !trLanguage.trim()} startIcon={trState.busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
                          {trState.busy ? tr("Translating…") : m.translation ? tr("Translate again") : tr("Translate")}
                        </Button>
                      </Box>
                      {trState.busy && !m.translation && (
                        <Box sx={{ mt: 2 }}>
                          <Shimmer lines={4} />
                        </Box>
                      )}
                      {m.translation && (
                        <Box sx={{ mt: 2.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Typography variant="subtitle2" sx={{ flex: 1 }}>
                              {tr("Translation ·")}{' '}{m.translation.language}
                            </Typography>
                            <Tooltip title={tr("Copy translation")}>
                              <IconButton size="small" onClick={() => void navigator.clipboard.writeText(m.translation?.text ?? '').then(() => ctx.toast(tr("Translation copied")))} aria-label={tr("Copy translation")}>
                                <ContentCopyRounded fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                          <Box sx={{ opacity: trState.busy ? 0.5 : 1 }}>
                            <Markdown text={m.translation.text} />
                          </Box>
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
                {!enhancing && m.enhanced && (
                  <Box sx={{ gridColumn: '1 / -1' }}>
                    <FollowThrough ctx={ctx} m={m} />
                  </Box>
                )}
              </Box>
            ) : (
              <Box sx={{ px: 4, py: 3, maxWidth: 860 }}>{notesEditor}</Box>
            ))}

          {tab === 2 && <SlidesTab meetingId={meetingId} slides={m.slides ?? []} onChange={(slides) => setM((cur) => (cur ? { ...cur, slides } : cur))} />}
          {tab === 1 && (
            <Box sx={{ px: 4, py: 3, maxWidth: 920 }}>
              {!m.transcript.length && (
                <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
                  <NotesRounded sx={{ fontSize: 40, opacity: 0.6 }} />
                  <Typography sx={{ mt: 1 }}>{recordingThis ? tr("Listening. Lines appear a moment after each pause.") : tr("No transcript yet. Start listening to capture the conversation.")}</Typography>
                </Box>
              )}
              {groups.map((g) => {
                const first = g.lines[0]
                const name = speakerName(first)
                return (
                  <Box key={first.id} sx={{ display: 'flex', gap: 1.75, mb: 2.5 }}>
                    <SpeakerAvatar name={name} id={first.speakerId} channel={first.channel} size={36} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
                        <Tooltip title={first.speakerId ? tr("Rename this speaker") : first.channel === 'mic' ? tr("Your microphone") : tr("System audio")}>
                          <Typography
                            component={first.speakerId ? 'button' : 'span'}
                            onClick={first.speakerId ? () => setRename({ id: first.speakerId!, name }) : undefined}
                            sx={(t) => ({
                              border: 0,
                              p: 0,
                              background: 'none',
                              fontFamily: 'inherit',
                              fontWeight: 700,
                              fontSize: 14,
                              cursor: first.speakerId ? 'pointer' : 'default',
                              color: speakerColor(t.fs, first.speakerId ?? name, first.channel),
                              '&:hover': first.speakerId ? { textDecoration: 'underline' } : undefined,
                              '&:focus-visible': { outline: `2px solid ${t.fs.primary}`, borderRadius: 1 }
                            })}
                          >
                            {name}
                          </Typography>
                        </Tooltip>
                        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {fmtTime(first.startMs)}
                        </Typography>
                      </Box>
                      {g.lines.map((l) => (
                        <Box
                          key={l.id}
                          sx={(t) => ({
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 1,
                            mx: -1,
                            px: 1,
                            borderRadius: 2,
                            bgcolor: playing === l.id ? t.fs.secondaryContainer : 'transparent',
                            '&:hover': { bgcolor: playing === l.id ? t.fs.secondaryContainer : t.fs.container },
                            '&:hover .acts': { opacity: 1 }
                          })}
                        >
                          <Typography variant="body1" sx={{ flex: 1, py: 0.4 }}>
                            {l.text}
                          </Typography>
                          <Box className="acts" sx={{ display: 'flex', opacity: playing === l.id ? 1 : 0, transition: 'opacity 120ms', flex: 'none' }}>
                            <Tooltip title={playing === l.id ? tr("Stop") : tr("Play · {v0}", { v0: fmtTime(l.startMs) })}>
                              <IconButton size="small" onClick={() => void play(l)} aria-label={tr("Play line")}>
                                {playing === l.id ? <PauseRounded fontSize="small" /> : <PlayArrowRounded fontSize="small" />}
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={tr("Look this up in my knowledge")}>
                              <IconButton size="small" onClick={() => void lookUp(l.text, l.startMs)} aria-label={tr("Look up")}>
                                <ManageSearchRounded fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )
              })}
              <div ref={transcriptEnd} />
            </Box>
          )}
        </Box>

        {/* ask bar */}
        <Box sx={{ px: 4, pb: 2.5, pt: 1 }}>
          {answer && (
            <Box sx={(t) => ({ mb: 1.5, p: 2.5, borderRadius: 6, bgcolor: t.fs.container, maxHeight: '40vh', overflowY: 'auto', position: 'relative', animation: 'fsFadeIn 220ms' })}>
              <IconButton size="small" onClick={() => setAnswer(null)} sx={{ position: 'absolute', top: 10, right: 10 }} aria-label={tr("Close answer")}>
                <CloseRounded fontSize="small" />
              </IconButton>
              <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', mb: 1, pr: 4 }}>
                <Sparkle size={18} spinning={answer.loading && !answer.text} />
                <Typography variant="subtitle2">{answer.q}</Typography>
              </Box>
              {answer.text ? <Markdown text={answer.text} citations={answer.citations} onCite={(c) => openCitation(c)} /> : <Shimmer lines={3} />}
              {!answer.loading && answer.citations.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <CitationList citations={answer.citations} dense />
                </Box>
              )}
            </Box>
          )}
          <Box
            sx={(t) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              pl: 2.25,
              pr: 0.75,
              height: 56,
              borderRadius: 28,
              bgcolor: t.fs.container,
              transition: 'box-shadow 150ms, background 150ms',
              '&:focus-within': { bgcolor: t.fs.sheet, boxShadow: t.fs.elevationHigh }
            })}
          >
            <Sparkle size={20} />
            <InputBase
              fullWidth
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void askMeeting()}
              placeholder={tr("Ask about this meeting or your files")}
              inputProps={{ 'aria-label': tr("Ask about this meeting") }}
              sx={{ fontSize: 15 }}
            />
            <IconButton
              onClick={() => void askMeeting()}
              disabled={!q.trim()}
              aria-label={tr("Send")}
              sx={(t) => ({ width: 44, height: 44, bgcolor: q.trim() ? t.fs.primary : 'transparent', color: q.trim() ? t.fs.onPrimary : 'inherit', '&:hover': { bgcolor: t.fs.primary } })}
            >
              <ArrowUpwardRounded />
            </IconButton>
          </Box>
        </Box>
      </Box>

      {assistOpen && (
        <Box sx={(t) => ({ width: 368, flex: 'none', m: 1.5, ml: 0, borderRadius: 6, bgcolor: t.fs.container, display: 'flex', flexDirection: 'column', overflow: 'hidden' })}>
          <Box sx={{ px: 2.5, pt: 2, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={(t) => ({ width: 36, height: 36, borderRadius: 2.5, display: 'grid', placeItems: 'center', background: t.fs.geminiSoft })}>
              <Sparkle size={20} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                {tr("Live Assistance")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {ctx.settings.liveAssist ? tr("Answers questions from your files") : tr("Paused")}
              </Typography>
            </Box>
            <Switch checked={ctx.settings.liveAssist} onChange={(e) => void ctx.saveSettings({ liveAssist: e.target.checked })} inputProps={{ 'aria-label': tr("Live Assistance") }} />
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {m.assist.length === 0 && (
              <Box sx={{ textAlign: 'center', px: 3, py: 6, color: 'text.secondary' }}>
                <TipsAndUpdatesOutlined sx={{ fontSize: 36, opacity: 0.6 }} />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {tr("When someone asks something your files can answer, the answer and its exact source appear here.")}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', mt: 1.5 }}>
                  {tr("Tip: hover a transcript line and choose the search icon to look it up yourself.")}
                </Typography>
              </Box>
            )}
            {[...m.assist].reverse().map((c) => (
              <AssistCardView key={c.id} card={c} />
            ))}
          </Box>
        </Box>
      )}

      <Dialog open={!!rename} onClose={() => setRename(null)} fullWidth maxWidth="xs">
        <DialogTitle>{tr("Rename speaker")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            value={rename?.name ?? ''}
            onChange={(e) => setRename((r) => (r ? { ...r, name: e.target.value } : r))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rename?.name.trim()) {
                void api.renameSpeaker(meetingId, rename.id, rename.name.trim())
                setRename(null)
              }
            }}
            sx={{ mt: 1 }}
            helperText={tr("Updates every line from this voice in this meeting")}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setRename(null)}>{tr("Cancel")}</Button>
          <Button
            variant="contained"
            disabled={!rename?.name.trim()}
            onClick={() => {
              if (rename) void api.renameSpeaker(meetingId, rename.id, rename.name.trim())
              setRename(null)
            }}
          >
            {tr("Rename")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={follow.open} onClose={() => setFollow((f) => ({ ...f, open: false }))} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Sparkle size={22} />{' '}{tr("Follow-up email")}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, mt: 0.5, flexWrap: 'wrap' }}>
            <Select size="small" value={follow.language} onChange={(e) => setFollow((f) => ({ ...f, language: e.target.value }))} MenuProps={{ PaperProps: { sx: { maxHeight: 420 } } }}>
              {WORLD.map((w) => (
                <MenuItem key={w.name} value={w.name}>
                  {w.native}
                  {w.native !== w.name ? ` · ${w.name}` : ''}
                </MenuItem>
              ))}
            </Select>
            <Select size="small" value={follow.tone} onChange={(e) => setFollow((f) => ({ ...f, tone: e.target.value as 'formal' | 'friendly' }))}>
              <MenuItem value="formal">{follow.language === 'Japanese' ? tr("Formal (keigo)") : tr("Formal")}</MenuItem>
              <MenuItem value="friendly">{tr("Friendly")}</MenuItem>
            </Select>
            <Button variant="contained" onClick={() => void draftFollowUp()} disabled={follow.busy} startIcon={follow.busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
              {m.followUp ? tr("Write again") : tr("Write email")}
            </Button>
          </Box>
          {follow.busy && !m.followUp ? (
            <Shimmer lines={8} />
          ) : (
            <TextField
              multiline
              fullWidth
              minRows={12}
              value={m.followUp ?? ''}
              onChange={(e) => setM((cur) => (cur ? { ...cur, followUp: e.target.value } : cur))}
              onBlur={(e) => void api.updateMeeting(meetingId, { followUp: e.target.value })}
              placeholder={tr("Choose language and tone, then write the email from this meeting's notes.")}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setFollow((f) => ({ ...f, open: false }))}>{tr("Close")}</Button>
          <Button variant="contained" disabled={!m.followUp} startIcon={<ContentCopyRounded />} onClick={() => void navigator.clipboard.writeText(m.followUp ?? '').then(() => ctx.toast(tr("Email copied")))}>
            {tr("Copy")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
