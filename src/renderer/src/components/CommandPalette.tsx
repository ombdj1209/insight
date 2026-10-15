import { t as tr } from '../i18n'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, ButtonBase, CircularProgress, Dialog, InputBase, Typography } from '@mui/material'
import SearchRounded from '@mui/icons-material/SearchRounded'
import MicRounded from '@mui/icons-material/MicRounded'
import CreateNewFolderRounded from '@mui/icons-material/CreateNewFolderRounded'
import ForumRounded from '@mui/icons-material/ForumRounded'
import SettingsRounded from '@mui/icons-material/SettingsRounded'
import EventNoteRounded from '@mui/icons-material/EventNoteRounded'
import type { MeetingSummary, SearchHit } from '../../../shared/types'
import type { AppCtx } from '../App'
import { api } from '../api'
import { FileTile } from './ui'
import { openCitation } from './Citations'

interface Item {
  key: string
  group: string
  icon: ReactNode
  title: string
  sub?: string
  run: () => void
}

export function CommandPalette({ open, onClose, ctx, meetings }: { open: boolean; onClose: () => void; ctx: AppCtx; meetings: MeetingSummary[] }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setHits([])
      setSel(0)
    }
  }, [open])

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setHits([])
      return
    }
    const t = window.setTimeout(async () => {
      setLoading(true)
      try {
        setHits(await api.search(q, {}))
      } catch {
        setHits([])
      } finally {
        setLoading(false)
      }
    }, 220)
    return () => window.clearTimeout(t)
  }, [q, open])

  const items = useMemo<Item[]>(() => {
    const close = (fn: () => void) => () => {
      onClose()
      fn()
    }
    const ql = q.trim().toLowerCase()
    const actions: Item[] = [
      { key: 'a-listen', group: tr("Actions"), icon: <MicRounded />, title: tr("Start listening"), sub: tr("Ctrl+Shift+Space"), run: close(() => void ctx.startListening()) },
      { key: 'a-ask', group: tr("Actions"), icon: <ForumRounded />, title: tr("Ask your knowledge"), run: close(() => ctx.go({ page: 'chat' })) },
      { key: 'a-folder', group: tr("Actions"), icon: <CreateNewFolderRounded />, title: tr("Add a folder to Knowledge"), run: close(() => ctx.go({ page: 'knowledge' })) },
      { key: 'a-settings', group: tr("Actions"), icon: <SettingsRounded />, title: tr("Open settings"), run: close(() => ctx.go({ page: 'settings' })) }
    ].filter((a) => !ql || a.title.toLowerCase().includes(ql))
    const ms: Item[] = meetings
      .filter((m) => !ql || m.title.toLowerCase().includes(ql) || m.preview.toLowerCase().includes(ql))
      .slice(0, ql ? 6 : 4)
      .map((m) => ({
        key: `m-${m.id}`,
        group: tr("Meetings"),
        icon: <EventNoteRounded />,
        title: m.title,
        sub: new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        run: close(() => ctx.go({ page: 'meeting', meetingId: m.id }))
      }))
    const ks: Item[] = hits.slice(0, 8).map((h) => ({
      key: `k-${h.chunkId}`,
      group: tr("From your knowledge"),
      icon: <FileTile kind={h.kind} path={h.path} size={28} />,
      title: h.title + (h.loc ? ` · ${h.loc}` : ''),
      sub: h.text.replace(/\s+/g, ' ').slice(0, 120),
      run: close(() => openCitation(h))
    }))
    return [...actions, ...ms, ...ks]
  }, [q, hits, meetings, ctx, onClose])

  useEffect(() => setSel((s) => Math.min(s, Math.max(0, items.length - 1))), [items.length])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  let lastGroup = ''
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 4, overflow: 'hidden', alignSelf: 'flex-start', mt: '12vh' } }}>
      <Box sx={(t) => ({ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, height: 60, borderBottom: `1px solid ${t.fs.outlineVariant}` })}>
        {loading ? <CircularProgress size={22} /> : <SearchRounded sx={{ color: 'text.secondary' }} />}
        <InputBase
          autoFocus
          fullWidth
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(items.length - 1, s + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(0, s - 1))
            } else if (e.key === 'Enter') items[sel]?.run()
          }}
          placeholder={tr("Search meetings and files, or type a command")}
          sx={{ fontSize: 17 }}
          inputProps={{ 'aria-label': tr("Search") }}
        />
      </Box>
      <Box ref={listRef} sx={{ maxHeight: '56vh', overflowY: 'auto', py: 1 }}>
        {items.length === 0 && !loading && (
          <Typography color="text.secondary" sx={{ px: 3, py: 3 }}>
            {tr("No matches. Try different words.")}
          </Typography>
        )}
        {items.map((it, i) => {
          const header = it.group !== lastGroup
          lastGroup = it.group
          return (
            <Box key={it.key}>
              {header && <Typography sx={{ px: 3, pt: 1.5, pb: 0.5, fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>{it.group}</Typography>}
              <ButtonBase
                data-idx={i}
                onClick={it.run}
                onMouseEnter={() => setSel(i)}
                sx={(t) => ({
                  width: 'calc(100% - 16px)',
                  mx: 1,
                  px: 2,
                  py: 1.1,
                  gap: 1.75,
                  borderRadius: 3,
                  justifyContent: 'flex-start',
                  textAlign: 'start',
                  bgcolor: sel === i ? t.fs.secondaryContainer : 'transparent',
                  color: sel === i ? t.fs.onSecondaryContainer : 'inherit'
                })}
              >
                <Box sx={{ display: 'grid', placeItems: 'center', width: 28, color: 'text.secondary' }}>{it.icon}</Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontWeight: 500, fontSize: 14.5 }}>
                    {it.title}
                  </Typography>
                  {it.sub && (
                    <Typography noWrap variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                      {it.sub}
                    </Typography>
                  )}
                </Box>
              </ButtonBase>
            </Box>
          )
        })}
      </Box>
    </Dialog>
  )
}
