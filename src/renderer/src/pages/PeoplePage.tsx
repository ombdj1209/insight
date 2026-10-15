import { t as tr } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import { Avatar, Box, Button, ButtonBase, CircularProgress, InputBase, Typography } from '@mui/material'
import SearchRounded from '@mui/icons-material/SearchRounded'
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import type { PersonCard } from '../../../shared/types'
import type { AppCtx } from '../App'
import { api, cleanError } from '../api'
import { useCommitments } from '../components/Commitments'
import { Markdown } from '../components/Markdown'

const COLORS = ['#4285F4', '#EA4335', '#F29900', '#34A853', '#A142F4', '#12B5CB']
const initials = (n: string): string =>
  n
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?'
const colorOf = (k: string): string => COLORS[[...k].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]
const first = (s: string): string => s.toLowerCase().replace(/[-\s]?(san|sama|kun|chan)$/, '').split(/\s+/)[0]

export function PeoplePage({ ctx }: { ctx: AppCtx }) {
  const [people, setPeople] = useState<PersonCard[] | null>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const commitments = useCommitments()
  useEffect(() => void api.people().then((p) => (setPeople(p), setSel((s) => s ?? p[0]?.key ?? null))), [])
  const list = useMemo(() => (people ?? []).filter((p) => !q || `${p.name} ${p.email ?? ''}`.toLowerCase().includes(q.toLowerCase())), [people, q])
  const p = people?.find((x) => x.key === sel) ?? null
  const theirs = p ? commitments.filter((c) => c.status === 'open' && ((c.email && c.email.toLowerCase() === p.email?.toLowerCase()) || first(c.isMe ? c.forPerson ?? '' : c.person) === first(p.name))) : []

  const summarize = async (): Promise<void> => {
    if (!p) return
    setBusy(true)
    try {
      const u = await api.summarizePerson(p.key)
      if (u) setPeople((ps) => ps?.map((x) => (x.key === u.key ? u : x)) ?? null)
    } catch (e) {
      ctx.toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (people && !people.length)
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', p: 4 }}>
        <Box>
          <GroupsOutlined sx={{ fontSize: 48, color: 'text.secondary' }} />
          <Typography variant="h6" sx={{ mt: 1 }}>
            {tr("No people yet")}
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 440 }}>
            {tr("People appear here after meetings: from calendar attendees and from the speakers you name in transcripts.")}
          </Typography>
        </Box>
      </Box>
    )
  return (
    <Box sx={{ height: '100%', display: 'grid', gridTemplateColumns: '320px 1fr', minHeight: 0 }}>
      <Box sx={(t) => ({ borderRight: `1px solid ${t.fs.outlineVariant}`, display: 'flex', flexDirection: 'column', minHeight: 0 })}>
        <Box sx={{ p: 2 }}>
          <Typography variant="h5" component="h1" sx={{ mb: 1.5 }}>
            {tr("People")}
          </Typography>
          <Box sx={(t) => ({ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.5, borderRadius: 99, bgcolor: t.fs.container })}>
            <SearchRounded fontSize="small" />
            <InputBase placeholder={tr("Search people")} value={q} onChange={(e) => setQ(e.target.value)} fullWidth inputProps={{ 'aria-label': tr("Search people") }} />
          </Box>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', px: 1, pb: 2 }}>
          {!people && <CircularProgress size={22} sx={{ m: 2 }} />}
          {list.map((x) => (
            <ButtonBase key={x.key} onClick={() => setSel(x.key)} sx={(t) => ({ width: '100%', display: 'flex', gap: 1.5, alignItems: 'center', p: 1.25, borderRadius: 3, textAlign: 'start', bgcolor: x.key === sel ? t.fs.secondaryContainer : 'transparent' })}>
              <Avatar sx={{ bgcolor: colorOf(x.key), width: 38, height: 38, fontSize: 15 }}>{initials(x.name)}</Avatar>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography noWrap sx={{ fontWeight: 600 }}>
                  {x.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {x.meetings.length}{' '}{tr("meeting")}{x.meetings.length === 1 ? '' : 's'}{' '}{tr("· last")}{' '}{new Date(x.lastMet).toLocaleDateString()}
                </Typography>
              </Box>
              {x.youOwe + x.theyOwe > 0 && <Box sx={(t) => ({ fontSize: 11, fontWeight: 700, px: 0.9, borderRadius: 8, bgcolor: t.fs.tertiaryContainer, color: t.fs.onTertiaryContainer })}>{x.youOwe + x.theyOwe}</Box>}
            </ButtonBase>
          ))}
        </Box>
      </Box>
      <Box sx={{ overflowY: 'auto', p: { xs: 3, md: 5 } }}>
        {p && (
          <Box sx={{ maxWidth: 820 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <Avatar sx={{ bgcolor: colorOf(p.key), width: 64, height: 64, fontSize: 24 }}>{initials(p.name)}</Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h4" noWrap>
                  {p.name}
                </Typography>
                <Typography color="text.secondary">{p.email ?? tr("From meeting transcripts")}</Typography>
              </Box>
              <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeRounded />} disabled={busy} onClick={() => void summarize()}>
                {p.summary ? tr("Refresh") : tr("Brief me")}
              </Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, mt: 3, flexWrap: 'wrap' }}>
              {[
                [p.meetings.length, 'meetings together'],
                [p.youOwe, 'you owe them'],
                [p.theyOwe, 'they owe you']
              ].map(([v, l]) => (
                <Box key={String(l)} sx={(t) => ({ px: 2.5, py: 1.5, borderRadius: 4, bgcolor: t.fs.container, minWidth: 140 })}>
                  <Typography sx={{ fontSize: 26, fontWeight: 700 }}>{v}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {l}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Box sx={(t) => ({ mt: 3, p: 3, borderRadius: 5, border: `1px solid ${t.fs.outlineVariant}` })}>
              {p.summary ? (
                <>
                  <Markdown text={p.summary} />
                  <Typography variant="caption" color="text.secondary">
                    {tr("Summary from your meetings,")}{' '}{new Date(p.summaryAt ?? Date.now()).toLocaleString()}{tr(". You can also ask \"Brief me on")}{' '}{p.name.split(' ')[0]}{tr("\" in Ask.")}
                  </Typography>
                </>
              ) : (
                <Typography color="text.secondary">{tr("Press \"Brief me\" for what you work on together, their priorities and open items, written from your meeting notes.")}</Typography>
              )}
            </Box>
            {theirs.length > 0 && (
              <>
                <Typography variant="subtitle1" sx={{ mt: 3, mb: 1, fontWeight: 600 }}>
                  {tr("Open promises")}
                </Typography>
                {theirs.map((c) => (
                  <Typography key={c.id} sx={{ py: 0.5 }}>
                    {c.isMe ? tr("→ You: ") : tr("← They: ")}
                    {c.text}
                    {c.due && (
                      <Typography component="span" color="text.secondary">
                        {' '}
                        {tr("· due")}{' '}{c.due}
                      </Typography>
                    )}
                  </Typography>
                ))}
              </>
            )}
            <Typography variant="subtitle1" sx={{ mt: 3, mb: 1, fontWeight: 600 }}>
              {tr("Meetings")}
            </Typography>
            {p.meetings
              .slice()
              .sort((a, b) => b.at - a.at)
              .map((m) => (
                <ButtonBase key={m.id} onClick={() => ctx.go({ page: 'meeting', meetingId: m.id })} sx={(t) => ({ display: 'flex', width: '100%', justifyContent: 'space-between', px: 2, py: 1.25, borderRadius: 3, '&:hover': { bgcolor: t.fs.container } })}>
                  <Typography noWrap sx={{ fontWeight: 500 }}>
                    {m.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 'none', ml: 2 }}>
                    {new Date(m.at).toLocaleDateString()}
                  </Typography>
                </ButtonBase>
              ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}
