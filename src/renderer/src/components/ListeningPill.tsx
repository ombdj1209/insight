import { t as tr } from '../i18n'
import { useEffect, useState } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import PauseRounded from '@mui/icons-material/PauseRounded'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import StopRounded from '@mui/icons-material/StopRounded'
import { recorder, type RecorderState } from '../audio/recorder'
import { fmtTime } from '../api'

export function useRecorder(): RecorderState {
  const [s, setS] = useState(recorder.state)
  useEffect(() => recorder.subscribe(setS), [])
  return s
}

/** Two stacked level meters: top row is you (mic), bottom row is others (system audio). */
function Levels({ mic, system, paused }: { mic: number; system: number; paused: boolean }) {
  const bars = 7
  const row = (level: number, color: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', height: 12 }}>
      {Array.from({ length: bars }, (_, i) => {
        const centre = 1 - Math.abs(i - (bars - 1) / 2) / bars
        const h = paused ? 2 : Math.max(2, Math.min(12, level * 26 * centre + 2))
        return <Box key={i} sx={{ width: 3, height: h, borderRadius: 2, bgcolor: color, transition: 'height 80ms linear' }} />
      })}
    </Box>
  )
  return (
    <Box sx={(t) => ({ display: 'flex', flexDirection: 'column', gap: '1px' })}>
      {row(mic, 'var(--you)')}
      {row(system, 'var(--others)')}
    </Box>
  )
}

export function ListeningPill({ onStop }: { onStop: () => void }) {
  const s = useRecorder()
  if (!s.recording) return null
  return (
    <Box
      sx={(t) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        pl: 2,
        pr: 0.5,
        height: 44,
        borderRadius: 22,
        bgcolor: t.fs.recordContainer,
        color: t.fs.onSurface,
        '--you': t.fs.you,
        '--others': t.fs.others
      })}
    >
      <Box
        sx={(t) => ({
          width: 8,
          height: 8,
          borderRadius: 4,
          bgcolor: t.fs.record,
          animation: s.paused ? 'none' : 'fsPulse 1.6s ease-in-out infinite',
          '@keyframes fsPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } }
        })}
      />
      <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 44 }}>
        {s.paused ? tr("Paused") : fmtTime(s.elapsedMs)}
      </Typography>
      <Tooltip title={s.systemAudio ? tr("Blue: you · Purple: others (system audio)") : tr("Microphone only")}>
        <span>
          <Levels mic={s.levels.mic} system={s.levels.system} paused={s.paused} />
        </span>
      </Tooltip>
      <Tooltip title={s.paused ? tr("Resume") : tr("Pause")}>
        <IconButton size="small" onClick={() => (s.paused ? recorder.resume() : recorder.pause())} aria-label={s.paused ? tr("Resume") : tr("Pause")}>
          {s.paused ? <PlayArrowRounded /> : <PauseRounded />}
        </IconButton>
      </Tooltip>
      <Tooltip title={tr("Stop listening")}>
        <IconButton size="small" onClick={onStop} aria-label={tr("Stop listening")} sx={(t) => ({ bgcolor: t.fs.record, color: '#fff', '&:hover': { bgcolor: t.fs.record, opacity: 0.9 } })}>
          <StopRounded fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
