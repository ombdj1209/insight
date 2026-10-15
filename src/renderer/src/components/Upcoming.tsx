import { t as tr } from '../i18n'
import { useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material'
import VideocamRounded from '@mui/icons-material/VideocamRounded'
import MicRounded from '@mui/icons-material/MicRounded'
import EventRounded from '@mui/icons-material/EventRounded'
import type { CalEvent } from '../../../shared/google'
import type { AppCtx } from '../App'
import { api, cleanError, useEvent } from '../api'

const time = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function dayLabel(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return tr("Today")
  if (d.toDateString() === tomorrow.toDateString()) return tr("Tomorrow")
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Opens the call link, then starts an Insight meeting named after the event. */
export async function joinAndListen(ctx: AppCtx, e: CalEvent): Promise<void> {
  try {
    if (e.joinUrl) await api.openExternal(e.joinUrl)
    const m = await api.createMeeting()
    await api.updateMeeting(m.id, { title: e.title, calendar: { eventId: e.id, start: e.start, title: e.title, people: e.people ?? [] } })
    ctx.refreshMeetings()
    await ctx.startListening(m.id)
  } catch (err) {
    ctx.toast(cleanError(err), 'error')
  }
}

function JoinButtons({ ctx, e, onDone }: { ctx: AppCtx; e: CalEvent; onDone?: () => void }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, flex: 'none' }}>
      {e.joinUrl && (
        <Button
          size="small"
          variant="contained"
          startIcon={<VideocamRounded />}
          onClick={() => {
            void api.openExternal(e.joinUrl!).catch((err) => ctx.toast(cleanError(err), 'error'))
            onDone?.()
          }}
        >
          {tr("Join")}
        </Button>
      )}
      <Button
        size="small"
        variant="outlined"
        startIcon={<MicRounded />}
        onClick={() => {
          void joinAndListen(ctx, e)
          onDone?.()
        }}
      >
        {e.joinUrl ? tr("Join + take notes") : tr("Take notes")}
      </Button>
      <Button
        size="small"
        onClick={() => {
          ctx.openBrief(e)
          onDone?.()
        }}
      >
        {tr("Brief")}
      </Button>
    </Box>
  )
}

export function useCalendar(): CalEvent[] {
  const [events, setEvents] = useState<CalEvent[]>([])
  useEffect(() => void api.calendar().then(setEvents), [])
  useEvent('calendar:changed', setEvents)
  return events
}

/** Next meetings from Google Calendar with Join buttons. */
export function UpcomingMeetings({ ctx }: { ctx: AppCtx }) {
  const events = useCalendar()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const now = Date.now()
  const next = events.filter((e) => !e.allDay && e.end > now).slice(0, 5)
  if (!ctx.settings.calendarSync || !next.length) return null
  return (
    <Box component="section" sx={{ mt: 5 }}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1, px: 1 }}>
        {tr("Upcoming meetings")}
      </Typography>
      <Box sx={(t) => ({ borderRadius: 5, bgcolor: t.fs.container, overflow: 'hidden' })}>
        {next.map((e, i) => {
          const live = e.start <= now
          return (
            <Box key={e.id + e.start} sx={(t) => ({ display: 'flex', gap: 2, alignItems: 'center', px: 2.5, py: 1.5, borderTop: i ? `1px solid ${t.fs.sheet}` : 'none' })}>
              <EventRounded sx={{ color: 'text.secondary', flex: 'none' }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600, fontSize: 15.5 }}>
                  {e.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {dayLabel(e.start)} · {time(e.start)}–{time(e.end)}
                  {e.attendees > 1 ? tr(" · {attendees} people", { attendees: e.attendees }) : ''}
                </Typography>
              </Box>
              {live && <Chip size="small" label={tr("Now")} color="error" sx={{ fontWeight: 700 }} />}
              <JoinButtons ctx={ctx} e={e} />
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** In-app reminder shown when a meeting is about to start (also on clicking the Windows notification). */
export function ReminderBanner({ ctx }: { ctx: AppCtx }) {
  const [e, setE] = useState<CalEvent | null>(null)
  useEvent('calendar:reminder', setE)
  if (!e) return null
  const mins = Math.round((e.start - Date.now()) / 60_000)
  return (
    <Paper elevation={8} role="alert" sx={{ position: 'fixed', top: 68, right: 24, zIndex: 1400, width: 420, maxWidth: 'calc(100vw - 32px)', borderRadius: 4, overflow: 'hidden' }}>
      <Alert icon={<EventRounded />} severity="info" onClose={() => setE(null)} sx={{ borderRadius: 0, alignItems: 'flex-start' }}>
        <Typography sx={{ fontWeight: 700 }}>{e.title}</Typography>
        <Typography variant="body2" sx={{ mb: 1.25 }}>
          {mins > 0 ? tr("Starts in {mins} min", { mins }) : tr("Starting now")} · {time(e.start)}
        </Typography>
        <JoinButtons ctx={ctx} e={e} onDone={() => setE(null)} />
      </Alert>
    </Paper>
  )
}
