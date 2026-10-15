import { t as tr } from '../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { Box, ButtonBase, Chip, Typography } from '@mui/material'
import MicRounded from '@mui/icons-material/MicRounded'
import CreateNewFolderOutlined from '@mui/icons-material/CreateNewFolderOutlined'
import ForumOutlined from '@mui/icons-material/ForumOutlined'
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded'
import RecordVoiceOverOutlined from '@mui/icons-material/RecordVoiceOverOutlined'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import FolderCopyOutlined from '@mui/icons-material/FolderCopyOutlined'
import KeyboardRounded from '@mui/icons-material/KeyboardRounded'
import type { KnowledgeSource, MeetingSummary } from '../../../shared/types'
import { ENGINE_LABELS, resolveAsrEngine } from '../../../shared/engines'
import type { AppCtx } from '../App'
import { api, fmtTime } from '../api'
import { useRecorder } from '../components/ListeningPill'
import { EmptyArt, GeminiText } from '../components/ui'
import { UpcomingMeetings } from '../components/Upcoming'
import { PromisesCard } from '../components/Commitments'
import { WeekStrip } from '../components/Recap'
import { GOOGLE } from '../theme'

function groupLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return tr("Today")
  if (d.toDateString() === y.toDateString()) return tr("Yesterday")
  const diff = (today.getTime() - d.getTime()) / 86_400_000
  if (diff < 7) return tr("Earlier this week")
  return d.toLocaleDateString(undefined, { month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

const greeting = (): string => {
  const h = new Date().getHours()
  return h < 5 ? tr("Working late") : h < 12 ? tr("Good morning") : h < 18 ? tr("Good afternoon") : tr("Good evening")
}

const TILE = [GOOGLE.blue, GOOGLE.green, GOOGLE.purple, GOOGLE.orange, GOOGLE.cyan, GOOGLE.pink]

/** Idle equaliser in Google colours; animates gently, frozen when the user prefers reduced motion. */
function IdleBars() {
  const colors = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#4285F4', '#A142F4', '#12B5CB']
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', height: 64 }} aria-hidden>
      {colors.map((c, i) => (
        <Box
          key={i}
          sx={{
            width: 10,
            borderRadius: 5,
            bgcolor: c,
            height: [22, 40, 58, 32, 50, 36, 18][i],
            transformOrigin: 'center',
            animation: `fsBar 1.6s ${i * 0.14}s ease-in-out infinite`,
            '@keyframes fsBar': { '0%,100%': { transform: 'scaleY(1)' }, '50%': { transform: 'scaleY(.45)' } }
          }}
        />
      ))}
    </Box>
  )
}

function SetupLine({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
      <Box sx={{ width: 36, height: 36, borderRadius: 2.5, display: 'grid', placeItems: 'center', color, bgcolor: `${color}1F`, flex: 'none' }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {label}
        </Typography>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {value}
        </Typography>
      </Box>
    </Box>
  )
}

export function HomePage({ ctx, meetings }: { ctx: AppCtx; meetings: MeetingSummary[] }) {
  const rec = useRecorder()
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  useEffect(() => void api.sources().then(setSources), [])
  const s = ctx.settings
  const name = s.userName && s.userName !== 'You' ? `, ${s.userName.split(' ')[0]}` : ''
  const groups = new Map<string, MeetingSummary[]>()
  for (const m of meetings) groups.set(groupLabel(m.createdAt), [...(groups.get(groupLabel(m.createdAt)) ?? []), m])
  const files = sources.reduce((n, x) => n + x.fileCount, 0)
  const ai = s.aiProvider === 'local' ? 'Gemma 4 on this PC' : s.aiProvider === 'gemini' ? `Gemini · ${s.geminiModel}` : `API · ${s.openaiModel}`

  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      <Box sx={{ maxWidth: 1080, mx: 'auto', px: { xs: 3, md: 6 }, pt: 6, pb: 10 }}>
        <Typography variant="h3" component="h1" sx={{ fontVariationSettings: "'ROND' 50", mb: 1 }}>
          <GeminiText>
            {greeting()}
            {name}
          </GeminiText>
        </Typography>
        <Typography variant="h5" component="p" sx={{ color: 'text.secondary', fontWeight: 400, mb: 4 }}>
          {rec.recording ? tr("Listening now. Your notes are filling in as people talk.") : tr("Ready when your next meeting starts.")}
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.7fr 1fr' }, gap: 2 }}>
          <ButtonBase
            onClick={() => (rec.recording && rec.meetingId ? ctx.go({ page: 'meeting', meetingId: rec.meetingId }) : void ctx.startListening())}
            sx={(t) => ({
              display: 'flex',
              alignItems: 'stretch',
              justifyContent: 'space-between',
              textAlign: 'start',
              p: 3.5,
              borderRadius: 7,
              minHeight: 200,
              position: 'relative',
              overflow: 'hidden',
              color: t.fs.onPrimaryContainer,
              bgcolor: rec.recording ? t.fs.recordContainer : t.fs.primaryContainer,
              transition: 'box-shadow 200ms, transform 200ms',
              '&:hover': { boxShadow: t.fs.elevationHigh },
              '&:active': { transform: 'scale(.995)' },
              '&:focus-visible': { outline: `3px solid ${t.fs.primary}`, outlineOffset: 3 }
            })}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 2, zIndex: 1 }}>
              <Box
                sx={(t) => ({
                  width: 64,
                  height: 64,
                  borderRadius: '22px',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: rec.recording ? t.fs.record : t.fs.primary,
                  color: rec.recording ? '#fff' : t.fs.onPrimary,
                  boxShadow: t.fs.elevation
                })}
              >
                {rec.recording ? <GraphicEqRounded sx={{ fontSize: 34 }} /> : <MicRounded sx={{ fontSize: 34 }} />}
              </Box>
              <Box>
                <Typography sx={{ fontSize: 28, fontWeight: 500, lineHeight: 1.2, fontVariationSettings: "'ROND' 60" }}>
                  {rec.recording ? tr("Live · {v0}", { v0: fmtTime(rec.elapsedMs) }) : tr("Start listening")}
                </Typography>
                <Typography sx={{ opacity: 0.8, mt: 0.5, maxWidth: 420 }}>
                  {rec.recording ? tr("Open the meeting to see the transcript and Live Assistance.") : tr("Teams, Zoom, Meet in a browser, or the people across the table. No bot joins the call.")}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ alignSelf: 'center', display: { xs: 'none', sm: 'block' } }}>
              <IdleBars />
            </Box>
          </ButtonBase>

          <Box sx={(t) => ({ p: 2.5, borderRadius: 7, bgcolor: t.fs.container })}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {tr("Your setup")}
            </Typography>
            <SetupLine icon={<RecordVoiceOverOutlined />} label={tr("Speech recognition")} value={`${ENGINE_LABELS[resolveAsrEngine(s)].split(' (')[0]} · ${s.language}`} color={GOOGLE.blue} />
            <SetupLine icon={<AutoAwesomeOutlined />} label={tr("Notes and answers")} value={ai} color={GOOGLE.purple} />
            <SetupLine icon={<FolderCopyOutlined />} label={tr("Knowledge")} value={sources.length ? tr("{files} files in {n} sources", { files, n: sources.length }) : tr("Nothing added yet")} color={GOOGLE.green} />
            <SetupLine icon={<KeyboardRounded />} label={tr("Shortcut")} value={s.hotkey.replace('CommandOrControl', 'Ctrl')} color={GOOGLE.orange} />
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2.5 }}>
          <Chip icon={<CreateNewFolderOutlined />} label={tr("Add a folder")} variant="outlined" onClick={() => ctx.go({ page: 'knowledge' })} sx={{ height: 36, px: 0.5 }} />
          <Chip icon={<ForumOutlined />} label={tr("Ask about past meetings")} variant="outlined" onClick={() => ctx.go({ page: 'chat' })} sx={{ height: 36, px: 0.5 }} />
        </Box>

        <WeekStrip ctx={ctx} />
        <UpcomingMeetings ctx={ctx} />
        <PromisesCard ctx={ctx} />

        {meetings.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 8 }}>
            <EmptyArt variant="meetings" />
            <Typography variant="h6" sx={{ mt: 2 }}>
              {tr("No meetings yet")}
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 460, mx: 'auto', mt: 0.5 }}>
              {tr("Start listening when your next call begins. Add folders under Knowledge first so Live Assistance can answer from your files.")}
            </Typography>
          </Box>
        ) : (
          [...groups.entries()].map(([label, items]) => (
            <Box key={label} component="section" sx={{ mt: 5 }}>
              <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1, px: 1 }}>
                {label}
              </Typography>
              <Box sx={(t) => ({ borderRadius: 5, bgcolor: t.fs.container, overflow: 'hidden' })}>
                {items.map((m, i) => {
                  const d = new Date(m.createdAt)
                  const live = rec.meetingId === m.id
                  const c = TILE[(m.title.length + d.getDate()) % TILE.length]
                  return (
                    <ButtonBase
                      key={m.id}
                      onClick={() => ctx.go({ page: 'meeting', meetingId: m.id })}
                      sx={(t) => ({
                        width: '100%',
                        display: 'flex',
                        gap: 2,
                        alignItems: 'center',
                        textAlign: 'start',
                        px: 2.5,
                        py: 1.75,
                        borderTop: i ? `1px solid ${t.fs.sheet}` : 'none',
                        '&:hover': { bgcolor: t.fs.containerHigh }
                      })}
                    >
                      <Box sx={{ width: 48, height: 48, borderRadius: 3, flex: 'none', bgcolor: `${c}22`, color: c, display: 'grid', placeItems: 'center', lineHeight: 1 }}>
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography sx={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{d.getDate()}</Typography>
                          <Typography sx={{ fontSize: 10, fontWeight: 700, lineHeight: 1.4 }}>{d.toLocaleDateString(undefined, { month: 'short' })}</Typography>
                        </Box>
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontWeight: 600, fontSize: 15.5 }}>
                          {m.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {m.preview || tr("No notes yet")}
                        </Typography>
                      </Box>
                      {live ? (
                        <Chip size="small" label={tr("Live")} sx={(t) => ({ bgcolor: t.fs.record, color: '#fff', fontWeight: 700 })} />
                      ) : (
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', textAlign: 'end', flex: 'none' }}>
                          {d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          {m.durationMs > 0 && (
                            <>
                              <br />
                              {fmtTime(m.durationMs)}
                            </>
                          )}
                        </Typography>
                      )}
                    </ButtonBase>
                  )
                })}
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  )
}
