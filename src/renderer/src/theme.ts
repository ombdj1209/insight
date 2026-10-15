import { alpha, createTheme, type Theme } from '@mui/material/styles'

/** Google product colours, used for speakers, file types and accents. */
export const GOOGLE = {
  blue: '#1A73E8',
  red: '#D93025',
  yellow: '#F9AB00',
  green: '#1E8E3E',
  purple: '#A142F4',
  cyan: '#12B5CB',
  pink: '#E52592',
  orange: '#E8710A'
}

const shared = {
  gemini: 'linear-gradient(74deg, #4285F4 0%, #9B72CB 48%, #D96570 100%)',
  geminiSoft: 'linear-gradient(74deg, rgba(66,133,244,.14) 0%, rgba(155,114,203,.14) 50%, rgba(217,101,112,.14) 100%)',
  speakers: [GOOGLE.purple, GOOGLE.green, GOOGLE.orange, GOOGLE.pink, GOOGLE.cyan, GOOGLE.red, GOOGLE.yellow, GOOGLE.blue],
  files: { pdf: '#EA4335', doc: '#4285F4', sheet: '#34A853', slide: '#FBBC04', image: '#A142F4', calendar: '#1A73E8', bookmark: '#F9AB00', meeting: '#12B5CB', text: '#5F6368' }
}

export const tokens = {
  light: {
    ...shared,
    window: '#F0F4F9',
    surface: '#F8FAFD',
    sheet: '#FFFFFF',
    container: '#F0F4F9',
    containerHigh: '#E9EEF6',
    containerHighest: '#DDE3EA',
    card: '#FFFFFF',
    primary: '#0B57D0',
    onPrimary: '#FFFFFF',
    primaryContainer: '#D3E3FD',
    onPrimaryContainer: '#041E49',
    secondaryContainer: '#C2E7FF',
    onSecondaryContainer: '#001D35',
    tertiaryContainer: '#C4EED0',
    onTertiaryContainer: '#072711',
    onSurface: '#1F1F1F',
    onSurfaceVariant: '#444746',
    outline: '#747775',
    outlineVariant: '#C4C7C5',
    record: '#B3261E',
    recordContainer: '#F9DEDC',
    onRecordContainer: '#410E0B',
    assist: '#EDF2FC',
    you: '#0B57D0',
    others: '#8E44EF',
    elevation: '0 1px 2px rgba(0,0,0,.08), 0 2px 6px 2px rgba(0,0,0,.05)',
    elevationHigh: '0 4px 8px 3px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.12)'
  },
  dark: {
    ...shared,
    window: '#131314',
    surface: '#131314',
    sheet: '#1B1C1D',
    container: '#1E1F20',
    containerHigh: '#282A2C',
    containerHighest: '#333537',
    card: '#1E1F20',
    primary: '#A8C7FA',
    onPrimary: '#062E6F',
    primaryContainer: '#0842A0',
    onPrimaryContainer: '#D3E3FD',
    secondaryContainer: '#004A77',
    onSecondaryContainer: '#C2E7FF',
    tertiaryContainer: '#0F5223',
    onTertiaryContainer: '#C4EED0',
    onSurface: '#E3E3E3',
    onSurfaceVariant: '#C4C7C5',
    outline: '#8E918F',
    outlineVariant: '#444746',
    record: '#F2B8B5',
    recordContainer: '#8C1D18',
    onRecordContainer: '#F9DEDC',
    assist: '#1F2A3D',
    you: '#A8C7FA',
    others: '#D7AEFB',
    elevation: '0 1px 2px rgba(0,0,0,.4), 0 2px 6px 2px rgba(0,0,0,.25)',
    elevationHigh: '0 4px 8px 3px rgba(0,0,0,.35), 0 1px 3px rgba(0,0,0,.5)'
  }
}

export type Tokens = typeof tokens.light

declare module '@mui/material/styles' {
  interface Theme {
    fs: Tokens
  }
  interface ThemeOptions {
    fs?: Tokens
  }
}

export const FONT =
  '"Google Sans Flex Variable", "Google Sans", "Segoe UI Variable Text", "Yu Gothic UI", "Meiryo UI", "Noto Sans JP", Roboto, system-ui, sans-serif'
export const MONO = '"Google Sans Code Variable", "Cascadia Mono", Consolas, monospace'

/** Stable colour for a speaker so the same voice keeps its colour everywhere. */
export function speakerColor(t: Tokens, key: string, channel: 'mic' | 'system'): string {
  if (channel === 'mic' && !/^S\d+$/.test(key)) return t.you
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const n = Number(key.match(/^S(\d+)$/)?.[1])
  return t.speakers[(Number.isFinite(n) && n > 0 ? n - 1 : h) % t.speakers.length]
}

export function buildTheme(mode: 'light' | 'dark'): Theme {
  const t = tokens[mode]
  return createTheme({
    fs: t,
    palette: {
      mode,
      primary: { main: t.primary, contrastText: t.onPrimary },
      success: { main: mode === 'light' ? '#146C2E' : '#6DD58C' },
      warning: { main: mode === 'light' ? '#8C5000' : '#FFB95C' },
      error: { main: mode === 'light' ? '#B3261E' : '#F2B8B5' },
      background: { default: t.window, paper: t.card },
      text: { primary: t.onSurface, secondary: t.onSurfaceVariant },
      divider: t.outlineVariant
    },
    shape: { borderRadius: 4 }, // sx borderRadius numbers are multiples of 4px
    typography: {
      fontFamily: FONT,
      fontSize: 14,
      h3: { fontSize: 44, fontWeight: 450, letterSpacing: -0.5, lineHeight: 1.15 },
      h4: { fontSize: 30, fontWeight: 450, letterSpacing: -0.2, lineHeight: 1.25 },
      h5: { fontSize: 22, fontWeight: 500, lineHeight: 1.3 },
      h6: { fontSize: 16, fontWeight: 600, letterSpacing: 0.1 },
      subtitle1: { fontSize: 16, fontWeight: 500 },
      subtitle2: { fontSize: 14, fontWeight: 600, letterSpacing: 0.1 },
      body1: { fontSize: 15, lineHeight: 1.6 },
      body2: { fontSize: 14, lineHeight: 1.5 },
      caption: { fontSize: 12, letterSpacing: 0.2 },
      overline: { fontSize: 12, fontWeight: 600, letterSpacing: 0.4, textTransform: 'none' },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0.1, fontSize: 14 }
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { background: t.window, overflow: 'hidden', fontVariationSettings: "'ROND' 25" },
          '::selection': { background: alpha(t.primary, 0.25) },
          // mixed-direction text (English notes in an Arabic UI, Hebrew transcripts in an English one): each paragraph
          // takes its direction from its own first letter, like dir="auto"
          'p, li, h1, h2, h3, h4, h5, h6, textarea, input, .MuiTypography-root': { unicodeBidi: 'plaintext' },
          '.drag': { WebkitAppRegion: 'drag', userSelect: 'none' },
          '.drag button, .drag input, .drag [role=button], .no-drag': { WebkitAppRegion: 'no-drag' },
          '*::-webkit-scrollbar': { width: 12, height: 12 },
          '*::-webkit-scrollbar-thumb': { background: t.outlineVariant, borderRadius: 8, border: `3px solid transparent`, backgroundClip: 'padding-box' },
          '*::-webkit-scrollbar-thumb:hover': { background: t.outline, backgroundClip: 'padding-box' },
          '@keyframes fsFadeIn': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
          '@keyframes fsShimmer': { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
          '@keyframes fsPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
          '@keyframes fsSpin': { to: { transform: 'rotate(360deg)' } },
          '@media (prefers-reduced-motion: reduce)': { '*, *::before, *::after': { animation: 'none !important', transition: 'none !important' } }
        }
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 100, paddingInline: 22, minHeight: 40 },
          outlined: { borderColor: t.outline, color: t.primary },
          text: { paddingInline: 14 }
        },
        variants: [
          {
            props: { variant: 'contained', color: 'inherit' },
            style: { background: t.secondaryContainer, color: t.onSecondaryContainer, '&:hover': { background: alpha(t.secondaryContainer, 0.85) } }
          }
        ]
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 100 } } },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 500, height: 32 },
          outlined: { borderColor: t.outlineVariant },
          sizeSmall: { height: 24 }
        }
      },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiMenu: { styleOverrides: { paper: { borderRadius: 12, background: t.containerHigh, boxShadow: t.elevationHigh, minWidth: 200 } } },
      MuiMenuItem: { styleOverrides: { root: { minHeight: 44, fontSize: 14 } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 48, fontSize: 14 } } },
      MuiTabs: { styleOverrides: { indicator: { height: 3, borderRadius: '3px 3px 0 0' } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 12, background: t.sheet },
          notchedOutline: { borderColor: t.outlineVariant }
        }
      },
      MuiSelect: { styleOverrides: { select: { paddingTop: 9, paddingBottom: 9 } } },
      MuiSwitch: {
        styleOverrides: {
          root: { width: 64, height: 40, padding: 6 },
          switchBase: { padding: 10, '&.Mui-checked': { transform: 'translateX(24px)', color: t.onPrimary } },
          thumb: { width: 20, height: 20, boxShadow: 'none' },
          track: { borderRadius: 16, opacity: '1 !important', background: t.containerHighest, border: `2px solid ${t.outline}` }
        }
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            borderColor: t.outline,
            color: t.onSurface,
            paddingInline: 16,
            height: 40,
            '&.Mui-selected': { background: t.secondaryContainer, color: t.onSecondaryContainer, '&:hover': { background: t.secondaryContainer } }
          }
        }
      },
      MuiToggleButtonGroup: { styleOverrides: { root: { borderRadius: 100, '& .MuiToggleButton-root:first-of-type': { borderRadius: '100px 0 0 100px' }, '& .MuiToggleButton-root:last-of-type': { borderRadius: '0 100px 100px 0' } } } },
      MuiTooltip: { styleOverrides: { tooltip: { fontSize: 12, borderRadius: 6, background: mode === 'light' ? '#303030' : '#E3E3E3', color: mode === 'light' ? '#F2F2F2' : '#303030' } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 4, height: 6, background: t.containerHighest } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 28, background: t.containerHigh, boxShadow: t.elevationHigh } } },
      MuiSnackbarContent: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiSlider: { styleOverrides: { thumb: { width: 4, height: 32, borderRadius: 2 }, track: { height: 12, border: 'none' }, rail: { height: 12, opacity: 1, background: t.secondaryContainer } } }
    }
  })
}
