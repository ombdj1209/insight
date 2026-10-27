import { t as tr } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, ButtonBase, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  MenuItem, Select, Switch, TextField, Typography
} from '@mui/material'
import Diversity3Outlined from '@mui/icons-material/Diversity3Outlined'
import FolderSharedOutlined from '@mui/icons-material/FolderSharedOutlined'
import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined'
import SendOutlined from '@mui/icons-material/SendOutlined'
import WavingHandOutlined from '@mui/icons-material/WavingHandOutlined'
import { DEFAULT_PET } from '../../../shared/pet'
import type { Busy, TeamMember, TeamStatus } from '../../../shared/team'
import type { AppCtx } from '../App'
import { api, cleanError, useEvent, type Standup } from '../api'
import { MOOD_SHAPE, PetSvg, type Pose } from '../pet/PetSvg'

const pose = (mood: 'idle' | 'happy' | 'sleepy'): Pose => ({ t: 0, mood, look: { x: 0, y: 0 }, blink: false, squash: 0, lean: 0, walkPhase: 0, shape: { from: MOOD_SHAPE[mood], to: MOOD_SHAPE[mood], m: 1 } })
const MIN = 60_000
/** a teammate's wall clock: tzOffset is UTC minus local, in minutes */
const theirTime = (m: Pick<TeamMember, 'tzOffset'>, at: number): Date => new Date(at - m.tzOffset * MIN)
const hhmm = (d: Date): string => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

type Now = { text: string; color: string; away: boolean }
function nowOf(m: TeamMember, now: number): Now {
  if (now - m.updatedAt > 30 * MIN) return { text: tr('Last seen {time}', { time: new Date(m.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }), color: '#80868B', away: true }
  const local = theirTime(m, now)
  const h = local.getUTCHours() + local.getUTCMinutes() / 60
  const weekend = local.getUTCDay() === 0 || local.getUTCDay() === 6
  if (weekend || h < m.work.start || h >= m.work.end) return { text: tr('Outside work hours'), color: '#80868B', away: true }
  if (!m.shareBusy) return { text: tr('Calendar not shared'), color: '#80868B', away: false }
  return m.busy.some((b) => b.s <= now && b.e > now) ? { text: tr('Busy now'), color: '#D93025', away: false } : { text: tr('Free now'), color: '#1E8E3E', away: false }
}

export function TeamPage({ ctx }: { ctx: AppCtx }) {
  const [st, setSt] = useState<TeamStatus | null>(null)
  const [now, setNow] = useState(Date.now())
  const [findFor, setFindFor] = useState<string[] | null>(null)
  const [notesFor, setNotesFor] = useState<string[] | null>(null)
  const [joining, setJoining] = useState(false)
  useEffect(() => {
    void api.teamStatus().then(setSt)
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  useEvent('team:changed', setSt)

  const join = async (): Promise<void> => {
    setJoining(true)
    try {
      setSt(await api.teamJoin())
      await ctx.reloadSettings()
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setJoining(false)
    }
  }
  const leave = async (): Promise<void> => {
    if (!confirm(tr('Leave this team? Your card and inbox are removed from the shared folder.'))) return
    setSt(await api.teamLeave())
    await ctx.reloadSettings()
  }
  const wave = async (m: TeamMember): Promise<void> => {
    try {
      await api.teamWave(m.id)
      ctx.toast(tr('{pet} is on the way to {name}.', { pet: st?.me?.pet.name ?? tr('Your pet'), name: m.name }))
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    }
  }

  if (!st) return null
  if (!st.joined) return <JoinCard busy={joining} onJoin={() => void join()} />

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', p: { xs: 3, md: 5 } }}>
      <Box sx={{ maxWidth: 1080 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h4" component="h1" noWrap>
              {st.teamName}
            </Typography>
            <Typography color="text.secondary" noWrap title={st.folder}>
              {st.folder}
            </Typography>
          </Box>
          {st.members.length > 1 && (
            <Button variant="contained" startIcon={<EventAvailableOutlined />} onClick={() => setFindFor(st.members.map((m) => m.id))}>
              {tr('Find time with everyone')}
            </Button>
          )}
          <Button onClick={() => void leave()}>{tr('Leave team')}</Button>
        </Box>

        {st.members.length === 0 ? (
          <Alert severity="info" sx={{ mt: 3, borderRadius: 3 }}>
            {tr('You are the first one here. Share the folder with your team; when they join it in Insight, their pets show up here.')}
          </Alert>
        ) : (
          <Box sx={{ mt: 3, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2 }}>
            {st.members.map((m) => {
              const n = nowOf(m, now)
              return (
                <Box key={m.id} sx={(t) => ({ p: 2, borderRadius: 5, border: `1px solid ${t.fs.outlineVariant}`, display: 'flex', flexDirection: 'column', gap: 1.5 })}>
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                    <Box sx={(t) => ({ width: 72, height: 72, borderRadius: 4, bgcolor: t.fs.container, display: 'grid', placeItems: 'center', flex: 'none' })}>
                      <PetSvg c={{ ...DEFAULT_PET, ...m.pet }} p={pose(n.away ? 'sleepy' : 'idle')} size={64} />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography noWrap sx={{ fontWeight: 600 }}>
                        {m.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {tr('{pet} · {time} their time', { pet: m.pet.name, time: hhmm(theirTime(m, now)) })}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: 4, bgcolor: n.color, flex: 'none' }} />
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }} noWrap>
                          {n.text}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" startIcon={<EventAvailableOutlined />} onClick={() => setFindFor([m.id])}>
                      {tr('Find time')}
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<SendOutlined />} onClick={() => setNotesFor([m.id])}>
                      {tr('Send notes')}
                    </Button>
                    <Button size="small" startIcon={<WavingHandOutlined />} onClick={() => void wave(m)}>
                      {tr('Wave')}
                    </Button>
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}

        <StandupCard ctx={ctx} st={st} />
        <SharingCard ctx={ctx} />
      </Box>
      {findFor && <FindTimeDialog ctx={ctx} st={st} ids={findFor} onClose={() => setFindFor(null)} />}
      {notesFor && <SendNotesDialog ctx={ctx} st={st} ids={notesFor} onClose={() => setNotesFor(null)} />}
    </Box>
  )
}

function JoinCard({ busy, onJoin }: { busy: boolean; onJoin: () => void }) {
  return (
    <Box sx={{ height: '100%', overflowY: 'auto', display: 'grid', placeItems: 'center', p: 4 }}>
      <Box sx={(t) => ({ maxWidth: 620, p: 4, borderRadius: 6, bgcolor: t.fs.container })}>
        <Diversity3Outlined sx={{ fontSize: 44, color: 'primary.main' }} />
        <Typography variant="h5" component="h1" sx={{ mt: 1 }}>
          {tr('Team pets')}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {tr('Your pet visits teammates and theirs visit you: to wave, find a meeting time, share notes and post a daily stand-up.')}
        </Typography>
        <Typography sx={{ mt: 2.5, fontWeight: 600 }}>{tr('How it works')}</Typography>
        <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2.5, color: 'text.secondary', '& li': { mb: 0.5 } }}>
          <li>{tr('Pick a folder your team already syncs: OneDrive, SharePoint, Google Drive, Dropbox or a network share.')}</li>
          <li>{tr('Everyone picks the same folder in Insight. Insight only reads and writes small files in a hidden .insight-team folder there; your sync app moves them.')}</li>
          <li>{tr('Teammates see your name, email, pet, time zone, work hours and when you are busy. Never meeting titles, attendees or notes, unless you send notes yourself.')}</li>
          <li>{tr('No Insight server is involved. Leave any time and your card is removed.')}</li>
        </Box>
        <Button variant="contained" size="large" sx={{ mt: 3 }} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <FolderSharedOutlined />} disabled={busy} onClick={onJoin}>
          {tr('Choose shared folder')}
        </Button>
      </Box>
    </Box>
  )
}

function FindTimeDialog({ ctx, st, ids: initial, onClose }: { ctx: AppCtx; st: TeamStatus; ids: string[]; onClose: () => void }) {
  const [ids, setIds] = useState(initial)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [slots, setSlots] = useState<Busy[] | null>(null)
  const [pick, setPick] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const who = st.members.filter((m) => ids.includes(m.id))

  useEffect(() => {
    setSlots(null)
    setPick(null)
    if (!ids.length) return
    void api.teamFindTime(ids, minutes).then((s) => (setSlots(s), setPick(s[0]?.s ?? null))).catch((e) => ctx.toast(cleanError(e), 'error'))
  }, [ids, minutes]) // eslint-disable-line react-hooks/exhaustive-deps

  const bookIt = async (): Promise<void> => {
    if (pick === null) return
    setBusy(true)
    try {
      const r = await api.teamBook({ ids, title, start: pick, minutes })
      ctx.toast(r.via === 'ics' ? tr('Invite opened. Your pet is taking the request to them.') : tr('Booked and invited. Your pet is telling them.'))
      onClose()
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const note =
    st.booking === 'google'
      ? tr('Books it in your Google Calendar with a Meet link and invites them.')
      : st.booking === 'microsoft'
        ? tr('Books it in your Outlook calendar with a Teams link and invites them.')
        : tr('Opens an invite file for your calendar app and asks them through the team folder. Turn on "Allow actions" for Google or Microsoft in Settings to book directly.')

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{tr('Find a time')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {st.members.length > 1 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1 }}>
            {st.members.map((m) => (
              <FormControlLabel key={m.id} control={<Checkbox size="small" checked={ids.includes(m.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, m.id] : x.filter((i) => i !== m.id)))} />} label={m.name} />
            ))}
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField label={tr('Title')} placeholder={tr('Catch-up')} value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" />
          <Select size="small" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} sx={{ minWidth: 120 }}>
            {[15, 30, 45, 60, 90].map((n) => (
              <MenuItem key={n} value={n}>
                {tr('{n} min', { n })}
              </MenuItem>
            ))}
          </Select>
        </Box>
        {!ids.length ? (
          <Typography color="text.secondary">{tr('Pick at least one teammate.')}</Typography>
        ) : !slots ? (
          <CircularProgress size={22} />
        ) : !slots.length ? (
          <Typography color="text.secondary">{tr('No time in the next two weeks fits everyone\'s work hours and calendars. Try a shorter meeting or fewer people.')}</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {slots.map((s) => (
              <ButtonBase
                key={s.s}
                onClick={() => setPick(s.s)}
                sx={(t) => ({ justifyContent: 'flex-start', textAlign: 'start', px: 2, py: 1.25, borderRadius: 3, border: `1.5px solid ${pick === s.s ? t.fs.primary : t.fs.outlineVariant}`, bgcolor: pick === s.s ? t.fs.primaryContainer : 'transparent' })}
              >
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>{new Date(s.s).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {who.map((m) => tr('{name} {time}', { name: m.name, time: hhmm(theirTime(m, s.s)) })).join(' · ')}
                  </Typography>
                </Box>
              </ButtonBase>
            ))}
          </Box>
        )}
        {who.some((m) => !m.shareBusy) && (
          <Typography variant="caption" color="text.secondary">
            {tr('Some teammates do not share busy times; only their work hours are used.')}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy}>
          {tr('Cancel')}
        </Button>
        <Button variant="contained" disabled={busy || pick === null || !ids.length} onClick={() => void bookIt()} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {st.booking === 'ics' ? tr('Send request') : tr('Book')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function SendNotesDialog({ ctx, st, ids, onClose }: { ctx: AppCtx; st: TeamStatus; ids: string[]; onClose: () => void }) {
  const done = useMemo(() => ctx.meetings.filter((m) => m.status === 'done'), [ctx.meetings])
  const [id, setId] = useState(done[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const names = st.members.filter((m) => ids.includes(m.id)).map((m) => m.name).join(', ')
  const sendIt = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.teamSendNotes(id, ids)
      ctx.toast(tr('Your pet is taking the notes to {names}.', { names }))
      onClose()
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{tr('Send notes to {names}', { names })}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {done.length ? (
          <Select size="small" value={id} onChange={(e) => setId(String(e.target.value))}>
            {done.slice(0, 50).map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.title} · {new Date(m.createdAt).toLocaleDateString()}
              </MenuItem>
            ))}
          </Select>
        ) : (
          <Typography color="text.secondary">{tr('No finished meetings yet.')}</Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {tr('Sends the notes, your own notes, the follow-up email and the transcript through the team folder. They choose whether to save it.')}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy}>
          {tr('Cancel')}
        </Button>
        <Button variant="contained" disabled={busy || !id} onClick={() => void sendIt()}>
          {tr('Send')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const lines = (s: string): string[] => s.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean)

function StandupCard({ ctx, st }: { ctx: AppCtx; st: TeamStatus }) {
  const [su, setSu] = useState<Standup | null>(null)
  const [done, setDone] = useState('')
  const [today, setToday] = useState('')
  const [busy, setBusy] = useState(false)
  const fill = (s: Standup): void => {
    setSu(s)
    const mine = s.entries.find((e) => e.memberId === st.memberId)
    setDone((mine?.done ?? s.suggestion.done).join('\n'))
    setToday((mine?.today ?? s.suggestion.today).join('\n'))
  }
  useEffect(() => void api.teamStandup().then(fill), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEvent('team:changed', () => void api.teamStandup().then(setSu))

  const post = async (): Promise<void> => {
    setBusy(true)
    try {
      fill(await api.teamPostStandup({ done: lines(done), today: lines(today) }))
      ctx.toast(tr('Stand-up posted.'))
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const ping = async (): Promise<void> => {
    try {
      const n = await api.teamPingStandup()
      ctx.toast(n === 0 ? tr('Everyone has posted today.') : n === 1 ? tr('Pinged 1 teammate.') : tr('Pinged {n} teammates.', { n }))
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    }
  }
  if (!su) return null
  const mine = su.entries.find((e) => e.memberId === st.memberId)
  const others = su.entries.filter((e) => e.memberId !== st.memberId)
  return (
    <Box sx={(t) => ({ mt: 4, p: 3, borderRadius: 5, bgcolor: t.fs.container })}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          {tr('Stand-up')}{' '}
          <Typography component="span" color="text.secondary">
            · {new Date(`${su.date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
          </Typography>
        </Typography>
        {st.members.length > 0 && <Button onClick={() => void ping()}>{tr('Ping the team')}</Button>}
      </Box>
      {!mine && (su.suggestion.done.length > 0 || su.suggestion.today.length > 0) && (
        <Typography variant="caption" color="text.secondary">
          {tr('Filled in from your promises: done since yesterday and due today.')}
        </Typography>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mt: 1.5 }}>
        <TextField label={tr('Done')} multiline minRows={3} value={done} onChange={(e) => setDone(e.target.value)} placeholder={tr('One item per line')} sx={(t) => ({ bgcolor: t.fs.sheet, borderRadius: 1 })} />
        <TextField label={tr('Today')} multiline minRows={3} value={today} onChange={(e) => setToday(e.target.value)} placeholder={tr('One item per line')} sx={(t) => ({ bgcolor: t.fs.sheet, borderRadius: 1 })} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5 }}>
        <Button variant="contained" disabled={busy || (!lines(done).length && !lines(today).length)} onClick={() => void post()}>
          {mine ? tr('Update stand-up') : tr('Post stand-up')}
        </Button>
        {mine && (
          <Typography variant="caption" color="text.secondary">
            {tr('Posted {time}', { time: new Date(mine.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}
          </Typography>
        )}
      </Box>
      {others.length > 0 && (
        <Box sx={{ mt: 3, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }}>
          {others.map((e) => {
            const m = st.members.find((x) => x.id === e.memberId)
            return (
              <Box key={e.memberId} sx={(t) => ({ p: 2, borderRadius: 4, bgcolor: t.fs.sheet })}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  {m && <PetSvg c={{ ...DEFAULT_PET, ...m.pet }} p={pose('happy')} size={32} />}
                  <Typography sx={{ fontWeight: 600 }}>{e.name}</Typography>
                </Box>
                {e.done.length > 0 && <Typography variant="caption" color="text.secondary">{tr('Done')}</Typography>}
                {e.done.map((l, i) => (
                  <Typography key={`d${i}`} variant="body2">
                    • {l}
                  </Typography>
                ))}
                {e.today.length > 0 && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>{tr('Today')}</Typography>}
                {e.today.map((l, i) => (
                  <Typography key={`t${i}`} variant="body2">
                    • {l}
                  </Typography>
                ))}
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

function SharingCard({ ctx }: { ctx: AppCtx }) {
  const s = ctx.settings
  const hours = Array.from({ length: 25 }, (_, i) => i)
  return (
    <Box sx={(t) => ({ mt: 3, mb: 2, p: 3, borderRadius: 5, border: `1px solid ${t.fs.outlineVariant}` })}>
      <Typography variant="h6">{tr('What your team sees')}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 500 }}>{tr('Share when I am busy')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {tr('Start and end times from your calendar, so teammates can find a time. Never titles or attendees.')}
          </Typography>
        </Box>
        <Switch checked={s.teamShareBusy} onChange={(e) => void ctx.saveSettings({ teamShareBusy: e.target.checked })} inputProps={{ 'aria-label': tr('Share when I am busy') }} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 500, flex: 1 }}>{tr('My work hours')}</Typography>
        <Select size="small" value={s.teamWorkStart} onChange={(e) => void ctx.saveSettings({ teamWorkStart: Math.min(Number(e.target.value), s.teamWorkEnd - 1) })} inputProps={{ 'aria-label': tr('Start') }}>
          {hours.slice(0, 24).map((h) => (
            <MenuItem key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</MenuItem>
          ))}
        </Select>
        <Typography color="text.secondary">–</Typography>
        <Select size="small" value={s.teamWorkEnd} onChange={(e) => void ctx.saveSettings({ teamWorkEnd: Math.max(Number(e.target.value), s.teamWorkStart + 1) })} inputProps={{ 'aria-label': tr('End') }}>
          {hours.slice(1).map((h) => (
            <MenuItem key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</MenuItem>
          ))}
        </Select>
      </Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2 }}>
        {tr('Your name comes from Settings, your pet from the Pet page. Changes reach teammates within a few minutes.')}
      </Typography>
    </Box>
  )
}
