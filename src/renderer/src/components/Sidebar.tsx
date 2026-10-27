import { t as tr } from '../i18n'
import type { ReactElement } from 'react'
import { Box, ButtonBase, Tooltip, Typography } from '@mui/material'
import MicRounded from '@mui/icons-material/MicRounded'
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded'
import HomeRounded from '@mui/icons-material/HomeRounded'
import HomeOutlined from '@mui/icons-material/HomeOutlined'
import FolderCopyRounded from '@mui/icons-material/FolderCopyRounded'
import FolderCopyOutlined from '@mui/icons-material/FolderCopyOutlined'
import ForumRounded from '@mui/icons-material/ForumRounded'
import ForumOutlined from '@mui/icons-material/ForumOutlined'
import SettingsRounded from '@mui/icons-material/SettingsRounded'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import DownloadingRounded from '@mui/icons-material/DownloadingRounded'
import PetsRounded from '@mui/icons-material/PetsRounded'
import GroupsRounded from '@mui/icons-material/GroupsRounded'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import PetsOutlined from '@mui/icons-material/PetsOutlined'
import Diversity3Rounded from '@mui/icons-material/Diversity3Rounded'
import Diversity3Outlined from '@mui/icons-material/Diversity3Outlined'
import type { MeetingSummary, RuntimeStatus } from '../../../shared/types'
import type { Route } from '../App'

const NAV: { page: Exclude<Route['page'], 'meeting'>; label: string; icon: ReactElement; active: ReactElement }[] = [
  { page: 'home', label: 'Meetings', icon: <HomeOutlined />, active: <HomeRounded /> },
  { page: 'knowledge', label: 'Knowledge', icon: <FolderCopyOutlined />, active: <FolderCopyRounded /> },
  { page: 'chat', label: 'Ask', icon: <ForumOutlined />, active: <ForumRounded /> },
  { page: 'people', label: 'People', icon: <GroupsOutlined />, active: <GroupsRounded /> },
  { page: 'team', label: 'Team', icon: <Diversity3Outlined />, active: <Diversity3Rounded /> },
  { page: 'pet', label: 'Pet', icon: <PetsOutlined />, active: <PetsRounded /> },
  { page: 'settings', label: 'Settings', icon: <SettingsOutlined />, active: <SettingsRounded /> }
]

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="fsg" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="0.5" stopColor="#9B72CB" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#fsg)" />
      <path d="M16 7.5c.6 4.6 3.9 7.9 8.5 8.5-4.6.6-7.9 3.9-8.5 8.5-.6-4.6-3.9-7.9-8.5-8.5 4.6-.6 7.9-3.9 8.5-8.5Z" fill="#fff" />
    </svg>
  )
}

function status(rt: RuntimeStatus, setupNeeded: boolean): { text: string; color: string; busy: boolean } {
  if (setupNeeded) return { text: tr("Finish setup"), color: '#B26A00', busy: false }
  if (rt.llm === 'starting' || rt.embedder === 'starting') return { text: tr("Loading models"), color: '#B26A00', busy: true }
  if (rt.llm === 'error' || rt.embedder === 'error') return { text: tr("Model server stopped"), color: '#D93025', busy: false }
  if (rt.embedder !== 'ready') return { text: tr("Models not loaded"), color: '#80868B', busy: false }
  return { text: rt.llm === 'cloud' ? tr("Ready · cloud AI") : tr("Ready · on device"), color: '#1E8E3E', busy: false }
}

export function Sidebar(props: {
  route: Route
  go: (r: Route) => void
  meetings: MeetingSummary[]
  recordingId: string | null
  runtime: RuntimeStatus
  setupNeeded: boolean
  collapsed: boolean
  onStart: () => void
}) {
  const { route, go, meetings, recordingId, collapsed } = props
  const st = status(props.runtime, props.setupNeeded)
  const listening = !!recordingId
  return (
    <Box
      component="nav"
      aria-label={tr("Main")}
      sx={{
        width: collapsed ? 88 : 264,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        transition: 'width 250ms cubic-bezier(.2,0,0,1)',
        overflow: 'hidden'
      }}
    >
      {/* Extended FAB */}
      <Box sx={{ px: collapsed ? 1.5 : 1.5, pt: 1, pb: 2, display: 'flex', justifyContent: collapsed ? 'center' : 'flex-start' }}>
        <Tooltip title={collapsed ? (listening ? tr("Open live meeting") : tr("Start listening (Ctrl+Shift+Space)")) : ''} placement="right">
          <ButtonBase
            onClick={() => (listening ? go({ page: 'meeting', meetingId: recordingId! }) : props.onStart())}
            sx={(t) => ({
              height: 56,
              minWidth: 56,
              px: collapsed ? 0 : 2.5,
              gap: 1.5,
              borderRadius: 4,
              justifyContent: collapsed ? 'center' : 'flex-start',
              fontSize: 15,
              fontWeight: 600,
              bgcolor: listening ? t.fs.recordContainer : t.fs.primaryContainer,
              color: listening ? t.fs.onRecordContainer : t.fs.onPrimaryContainer,
              boxShadow: t.fs.elevation,
              transition: 'box-shadow 150ms',
              '&:hover': { boxShadow: t.fs.elevationHigh },
              '&:focus-visible': { outline: `3px solid ${t.fs.primary}`, outlineOffset: 2 }
            })}
          >
            {listening ? <GraphicEqRounded sx={{ animation: 'fsPulse 1.4s ease-in-out infinite' }} /> : <MicRounded />}
            {!collapsed && (listening ? tr("Listening") : tr("Start listening"))}
          </ButtonBase>
        </Tooltip>
      </Box>

      <Box sx={{ px: 1.5, display: 'flex', flexDirection: 'column', gap: collapsed ? 1 : 0.25 }}>
        {NAV.map((n) => {
          const active = route.page === n.page || (n.page === 'home' && route.page === 'meeting')
          return collapsed ? (
            <ButtonBase
              key={n.page}
              onClick={() => go({ page: n.page })}
              aria-label={tr(n.label)}
              aria-current={active ? 'page' : undefined}
              sx={(t) => ({ flexDirection: 'column', gap: 0.5, py: 0.5, borderRadius: 2, color: active ? t.fs.onSurface : t.fs.onSurfaceVariant })}
            >
              <Box
                sx={(t) => ({
                  width: 56,
                  height: 32,
                  borderRadius: 16,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: active ? t.fs.secondaryContainer : 'transparent',
                  color: active ? t.fs.onSecondaryContainer : 'inherit',
                  transition: 'background 200ms'
                })}
              >
                {active ? n.active : n.icon}
              </Box>
              <Typography sx={{ fontSize: 12, fontWeight: active ? 700 : 500 }}>{tr(n.label)}</Typography>
            </ButtonBase>
          ) : (
            <ButtonBase
              key={n.page}
              onClick={() => go({ page: n.page })}
              aria-current={active ? 'page' : undefined}
              sx={(t) => ({
                height: 48,
                borderRadius: 24,
                justifyContent: 'flex-start',
                gap: 1.75,
                px: 2,
                fontSize: 14,
                fontWeight: active ? 700 : 500,
                bgcolor: active ? t.fs.secondaryContainer : 'transparent',
                color: active ? t.fs.onSecondaryContainer : t.fs.onSurfaceVariant,
                '&:hover': { bgcolor: active ? t.fs.secondaryContainer : t.fs.containerHigh }
              })}
            >
              {active ? n.active : n.icon}
              {tr(n.label)}
            </ButtonBase>
          )
        })}
      </Box>

      {!collapsed && (
        <>
          <Typography sx={{ px: 3.5, pt: 3, pb: 1, color: 'text.secondary', fontSize: 13, fontWeight: 600 }}>{tr("Recent meetings")}</Typography>
          <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5 }}>
            {meetings.slice(0, 40).map((m) => {
              const active = route.page === 'meeting' && route.meetingId === m.id
              const live = recordingId === m.id
              return (
                <ButtonBase
                  key={m.id}
                  onClick={() => go({ page: 'meeting', meetingId: m.id })}
                  sx={(t) => ({
                    width: '100%',
                    height: 40,
                    borderRadius: 20,
                    justifyContent: 'flex-start',
                    px: 2,
                    gap: 1.25,
                    bgcolor: active ? t.fs.containerHighest : 'transparent',
                    '&:hover': { bgcolor: t.fs.containerHigh }
                  })}
                >
                  {live && <Box sx={(t) => ({ width: 8, height: 8, borderRadius: 4, bgcolor: t.fs.record, flex: 'none', animation: 'fsPulse 1.4s infinite' })} />}
                  <Typography variant="body2" noWrap sx={{ fontWeight: active ? 600 : 400 }}>
                    {m.title}
                  </Typography>
                </ButtonBase>
              )
            })}
          </Box>
        </>
      )}
      {collapsed && <Box sx={{ flex: 1 }} />}

      <Box sx={{ p: 1.5 }}>
        <Tooltip title={props.runtime.message ?? st.text} placement="right">
          <ButtonBase
            onClick={() => go({ page: props.setupNeeded ? 'setup' : 'settings' })}
            sx={(t) => ({
              width: '100%',
              borderRadius: 3,
              px: collapsed ? 0 : 1.75,
              py: 1.25,
              gap: 1.25,
              justifyContent: collapsed ? 'center' : 'flex-start',
              '&:hover': { bgcolor: t.fs.containerHigh }
            })}
          >
            {props.setupNeeded ? (
              <DownloadingRounded sx={{ fontSize: 20, color: st.color }} />
            ) : (
              <Box sx={{ width: 10, height: 10, borderRadius: 5, bgcolor: st.color, boxShadow: `0 0 0 4px ${st.color}22`, animation: st.busy ? 'fsPulse 1.2s infinite' : 'none' }} />
            )}
            {!collapsed && (
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                {st.text}
              </Typography>
            )}
          </ButtonBase>
        </Tooltip>
      </Box>
    </Box>
  )
}
