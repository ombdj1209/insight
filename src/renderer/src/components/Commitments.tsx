import { t as tr } from '../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import {
  Alert, Box, Button, ButtonBase, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Select, TextField, Tooltip, Typography
} from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import DraftsOutlined from '@mui/icons-material/DraftsOutlined'
import TaskAltRounded from '@mui/icons-material/TaskAltRounded'
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded'
import HandshakeOutlined from '@mui/icons-material/HandshakeOutlined'
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded'
import type { Commitment, Meeting } from '../../../shared/types'
import type { GoogleStatus } from '../../../shared/google'
import type { AppCtx } from '../App'
import { api, cleanError, useEvent } from '../api'
import { writtenFor } from '../../../shared/languages'

export function useCommitments(): Commitment[] {
  const [items, setItems] = useState<Commitment[]>([])
  useEffect(() => void api.commitments().then(setItems), [])
  useEvent('commitments:changed', setItems)
  return items
}

const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function dueChip(due: string | null): ReactNode {
  if (!due) return null
  const today = ymd(new Date())
  const tomorrow = ymd(new Date(Date.now() + 86_400_000))
  const label = due < today ? tr('Overdue · {date}', { date: due.slice(5) }) : due === today ? tr('Today') : due === tomorrow ? tr('Tomorrow') : due.slice(5).replace('-', '/')
  const color = due < today ? 'error' : due <= tomorrow ? 'warning' : 'default'
  return <Chip size="small" label={label} color={color as 'error'} variant={color === 'default' ? 'outlined' : 'filled'} sx={{ height: 24, fontWeight: 600 }} />
}
const order = (a: Commitment, b: Commitment): number => (a.due ?? '9999') .localeCompare(b.due ?? '9999') || a.createdAt - b.createdAt

function Row({ c, ctx, showMeeting }: { c: Commitment; ctx: AppCtx; showMeeting?: boolean }) {
  const done = c.status === 'done'
  return (
    <Box sx={(t) => ({ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, '& + &': { borderTop: `1px solid ${t.fs.sheet}` } })}>
      <Checkbox checked={done} onChange={(e) => void api.updateCommitment(c.id, { status: e.target.checked ? 'done' : 'open' })} inputProps={{ 'aria-label': tr("Done: {text}", { text: c.text }) }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 500, textDecoration: done ? 'line-through' : 'none', color: done ? 'text.secondary' : 'text.primary' }}>{c.text}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {c.isMe ? (c.forPerson ? tr("For {forPerson}", { forPerson: c.forPerson }) : tr("Your promise")) : tr("{person} promised", { person: c.person })}
          {showMeeting && (
            <>
              {' · '}
              <ButtonBase onClick={() => ctx.go({ page: 'meeting', meetingId: c.meetingId })} sx={{ fontSize: 'inherit', color: 'primary.main', verticalAlign: 'baseline' }}>
                {c.meetingTitle}
              </ButtonBase>
            </>
          )}
          {c.quote && ` · “${c.quote.slice(0, 80)}”`}
        </Typography>
      </Box>
      {!done && dueChip(c.due)}
      <Tooltip title={tr("Not a real promise")}>
        <IconButton size="small" onClick={() => void api.updateCommitment(c.id, { status: 'dismissed' })} aria-label={tr("Dismiss")}>
          <CloseRounded fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

/** Home page: what you promised, and what others owe you. */
export function PromisesCard({ ctx }: { ctx: AppCtx }) {
  const items = useCommitments()
  const [showOthers, setShowOthers] = useState(false)
  const mine = items.filter((c) => c.isMe && c.status === 'open').sort(order)
  const theirs = items.filter((c) => !c.isMe && c.status === 'open').sort(order)
  if (!mine.length && !theirs.length) return null
  return (
    <Box component="section" sx={{ mt: 5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, px: 1 }}>
        <HandshakeOutlined fontSize="small" />
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, flex: 1 }}>
          {tr("Your promises")}
        </Typography>
        {theirs.length > 0 && (
          <Button size="small" onClick={() => setShowOthers((v) => !v)}>
            {showOthers ? tr("Hide") : tr("Waiting on others ({length})", { length: theirs.length })}
          </Button>
        )}
      </Box>
      <Box sx={(t) => ({ borderRadius: 5, bgcolor: t.fs.container, overflow: 'hidden' })}>
        {mine.length ? mine.slice(0, 8).map((c) => <Row key={c.id} c={c} ctx={ctx} showMeeting />) : <Typography sx={{ p: 2.5 }} color="text.secondary">{tr("Nothing you owe anyone. Nice.")}</Typography>}
      </Box>
      {showOthers && (
        <Box sx={(t) => ({ mt: 1.5, borderRadius: 5, bgcolor: t.fs.container, overflow: 'hidden' })}>
          {theirs.slice(0, 10).map((c) => (
            <Row key={c.id} c={c} ctx={ctx} showMeeting />
          ))}
        </Box>
      )}
    </Box>
  )
}

// ---------- follow-through on a meeting ----------
type Dlg = 'draft' | 'tasks' | 'book' | null
type Provider = 'google' | 'microsoft'
const P = {
  google: { mail: 'Gmail', tasks: 'Google Tasks', meet: 'Google Meet', draft: api.gDraft, addTasks: api.gTasks, event: api.gEvent },
  microsoft: { mail: 'Outlook', tasks: 'Microsoft To Do', meet: 'Microsoft Teams', draft: api.msDraft, addTasks: api.msTasks, event: api.msEvent }
}

function parseEmail(text: string): { subject: string; body: string } {
  const lines = text.trim().split('\n')
  const i = lines.findIndex((l) => /^\s*(\*\*)?(subject|件名)(\*\*)?\s*[:：]/i.test(l))
  if (i < 0) return { subject: '', body: text.trim() }
  const subject = lines[i].replace(/^\s*(\*\*)?(subject|件名)(\*\*)?\s*[:：]\s*/i, '').replace(/\*\*/g, '').trim()
  return { subject, body: lines.slice(i + 1).join('\n').trim() }
}
const localInput = (ms: number): string => {
  const d = new Date(ms)
  return `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function FollowThrough({ ctx, m }: { ctx: AppCtx; m: Meeting }) {
  const all = useCommitments()
  const items = all.filter((c) => c.meetingId === m.id && c.status !== 'dismissed').sort(order)
  const [finding, setFinding] = useState(false)
  const [dlg, setDlg] = useState<Dlg>(null)
  const [g, setG] = useState<GoogleStatus | null>(null)
  const [ms, setMs] = useState<{ connected: boolean; actionsNeedReconnect: boolean } | null>(null)
  useEffect(() => {
    void api.googleStatus().then(setG)
    void api.msStatus().then(setMs)
  }, [])
  useEvent('google:changed', setG)
  useEvent('ms:changed', setMs)
  const gReady = !!g?.connected && ctx.settings.googleActions && !g.actionsNeedReconnect
  const mReady = !!ms?.connected && ctx.settings.msActions && !ms.actionsNeedReconnect
  const ready = gReady || mReady
  const [pick, setPick] = useState<Provider>('google')
  const provider: Provider = gReady && mReady ? pick : mReady ? 'microsoft' : 'google'
  const people = (m.calendar?.people ?? []).filter((p) => !p.self)

  const find = async (): Promise<void> => {
    setFinding(true)
    try {
      const r = await api.extractCommitments(m.id)
      if (!r.length) ctx.toast(tr("No clear commitments found in this meeting."))
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setFinding(false)
    }
  }

  return (
    <Box sx={(t) => ({ mt: 2, p: 3, borderRadius: 6, border: `1px solid ${t.fs.outlineVariant}` })}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <HandshakeOutlined fontSize="small" />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {tr("Follow-through")}
        </Typography>
        <Button size="small" startIcon={finding ? <CircularProgress size={14} /> : <AutoAwesomeRounded />} disabled={finding} onClick={() => void find()}>
          {items.length ? tr("Find again") : tr("Find promises")}
        </Button>
      </Box>
      {items.length > 0 ? (
        <Box sx={(t) => ({ borderRadius: 4, bgcolor: t.fs.container, overflow: 'hidden', mb: 2 })}>
          {items.map((c) => (
            <Row key={c.id} c={c} ctx={ctx} />
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {tr("Promises people made in this meeting show up here, and Insight reminds you before yours are due.")}
        </Typography>
      )}
      {!ready && (
        <Alert
          severity="info"
          sx={{ mb: 1.5, borderRadius: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => ctx.go({ page: 'settings' })}>
              {tr("Settings")}
            </Button>
          }
        >
          {!g?.connected && !ms?.connected ? tr("Connect Google or Microsoft 365") : g?.actionsNeedReconnect || ms?.actionsNeedReconnect ? tr("Reconnect your account") : tr("Turn on \"Allow actions\" for Google or Microsoft 365")}{' '}{tr("to draft emails, add tasks and book meetings in one click.")}
        </Alert>
      )}
      {gReady && mReady && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
          {(['google', 'microsoft'] as Provider[]).map((p) => (
            <Chip key={p} label={p === 'google' ? tr("Google") : tr("Microsoft 365")} color={provider === p ? 'primary' : 'default'} variant={provider === p ? 'filled' : 'outlined'} onClick={() => setPick(p)} />
          ))}
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" startIcon={<DraftsOutlined />} disabled={!ready} onClick={() => setDlg('draft')}>
          {tr("Draft follow-up in {mail}", { mail: P[provider].mail })}
        </Button>
        <Button variant="outlined" startIcon={<TaskAltRounded />} disabled={!ready || !items.length} onClick={() => setDlg('tasks')}>
          {tr("Add to {tasks}", { tasks: P[provider].tasks })}
        </Button>
        <Button variant="outlined" startIcon={<EventAvailableRounded />} disabled={!ready} onClick={() => setDlg('book')}>
          {tr("Book follow-up")}
        </Button>
      </Box>
      {dlg === 'draft' && <DraftDialog ctx={ctx} m={m} to={people.map((p) => p.email)} provider={provider} onClose={() => setDlg(null)} />}
      {dlg === 'tasks' && <TasksDialog ctx={ctx} m={m} items={items.filter((c) => c.status === 'open')} provider={provider} onClose={() => setDlg(null)} />}
      {dlg === 'book' && <BookDialog ctx={ctx} m={m} to={people.map((p) => p.email)} provider={provider} onClose={() => setDlg(null)} />}
    </Box>
  )
}

function Confirm({ title, children, onClose, onConfirm, label, busy, note }: { title: string; children: ReactNode; onClose: () => void; onConfirm: () => void; label: string; busy: boolean; note: string }) {
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {children}
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy}>
          {tr("Cancel")}
        </Button>
        <Button variant="contained" onClick={onConfirm} disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {label}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function DraftDialog({ ctx, m, to, provider, onClose }: { ctx: AppCtx; m: Meeting; to: string[]; provider: Provider; onClose: () => void }) {
  const [rcpt, setRcpt] = useState(to.join(', '))
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const go = async (): Promise<void> => {
      try {
        const text = m.followUp || (await api.followUp(m.id, writtenFor(ctx.settings.language), 'friendly'))
        const p = parseEmail(text)
        setSubject(p.subject || `Recap: ${m.title}`)
        setBody(p.body)
      } catch (e) {
        ctx.toast(cleanError(e), 'error')
        onClose()
      } finally {
        setLoading(false)
      }
    }
    void go()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await P[provider].draft({ to: rcpt.split(/[,;\s]+/).filter(Boolean), subject, body })
      ctx.toast(tr("Draft saved in {mail}. Review and send it there.", { mail: P[provider].mail }))
      void api.openExternal(r.url)
      onClose()
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Confirm title={tr("Draft the follow-up in {mail}", { mail: P[provider].mail })} onClose={onClose} onConfirm={() => void save()} label={tr("Save as draft")} busy={busy || loading} note={tr("Saved to your {mail} drafts. Nothing is sent until you send it yourself.", { mail: P[provider].mail })}>
      {loading ? (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <CircularProgress size={18} />{' '}{tr("Writing the email…")}
        </Box>
      ) : (
        <>
          <TextField label={tr("To")} value={rcpt} onChange={(e) => setRcpt(e.target.value)} placeholder={tr("name@company.com, …")} size="small" fullWidth />
          <TextField label={tr("Subject")} value={subject} onChange={(e) => setSubject(e.target.value)} size="small" fullWidth />
          <TextField label={tr("Message")} value={body} onChange={(e) => setBody(e.target.value)} multiline minRows={8} maxRows={16} fullWidth />
        </>
      )}
    </Confirm>
  )
}

function TasksDialog({ ctx, m, items, provider, onClose }: { ctx: AppCtx; m: Meeting; items: Commitment[]; provider: Provider; onClose: () => void }) {
  const [rows, setRows] = useState(items.map((c) => ({ id: c.id, on: c.isMe, title: c.isMe ? c.text : `${c.person}: ${c.text}`, due: c.due ?? '', quote: c.quote })))
  const [busy, setBusy] = useState(false)
  const n = rows.filter((r) => r.on).length
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await P[provider].addTasks(rows.filter((x) => x.on).map((x) => ({ title: x.title, due: x.due || null, notes: `From "${m.title}" (${new Date(m.createdAt).toLocaleDateString()})${x.quote ? `\n“${x.quote}”` : ''}` })))
      ctx.toast(r.added === 1 ? tr('Added 1 task to {tasks}.', { tasks: P[provider].tasks }) : tr('Added {n} tasks to {tasks}.', { n: r.added, tasks: P[provider].tasks }))
      onClose()
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Confirm title={tr("Add to {tasks}", { tasks: P[provider].tasks })} onClose={onClose} onConfirm={() => void save()} label={n === 1 ? tr('Add 1 task') : tr('Add {n} tasks', { n })} busy={busy || !n} note={tr("Added to your default task list. Your own promises are selected; tick others to track what you're waiting on.")}>
      {rows.map((r, i) => (
        <Box key={r.id} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Checkbox checked={r.on} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} />
          <TextField size="small" value={r.title} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} sx={{ flex: 1 }} />
          <TextField size="small" type="date" value={r.due} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, due: e.target.value } : y)))} sx={{ width: 160 }} />
        </Box>
      ))}
    </Confirm>
  )
}

function BookDialog({ ctx, m, to, provider, onClose }: { ctx: AppCtx; m: Meeting; to: string[]; provider: Provider; onClose: () => void }) {
  const base = new Date(m.calendar?.start ?? m.createdAt)
  const next = new Date(base.getTime() + 7 * 86_400_000)
  if (next.getTime() < Date.now()) next.setTime(Date.now() + 86_400_000)
  next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15, 0, 0)
  const [title, setTitle] = useState(`Follow-up: ${m.calendar?.title ?? m.title}`)
  const [when, setWhen] = useState(localInput(next.getTime()))
  const [minutes, setMinutes] = useState(30)
  const [rcpt, setRcpt] = useState(to.join(', '))
  const [meet, setMeet] = useState(true)
  const [busy, setBusy] = useState(false)
  const emails = rcpt.split(/[,;\s]+/).filter(Boolean)
  const desc = m.enhanced ? m.enhanced.split('\n').filter((l) => /^\s*[-*]\s/.test(l)).slice(0, 6).join('\n') : ''
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await P[provider].event({ title, start: new Date(when).getTime(), minutes, attendees: emails, meet, description: `Follow-up to "${m.title}".\n\n${desc}`.trim() })
      ctx.toast(emails.length ? emails.length === 1 ? tr('Booked. Invite sent to 1 person.') : tr('Booked. Invites sent to {n} people.', { n: emails.length }) : tr("Booked on your calendar."))
      void api.openExternal(r.url)
      onClose()
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Confirm
      title={tr("Book a follow-up meeting")}
      onClose={onClose}
      onConfirm={() => void save()}
      label={emails.length ? tr("Book and invite {length}", { length: emails.length }) : tr("Book")}
      busy={busy}
      note={emails.length ? tr("{v0} will email an invitation to: {v1}.", { v0: provider === 'google' ? 'Google Calendar' : 'Outlook', v1: emails.join(', ') }) : tr("Only you are on this event. Add emails to invite others.")}
    >
      <TextField label={tr("Title")} value={title} onChange={(e) => setTitle(e.target.value)} size="small" fullWidth />
      <Box sx={{ display: 'flex', gap: 1.5 }}>
        <TextField label={tr("Starts")} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} size="small" sx={{ flex: 1 }} InputLabelProps={{ shrink: true }} />
        <Select size="small" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {[15, 30, 45, 60, 90].map((x) => (
            <MenuItem key={x} value={x}>
              {tr("{m} min", { m: x })}
            </MenuItem>
          ))}
        </Select>
      </Box>
      <TextField label={tr("Invite")} value={rcpt} onChange={(e) => setRcpt(e.target.value)} placeholder={tr("name@company.com, …")} size="small" fullWidth />
      <FormControlLabel control={<Checkbox checked={meet} onChange={(e) => setMeet(e.target.checked)} />} label={tr("Add a {meet} link", { meet: P[provider].meet })} />
    </Confirm>
  )
}
