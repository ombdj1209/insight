import { t as tr } from '../i18n'
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material'
import MenuRounded from '@mui/icons-material/MenuRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import { Logo } from './Sidebar'

export function TitleBar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  return (
    <Box className="drag" sx={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', pl: 1.5, pr: '150px', gap: 1 }}>
      <Tooltip title={tr("Main menu")}>
        <IconButton onClick={onMenu} aria-label={tr("Toggle navigation")} sx={{ width: 48, height: 48 }}>
          <MenuRounded />
        </IconButton>
      </Tooltip>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: 196 }}>
        <Logo size={26} />
        <Typography sx={{ fontSize: 20, fontWeight: 500, letterSpacing: -0.2, fontVariationSettings: "'ROND' 60" }}>{tr("Insight")}</Typography>
      </Box>
      <ButtonBase
        onClick={onSearch}
        aria-label={tr("Search meetings and files (Ctrl+K)")}
        sx={(t) => ({
          flex: 1,
          maxWidth: 720,
          height: 44,
          borderRadius: 22,
          justifyContent: 'flex-start',
          gap: 1.5,
          px: 2,
          bgcolor: t.fs.containerHigh,
          color: t.fs.onSurfaceVariant,
          transition: 'background 150ms, box-shadow 150ms',
          '&:hover': { bgcolor: t.fs.sheet, boxShadow: t.fs.elevation }
        })}
      >
        <SearchRounded />
        <Typography sx={{ flex: 1, textAlign: 'start', fontSize: 15 }}>{tr("Search meetings, files and actions")}</Typography>
        <Box sx={(t) => ({ fontSize: 12, fontWeight: 600, px: 1, py: 0.25, borderRadius: 1, border: `1px solid ${t.fs.outlineVariant}` })}>{tr("Ctrl K")}</Box>
      </ButtonBase>
    </Box>
  )
}
