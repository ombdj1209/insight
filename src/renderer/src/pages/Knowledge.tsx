import { t as tr } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import { Autocomplete, Box, Button, ButtonBase, Chip, CircularProgress, IconButton, InputBase, LinearProgress, TextField, Tooltip, Typography } from '@mui/material'
import CreateNewFolderRounded from '@mui/icons-material/CreateNewFolderRounded'
import NoteAddOutlined from '@mui/icons-material/NoteAddOutlined'
import EventOutlined from '@mui/icons-material/EventOutlined'
import BookmarkBorder from '@mui/icons-material/BookmarkBorder'
import SearchRounded from '@mui/icons-material/SearchRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import CloudSyncOutlined from '@mui/icons-material/CloudSyncOutlined'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import type { KnowledgeSource, SearchHit, SourceType } from '../../../shared/types'
import type { AppCtx } from '../App'
import { api, cleanError, useEvent } from '../api'
import { openCitation } from '../components/Citations'
import { EmptyArt, FileTile } from '../components/ui'

const kindForSource = (t: SourceType) => (t === 'calendar' ? 'calendar' : t === 'bookmarks' ? 'bookmark' : 'file') as 'calendar' | 'bookmark' | 'file'

function SourceCard({ s, labels }: { s: KnowledgeSource; labels: string[] }) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(s.label)
  const name = s.path.split(/[\\/]/).filter(Boolean).pop()
  return (
    <Box sx={(t) => ({ p: 2, borderRadius: 5, bgcolor: t.fs.container, display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0 })}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
        <FileTile kind={kindForSource(s.type)} path={s.path} folder={s.type === 'folder'} size={44} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontWeight: 600, fontSize: 15.5 }}>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div" title={s.path}>
            {s.path}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 32 }}>
        {editing ? (
          <Autocomplete
            freeSolo
            size="small"
            options={labels}
            value={label}
            onInputChange={(_e, v) => setLabel(v)}
            onBlur={() => {
              setEditing(false)
              if (label.trim() && label !== s.label) void api.relabelSource(s.id, label.trim())
            }}
            renderInput={(p) => <TextField {...p} autoFocus placeholder={tr("Label")} />}
            sx={{ width: 170 }}
          />
        ) : (
          <Tooltip title={tr("Change label")}>
            <Chip size="small" label={s.label} onClick={() => setEditing(true)} sx={(t) => ({ bgcolor: t.fs.secondaryContainer, color: t.fs.onSecondaryContainer, fontWeight: 600 })} />
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={tr("Show in Explorer")}>
          <IconButton size="small" onClick={() => void api.reveal(s.path)} aria-label={tr("Show in Explorer")}>
            <FolderOpenRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={tr("Re-index")}>
          <IconButton size="small" onClick={() => void api.reindexSource(s.id)} aria-label={tr("Re-index")}>
            <RefreshRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={tr("Remove (your files are not touched)")}>
          <IconButton size="small" onClick={() => void api.removeSource(s.id)} aria-label={tr("Remove source")}>
            <DeleteOutlineRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      {s.status === 'indexing' && s.progress && s.progress.total > 0 ? (
        <Box>
          <LinearProgress variant="determinate" value={(s.progress.done / s.progress.total) * 100} />
          <Typography variant="caption" color="text.secondary">
            {tr("Reading")}{' '}{s.progress.done}{' '}{tr("of")}{' '}{s.progress.total}{' '}{tr("files")}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {s.status === 'error' ? (
            <ErrorOutlineRounded color="error" sx={{ fontSize: 16 }} />
          ) : s.status === 'ready' ? (
            <CheckRounded color="success" sx={{ fontSize: 16 }} />
          ) : (
            <CloudSyncOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
          )}
          <Typography variant="caption" sx={{ color: s.status === 'error' ? 'error.main' : 'text.secondary', fontWeight: 500 }} noWrap>
            {s.status === 'error'
              ? s.error
              : s.status === 'queued' || s.status === 'indexing'
                ? tr("Waiting to index")
                : s.fileCount === 1 ? tr('1 file · {chunkCount} passages · kept in sync', { chunkCount: s.chunkCount }) : tr('{fileCount} files · {chunkCount} passages · kept in sync', { fileCount: s.fileCount, chunkCount: s.chunkCount })}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

export function KnowledgePage({ ctx }: { ctx: AppCtx }) {
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [newLabel, setNewLabel] = useState('General')
  const [filter, setFilter] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => void api.sources().then(setSources), [])
  useEvent('sources:changed', setSources)

  const labels = useMemo(() => [...new Set(sources.map((s) => s.label))].sort(), [sources])
  const visible = filter.length ? sources.filter((s) => filter.includes(s.label)) : sources
  const totals = sources.reduce((a, s) => ({ files: a.files + s.fileCount, chunks: a.chunks + s.chunkCount }), { files: 0, chunks: 0 })

  useEffect(() => {
    if (!query.trim()) {
      setHits(null)
      return
    }
    const t = window.setTimeout(async () => {
      setSearching(true)
      try {
        setHits(await api.search(query, { labels: filter.length ? filter : undefined }))
      } catch (e) {
        ctx.toast(cleanError(e), 'error')
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => window.clearTimeout(t)
  }, [query, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = (type: SourceType) => void api.addSource(type, newLabel.trim() || 'General').then(setSources)

  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      <Box sx={{ maxWidth: 1120, mx: 'auto', px: { xs: 3, md: 6 }, pt: 5, pb: 10 }}>
        <Typography variant="h4" component="h1">
          {tr("Knowledge")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75, mb: 3, maxWidth: 700 }}>
          {tr("Point Insight at project folders, reference material, diagrams and calendars. Everything is indexed on this PC so chat and Live Assistance can cite it.")}
          {sources.length > 0 && tr(" {files} files, {chunks} passages.", { files: totals.files, chunks: totals.chunks })}
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 3 }}>
          <Button variant="contained" startIcon={<CreateNewFolderRounded />} onClick={() => add('folder')} sx={{ height: 48, px: 3, borderRadius: 4 }}>
            {tr("Add folder")}
          </Button>
          <Button variant="contained" color="inherit" startIcon={<NoteAddOutlined />} onClick={() => add('file')}>
            {tr("Files")}
          </Button>
          <Button variant="contained" color="inherit" startIcon={<EventOutlined />} onClick={() => add('calendar')}>
            {tr("Calendar (.ics)")}
          </Button>
          <Button variant="contained" color="inherit" startIcon={<BookmarkBorder />} onClick={() => add('bookmarks')}>
            {tr("Bookmarks")}
          </Button>
          <Autocomplete
            freeSolo
            size="small"
            options={labels}
            value={newLabel}
            onInputChange={(_e, v) => setNewLabel(v)}
            renderInput={(p) => <TextField {...p} label={tr("Label for new sources")} />}
            sx={{ width: 230, ml: 'auto' }}
          />
        </Box>

        <Box
          sx={(t) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2.5,
            height: 60,
            borderRadius: 30,
            bgcolor: t.fs.container,
            transition: 'box-shadow 150ms, background 150ms',
            '&:focus-within': { bgcolor: t.fs.sheet, boxShadow: t.fs.elevationHigh }
          })}
        >
          {searching ? <CircularProgress size={22} /> : <SearchRounded sx={{ color: 'text.secondary' }} />}
          <InputBase
            fullWidth
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("Search by meaning or exact words: “Q3 pricing”, “INV-2026-042”, 見積もり")}
            inputProps={{ 'aria-label': tr("Search knowledge") }}
            sx={{ fontSize: 16 }}
          />
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
          {[...labels, ...(labels.includes('Meetings') ? [] : ['Meetings'])].map((l) => {
            const on = filter.includes(l)
            return (
              <Chip
                key={l}
                label={l}
                icon={on ? <CheckRounded /> : undefined}
                variant={on ? 'filled' : 'outlined'}
                onClick={() => setFilter((f) => (on ? f.filter((x) => x !== l) : [...f, l]))}
                sx={(t) => (on ? { bgcolor: t.fs.secondaryContainer, color: t.fs.onSecondaryContainer, '& .MuiChip-icon': { color: 'inherit' } } : {})}
              />
            )
          })}
        </Box>

        {hits && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, px: 1 }}>
              {hits.length ? tr("{length} best passages", { length: hits.length }) : tr("No matches. Try other words or add more sources.")}
            </Typography>
            <Box sx={(t) => ({ borderRadius: 5, border: hits.length ? `1px solid ${t.fs.outlineVariant}` : 'none', overflow: 'hidden' })}>
              {hits.map((h, i) => (
                <ButtonBase
                  key={h.chunkId}
                  onClick={() => openCitation(h)}
                  sx={(t) => ({
                    width: '100%',
                    display: 'flex',
                    gap: 2,
                    alignItems: 'flex-start',
                    textAlign: 'start',
                    px: 2.5,
                    py: 1.75,
                    borderTop: i ? `1px solid ${t.fs.outlineVariant}` : 'none',
                    '&:hover': { bgcolor: t.fs.container }
                  })}
                >
                  <FileTile kind={h.kind} path={h.path} size={40} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography sx={{ fontWeight: 600 }} noWrap>
                        {h.title}
                      </Typography>
                      {h.loc && (
                        <Typography variant="caption" color="text.secondary" sx={{ flex: 'none' }}>
                          {h.loc}
                        </Typography>
                      )}
                      <Box sx={{ flex: 1 }} />
                      {h.label && <Chip size="small" label={h.label} variant="outlined" />}
                      <Tooltip title={tr("Meaning match {v0}%", { v0: (h.score * 100).toFixed(0) })}>
                        <Box sx={(t) => ({ width: 44, height: 6, borderRadius: 3, bgcolor: t.fs.containerHighest, overflow: 'hidden', flex: 'none' })}>
                          <Box sx={(t) => ({ width: `${Math.max(6, Math.min(100, h.score * 130))}%`, height: '100%', bgcolor: t.fs.primary, borderRadius: 3 })} />
                        </Box>
                      </Tooltip>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {h.text}
                    </Typography>
                  </Box>
                </ButtonBase>
              ))}
            </Box>
          </Box>
        )}

        <Typography variant="subtitle1" component="h2" sx={{ mt: 5, mb: 1.5, fontWeight: 600 }}>
          {tr("Sources")}
        </Typography>
        {visible.length === 0 ? (
          <Box sx={(t) => ({ textAlign: 'center', py: 6, px: 3, borderRadius: 6, border: `2px dashed ${t.fs.outlineVariant}` })}>
            <EmptyArt variant="knowledge" />
            <Typography variant="h6" sx={{ mt: 1.5 }}>
              {tr("Add your first folder")}
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 560, mx: 'auto', mt: 0.5 }}>
              {tr("PDF, Word, PowerPoint, Excel, Markdown, text, HTML, .ics calendars, .url shortcuts and browser bookmark exports. Turn on image indexing in Settings to include diagrams.")}
            </Typography>
            <Button variant="contained" startIcon={<CreateNewFolderRounded />} onClick={() => add('folder')} sx={{ mt: 2.5 }}>
              {tr("Add folder")}
            </Button>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 1.5 }}>
            {visible.map((s) => (
              <SourceCard key={s.id} s={s} labels={labels} />
            ))}
          </Box>
        )}
        <Box sx={(t) => ({ mt: 4, p: 2.5, borderRadius: 5, bgcolor: t.fs.assist, display: 'flex', gap: 2, alignItems: 'flex-start' })}>
          <FileTile kind="file" path="x.docx" size={40} />
          <Typography variant="body2" color="text.secondary">
            <b>{tr("Using Google Drive?")}</b>{' '}{tr("Add your Google Drive for desktop folder (usually G:\\My Drive) and mark folders “Available offline”. Native Google Docs, Sheets and Slides are only shortcuts on disk, so download them as .docx, .xlsx or .pptx to index their text.")}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
