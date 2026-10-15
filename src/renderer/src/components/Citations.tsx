import { Box, ButtonBase, Typography } from '@mui/material'
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import EventOutlined from '@mui/icons-material/EventOutlined'
import ImageOutlined from '@mui/icons-material/ImageOutlined'
import BookmarkBorder from '@mui/icons-material/BookmarkBorder'
import GraphicEqOutlined from '@mui/icons-material/GraphicEqOutlined'
import PsychologyOutlined from '@mui/icons-material/PsychologyOutlined'
import type { ChunkKind, Citation } from '../../../shared/types'
import { api } from '../api'
import { FileTile } from './ui'

export const kindIcon = (k: ChunkKind) =>
  ({
    file: <DescriptionOutlined fontSize="small" />,
    image: <ImageOutlined fontSize="small" />,
    calendar: <EventOutlined fontSize="small" />,
    bookmark: <BookmarkBorder fontSize="small" />,
    meeting: <GraphicEqOutlined fontSize="small" />,
    memory: <PsychologyOutlined fontSize="small" />
  })[k]

export function openCitation(c: { path?: string; text?: string; snippet?: string; kind: ChunkKind }): void {
  if (!c.path) return
  if (c.kind === 'bookmark') {
    const url = (c.text ?? c.snippet ?? '').match(/https?:\/\/\S+/)?.[0]
    if (url) window.open(url)
    return
  }
  void api.open(c.path)
}

export function CitationList({ citations, dense, highlight }: { citations: Citation[]; dense?: boolean; highlight?: number | null }) {
  if (!citations.length) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {citations.map((c) => (
        <ButtonBase
          key={c.chunkId + c.n}
          onClick={() => openCitation(c)}
          disabled={!c.path}
          sx={(t) => ({
            display: 'flex',
            alignItems: 'flex-start',
            textAlign: 'start',
            gap: 1.25,
            p: dense ? 1 : 1.5,
            borderRadius: 4,
            border: `1px solid ${highlight === c.n ? t.fs.primary : t.fs.outlineVariant}`,
            boxShadow: highlight === c.n ? `0 0 0 1px ${t.fs.primary}` : 'none',
            bgcolor: t.fs.sheet,
            transition: 'background 150ms, border-color 150ms',
            width: '100%',
            '&:hover': { bgcolor: t.fs.container }
          })}
        >
          <Box sx={{ position: 'relative', flex: 'none' }}>
            <FileTile kind={c.kind} path={c.path} size={dense ? 32 : 36} />
            <Box
              sx={(t) => ({
                position: 'absolute',
                right: -5,
                bottom: -5,
                minWidth: 18,
                height: 18,
                px: 0.4,
                borderRadius: '9px',
                fontSize: 11,
                fontWeight: 700,
                display: 'grid',
                placeItems: 'center',
                bgcolor: t.fs.primary,
                color: t.fs.onPrimary,
                border: `2px solid ${t.fs.sheet}`
              })}
            >
              {c.n}
            </Box>
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
              <Typography variant="subtitle2" noWrap sx={{ color: 'text.primary' }}>
                {c.title}
              </Typography>
              {c.loc && (
                <Typography variant="caption" noWrap sx={{ flex: 'none' }}>
                  {c.loc}
                </Typography>
              )}
            </Box>
            <Typography
              variant="body2"
              sx={{ color: 'text.secondary', mt: 0.5, display: '-webkit-box', WebkitLineClamp: dense ? 3 : 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {c.snippet.trim()}
            </Typography>
          </Box>
        </ButtonBase>
      ))}
    </Box>
  )
}
