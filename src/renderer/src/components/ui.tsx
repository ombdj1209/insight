import { t as tr } from '../i18n'
import type { ReactNode } from 'react'
import { Box, ToggleButton, ToggleButtonGroup, Typography, type SxProps, type Theme } from '@mui/material'
import PictureAsPdfRounded from '@mui/icons-material/PictureAsPdfRounded'
import ArticleRounded from '@mui/icons-material/ArticleRounded'
import TableChartRounded from '@mui/icons-material/TableChartRounded'
import SlideshowRounded from '@mui/icons-material/SlideshowRounded'
import ImageRounded from '@mui/icons-material/ImageRounded'
import EventRounded from '@mui/icons-material/EventRounded'
import BookmarkRounded from '@mui/icons-material/BookmarkRounded'
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded'
import DescriptionRounded from '@mui/icons-material/DescriptionRounded'
import FolderRounded from '@mui/icons-material/FolderRounded'
import type { ChunkKind } from '../../../shared/types'
import { speakerColor } from '../theme'

/** Gemini-style gradient text. */
export function GeminiText({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Box
      component="span"
      sx={[
        (t) => ({ background: t.fs.gemini, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : [])
      ]}
    >
      {children}
    </Box>
  )
}

/** Four-point sparkle filled with the Gemini gradient: marks anything written by AI. */
export function Sparkle({ size = 20, spinning = false }: { size?: number; spinning?: boolean }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', flex: 'none', animation: spinning ? 'fsSpin 2.4s linear infinite' : 'none' }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <defs>
          <linearGradient id="fs-sparkle" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#4285F4" />
            <stop offset="0.5" stopColor="#9B72CB" />
            <stop offset="1" stopColor="#D96570" />
          </linearGradient>
        </defs>
        <path d="M12 2c.6 5.3 4.7 9.4 10 10-5.3.6-9.4 4.7-10 10-.6-5.3-4.7-9.4-10-10 5.3-.6 9.4-4.7 10-10Z" fill="url(#fs-sparkle)" />
      </svg>
    </Box>
  )
}

export function SpeakerAvatar({ name, id, channel, size = 32 }: { name: string; id?: string; channel: 'mic' | 'system'; size?: number }) {
  const initials = name.match(/^Speaker (\d+)$/)?.[1] ?? [...name.trim()].slice(0, /[\u3040-\u9fff]/.test(name) ? 1 : 2).join('').toUpperCase()
  return (
    <Box
      aria-hidden
      sx={(t) => ({
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
        color: '#fff',
        bgcolor: speakerColor(t.fs, id ?? name, channel)
      })}
    >
      {initials || '?'}
    </Box>
  )
}

/** Loading lines while the model starts writing. */
export function Shimmer({ lines = 4 }: { lines?: number }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, py: 0.5 }} aria-label={tr("Writing")}>
      {Array.from({ length: lines }, (_, i) => (
        <Box
          key={i}
          sx={(t) => ({
            height: 14,
            width: `${[92, 100, 78, 86, 64][i % 5]}%`,
            borderRadius: 7,
            background: `linear-gradient(90deg, ${t.fs.containerHigh} 0px, ${t.palette.mode === 'light' ? '#C8D7F5' : '#3A4A6A'} 160px, ${t.fs.containerHigh} 320px)`,
            backgroundSize: '800px 100%',
            animation: 'fsShimmer 1.4s linear infinite'
          })}
        />
      ))}
    </Box>
  )
}

type FileType = keyof ReturnType<typeof fileColorsOf>
const fileColorsOf = (t: Theme) => t.fs.files

export function fileTypeOf(kind: ChunkKind | 'folder', path?: string): FileType {
  if (kind === 'meeting') return 'meeting'
  if (kind === 'calendar') return 'calendar'
  if (kind === 'bookmark') return 'bookmark'
  if (kind === 'image') return 'image'
  const ext = path?.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx', 'md', 'markdown', 'txt', 'rst'].includes(ext)) return 'doc'
  if (['xls', 'xlsx', 'ods', 'csv', 'tsv'].includes(ext)) return 'sheet'
  if (['ppt', 'pptx'].includes(ext)) return 'slide'
  if (['ics'].includes(ext)) return 'calendar'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image'
  if (['html', 'htm', 'url'].includes(ext)) return 'bookmark'
  return 'text'
}

const ICONS: Record<FileType, ReactNode> = {
  pdf: <PictureAsPdfRounded fontSize="inherit" />,
  doc: <ArticleRounded fontSize="inherit" />,
  sheet: <TableChartRounded fontSize="inherit" />,
  slide: <SlideshowRounded fontSize="inherit" />,
  image: <ImageRounded fontSize="inherit" />,
  calendar: <EventRounded fontSize="inherit" />,
  bookmark: <BookmarkRounded fontSize="inherit" />,
  meeting: <GraphicEqRounded fontSize="inherit" />,
  text: <DescriptionRounded fontSize="inherit" />
}

/** Drive-style coloured file icon tile. */
export function FileTile({ kind, path, size = 36, folder }: { kind: ChunkKind; path?: string; size?: number; folder?: boolean }) {
  const type = fileTypeOf(kind, path)
  return (
    <Box
      sx={(t) => {
        const c = folder ? t.fs.files.text : t.fs.files[type]
        return {
          width: size,
          height: size,
          flex: 'none',
          borderRadius: size > 30 ? 2.5 : 1.5,
          display: 'grid',
          placeItems: 'center',
          fontSize: size * 0.58,
          color: c,
          bgcolor: `${c}1F`
        }
      }}
    >
      {folder ? <FolderRounded fontSize="inherit" /> : ICONS[type]}
    </Box>
  )
}

/** Material 3 segmented button. */
export function Segmented<T extends string>({ value, options, onChange, size }: { value: T; options: [T, string][]; onChange: (v: T) => void; size?: 'small' }) {
  return (
    <ToggleButtonGroup exclusive value={value} onChange={(_e, v: T | null) => v && onChange(v)} size={size}>
      {options.map(([v, l]) => (
        <ToggleButton key={v} value={v} sx={size ? { height: 34, px: 1.5 } : undefined}>
          {tr(l)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

/** Fade-through used for page changes. */
export function PageFade({ children }: { children: ReactNode }) {
  return <Box sx={{ height: '100%', animation: 'fsFadeIn 220ms cubic-bezier(.2,0,0,1)' }}>{children}</Box>
}

/** Friendly empty-state illustration built from Google colours. */
export function EmptyArt({ variant = 'meetings', size = 168 }: { variant?: 'meetings' | 'knowledge' | 'chat'; size?: number }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 240 172" aria-hidden>
      <rect x="18" y="26" width="204" height="128" rx="28" fill="#4285F4" opacity=".12" />
      {variant === 'knowledge' ? (
        <>
          <rect x="52" y="52" width="58" height="76" rx="10" fill="#EA4335" opacity=".85" />
          <rect x="92" y="44" width="58" height="76" rx="10" fill="#4285F4" />
          <rect x="132" y="56" width="58" height="76" rx="10" fill="#34A853" opacity=".9" />
          <rect x="104" y="62" width="34" height="5" rx="2.5" fill="#fff" />
          <rect x="104" y="74" width="26" height="5" rx="2.5" fill="#fff" opacity=".8" />
          <circle cx="178" cy="44" r="12" fill="#FBBC04" />
        </>
      ) : variant === 'chat' ? (
        <>
          <rect x="44" y="50" width="104" height="40" rx="20" fill="#4285F4" />
          <rect x="92" y="100" width="104" height="40" rx="20" fill="#34A853" opacity=".9" />
          <circle cx="66" cy="70" r="5" fill="#fff" />
          <circle cx="84" cy="70" r="5" fill="#fff" />
          <circle cx="102" cy="70" r="5" fill="#fff" />
          <path d="M190 40c.8 7 6 12.2 13 13-7 .8-12.2 6-13 13-.8-7-6-12.2-13-13 7-.8 12.2-6 13-13Z" fill="#FBBC04" />
        </>
      ) : (
        <>
          {[40, 66, 92, 118, 144, 170, 196].map((x, i) => (
            <rect key={x} x={x} y={90 - [18, 34, 52, 26, 44, 30, 14][i]} width="14" height={[18, 34, 52, 26, 44, 30, 14][i] * 2} rx="7" fill={['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#4285F4', '#A142F4', '#12B5CB'][i]} />
          ))}
        </>
      )}
    </svg>
  )
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
        {children}
      </Typography>
      {action}
    </Box>
  )
}
