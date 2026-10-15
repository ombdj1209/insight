import { t as tr } from '../i18n'
import { useEffect, useState } from 'react'
import { Box, ButtonBase, CircularProgress, Dialog, DialogContent, IconButton, Tooltip, Typography } from '@mui/material'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import SlideshowOutlined from '@mui/icons-material/SlideshowOutlined'
import type { Slide } from '../../../shared/types'
import { api, fmtTime } from '../api'

function Thumb({ meetingId, s, onOpen, onDelete }: { meetingId: string; s: Slide; onOpen: (src: string) => void; onDelete: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => void api.slideImage(meetingId, s.id).then(setSrc), [meetingId, s.id])
  return (
    <Box sx={(t) => ({ borderRadius: 4, overflow: 'hidden', bgcolor: t.fs.container, display: 'flex', flexDirection: 'column' })}>
      <ButtonBase onClick={() => src && onOpen(src)} sx={{ aspectRatio: '16 / 9', bgcolor: '#000', display: 'grid', placeItems: 'center' }} aria-label={tr("Open slide at {v0}", { v0: fmtTime(s.atMs) })}>
        {src ? <Box component="img" src={src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <CircularProgress size={20} />}
      </ButtonBase>
      <Box sx={{ p: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main' }}>
            {fmtTime(s.atMs)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} dir="auto">
            {s.status === 'reading' ? tr("Reading the slide…") : s.text}
          </Typography>
        </Box>
        <Tooltip title={tr("Remove slide")}>
          <IconButton size="small" onClick={onDelete} aria-label={tr("Remove slide")}>
            <DeleteOutlineRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}

export function SlidesTab({ meetingId, slides, onChange }: { meetingId: string; slides: Slide[]; onChange: (s: Slide[]) => void }) {
  const [big, setBig] = useState<string | null>(null)
  if (!slides.length)
    return (
      <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
        <SlideshowOutlined sx={{ fontSize: 40, opacity: 0.6 }} />
        <Typography sx={{ mt: 1, maxWidth: 460, mx: 'auto' }}>{tr("No slides yet. Turn on slide capture in Settings and Insight saves each new slide or shared document while it listens, so you can search and ask about them.")}</Typography>
      </Box>
    )
  return (
    <Box sx={{ px: 4, py: 3 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }}>
        {slides.map((s) => (
          <Thumb key={s.id} meetingId={meetingId} s={s} onOpen={setBig} onDelete={() => void api.deleteSlide(meetingId, s.id).then(onChange)} />
        ))}
      </Box>
      <Dialog open={!!big} onClose={() => setBig(null)} maxWidth="xl">
        <DialogContent sx={{ p: 0, bgcolor: '#000' }}>{big && <Box component="img" src={big} alt="Slide" sx={{ display: 'block', maxWidth: '90vw', maxHeight: '85vh' }} />}</DialogContent>
      </Dialog>
    </Box>
  )
}
