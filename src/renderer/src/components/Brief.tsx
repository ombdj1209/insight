import { t as tr } from '../i18n'
import { useEffect, useState } from 'react'
import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, Typography } from '@mui/material'
import AutorenewRounded from '@mui/icons-material/AutorenewRounded'
import MicRounded from '@mui/icons-material/MicRounded'
import type { CalEvent } from '../../../shared/google'
import type { Brief } from '../../../shared/types'
import type { AppCtx } from '../App'
import { api, cleanError } from '../api'
import { CitationList } from './Citations'
import { Markdown } from './Markdown'
import { Sparkle } from './ui'
import { joinAndListen } from './Upcoming'

export const briefKeyOf = (e: Pick<CalEvent, 'id' | 'start'>): string => `${e.id}@${e.start}`

/** Pre-meeting brief: loads the saved one, or writes it now. */
export function BriefDialog({ ctx, event, onClose }: { ctx: AppCtx; event: CalEvent | null; onClose: () => void }) {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const make = async (fresh: boolean): Promise<void> => {
    if (!event) return
    setError('')
    if (!fresh) {
      const saved = await api.briefGet(briefKeyOf(event))
      if (saved) return setBrief(saved)
    }
    setBusy(true)
    try {
      setBrief(await api.briefGenerate(event))
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    setBrief(null)
    if (event) void make(false)
  }, [event?.id, event?.start]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!event) return null
  const others = (event.people ?? []).filter((p) => !p.self)
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogContent sx={{ pt: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Sparkle size={26} spinning={busy} />
          <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 1.2 }}>
            {tr("Pre-meeting brief")}
          </Typography>
        </Box>
        <Typography variant="h5" sx={{ mt: 0.5 }}>
          {event.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {new Date(event.start).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Typography>
        {others.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.25 }}>
            {others.slice(0, 10).map((p) => (
              <Chip key={p.email} size="small" label={p.name || p.email} title={p.email} />
            ))}
          </Box>
        )}
        <Box sx={{ mt: 2.5, minHeight: 120 }}>
          {busy && !brief && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: 'text.secondary' }}>
              <CircularProgress size={18} />{' '}{tr("Reading your notes, files and email…")}
            </Box>
          )}
          {error && <Typography color="error">{error}</Typography>}
          {brief && (
            <>
              <Markdown text={brief.md} citations={brief.citations} />
              {brief.citations.length > 0 && (
                <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 1 }}>
                  <CitationList citations={brief.citations} dense />
                </Box>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                {tr("Written")}{' '}{new Date(brief.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{tr(". Check important details against the sources.")}
              </Typography>
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button startIcon={<AutorenewRounded />} disabled={busy} onClick={() => void make(true)}>
          {brief ? tr("Rewrite") : tr("Write brief")}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{tr("Close")}</Button>
        <Button
          variant="contained"
          startIcon={<MicRounded />}
          onClick={() => {
            onClose()
            void joinAndListen(ctx, event)
          }}
        >
          {event.joinUrl ? tr("Join + take notes") : tr("Take notes")}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
