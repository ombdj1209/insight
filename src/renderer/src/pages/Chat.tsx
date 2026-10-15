import { t as tr } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { Box, Button, ButtonBase, Chip, IconButton, InputBase, Typography } from '@mui/material'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import TaskAltRounded from '@mui/icons-material/TaskAltRounded'
import EventNoteRounded from '@mui/icons-material/EventNoteRounded'
import RequestQuoteRounded from '@mui/icons-material/RequestQuoteRounded'
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded'
import DeleteSweepOutlined from '@mui/icons-material/DeleteSweepOutlined'
import type { ChatMessage, KnowledgeSource } from '../../../shared/types'
import type { AppCtx } from '../App'
import { api, cleanError, useEvent } from '../api'
import { Markdown } from '../components/Markdown'
import { CitationList } from '../components/Citations'
import { GeminiText, Shimmer, Sparkle } from '../components/ui'
import { GOOGLE } from '../theme'

const SUGGESTIONS = [
  { text: 'What did we decide in my last meeting?', icon: <EventNoteRounded />, color: GOOGLE.blue },
  { text: 'List open action items across my meetings', icon: <TaskAltRounded />, color: GOOGLE.green },
  { text: 'What does the latest quote say about pricing?', icon: <RequestQuoteRounded />, color: GOOGLE.orange },
  { text: 'What is on my calendar this week?', icon: <CalendarMonthRounded />, color: GOOGLE.purple }
]

export function ChatPage({ ctx }: { ctx: AppCtx }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [labels, setLabels] = useState<string[]>([])
  const [scope, setScope] = useState<string[]>([])
  const [hl, setHl] = useState<Record<string, number | null>>({})
  const [status, setStatus] = useState('')
  const reqId = useRef('')
  const end = useRef<HTMLDivElement>(null)
  const first = ctx.settings.userName && ctx.settings.userName !== 'You' ? ctx.settings.userName.split(' ')[0] : ''

  useEffect(() => {
    void api.chatHistory().then(setMsgs)
    void api.sources().then((s: KnowledgeSource[]) => setLabels([...new Set([...s.map((x) => x.label), 'Meetings', 'Memory'])].sort()))
  }, [])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [msgs])

  useEvent('chat:status', (p) => p.requestId === reqId.current && setStatus(p.text))
  useEvent('chat:delta', (p) => {
    if (p.requestId !== reqId.current) return
    setMsgs((m) => {
      const last = m[m.length - 1]
      return last?.id === reqId.current ? [...m.slice(0, -1), { ...last, content: last.content + p.text }] : m
    })
  })

  const send = async (text = input): Promise<void> => {
    const q = text.trim()
    if (!q || busy) return
    setInput('')
    setBusy(true)
    setStatus('')
    reqId.current = crypto.randomUUID()
    const history = msgs.slice(-6)
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: q, createdAt: Date.now() }
    const pending: ChatMessage = { id: reqId.current, role: 'assistant', content: '', createdAt: Date.now() }
    setMsgs((m) => [...m, user, pending])
    try {
      const r = await api.ask(reqId.current, q, { labels: scope.length ? scope : undefined }, history, true)
      setMsgs((m) => m.map((x) => (x.id === pending.id ? { ...x, content: r.answer, citations: r.citations } : x)))
    } catch (e) {
      setMsgs((m) => m.map((x) => (x.id === pending.id ? { ...x, content: `**Could not answer.** ${cleanError(e)}` } : x)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        <Box sx={{ maxWidth: 840, mx: 'auto', px: 4, pt: 3, pb: 4 }}>
          {msgs.length === 0 ? (
            <Box sx={{ pt: { xs: 6, md: 12 } }}>
              <Typography variant="h3" component="h1" sx={{ fontVariationSettings: "'ROND' 50" }}>
                <GeminiText>{tr("Hello")}{first ? `, ${first}` : ''}</GeminiText>
              </Typography>
              <Typography variant="h4" component="p" sx={{ color: 'text.disabled', fontWeight: 400, mt: 0.5, mb: 5 }}>
                {tr("What do you want to know from your meetings and files?")}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1.5 }}>
                {SUGGESTIONS.map((s) => (
                  <ButtonBase
                    key={s.text}
                    onClick={() => void send(tr(s.text))}
                    sx={(t) => ({
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 3,
                      p: 2,
                      minHeight: 150,
                      textAlign: 'start',
                      borderRadius: 5,
                      bgcolor: t.fs.container,
                      transition: 'background 150ms',
                      '&:hover': { bgcolor: t.fs.containerHigh }
                    })}
                  >
                    <Typography sx={{ fontSize: 15, fontWeight: 500 }}>{tr(s.text)}</Typography>
                    <Box sx={(t) => ({ width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: t.fs.sheet, color: s.color, alignSelf: 'flex-end' })}>{s.icon}</Box>
                  </ButtonBase>
                ))}
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
              <Button
                size="small"
                startIcon={<DeleteSweepOutlined />}
                onClick={() => {
                  void api.clearChat()
                  setMsgs([])
                }}
              >
                {tr("New chat")}
              </Button>
            </Box>
          )}
          {msgs.map((m) =>
            m.role === 'user' ? (
              <Box key={m.id} sx={{ display: 'flex', justifyContent: 'flex-end', my: 3 }}>
                <Box sx={(t) => ({ maxWidth: '72%', px: 2.5, py: 1.5, borderRadius: '24px 4px 24px 24px', bgcolor: t.fs.containerHigh })}>
                  <Typography variant="body1">{m.content}</Typography>
                </Box>
              </Box>
            ) : (
              <Box key={m.id} sx={{ display: 'flex', gap: 2, my: 3, animation: 'fsFadeIn 220ms' }}>
                <Box sx={{ mt: 0.25 }}>
                  <Sparkle size={26} spinning={busy && m.id === reqId.current && !m.content} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {m.content ? <Markdown text={m.content} citations={m.citations} onCite={(c) => setHl((h) => ({ ...h, [m.id]: c.n }))} /> : (
                    <>
                      {status && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {status}…
                        </Typography>
                      )}
                      <Shimmer lines={3} />
                    </>
                  )}
                  {m.citations && m.citations.length > 0 && (
                    <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1 }}>
                      <CitationList citations={m.citations} dense highlight={hl[m.id] ?? null} />
                    </Box>
                  )}
                </Box>
              </Box>
            )
          )}
          <div ref={end} />
        </Box>
      </Box>
      <Box sx={{ maxWidth: 840, width: '100%', mx: 'auto', px: 4, pb: 2.5 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
          {['Everything', ...labels].map((l) => {
            const on = l === 'Everything' ? scope.length === 0 : scope.includes(l)
            return (
              <Chip
                key={l}
                size="small"
                label={l === 'Everything' ? tr('Everything') : l}
                icon={on ? <CheckRounded /> : undefined}
                variant={on ? 'filled' : 'outlined'}
                onClick={() => (l === 'Everything' ? setScope([]) : setScope((s) => (on ? s.filter((x) => x !== l) : [...s, l])))}
                sx={(t) => ({ height: 30, ...(on ? { bgcolor: t.fs.secondaryContainer, color: t.fs.onSecondaryContainer, '& .MuiChip-icon': { color: 'inherit' } } : {}) })}
              />
            )
          })}
        </Box>
        <Box
          sx={(t) => ({
            display: 'flex',
            alignItems: 'flex-end',
            gap: 1,
            pl: 2.5,
            pr: 0.75,
            py: 0.75,
            borderRadius: 8,
            bgcolor: t.fs.container,
            transition: 'box-shadow 150ms, background 150ms',
            '&:focus-within': { bgcolor: t.fs.sheet, boxShadow: t.fs.elevationHigh }
          })}
        >
          <InputBase
            fullWidth
            multiline
            maxRows={6}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={tr("Ask Insight")}
            inputProps={{ 'aria-label': tr("Ask Insight") }}
            sx={{ py: 1.25, fontSize: 16 }}
          />
          <IconButton
            onClick={() => void send()}
            disabled={!input.trim() || busy}
            aria-label={tr("Send")}
            sx={(t) => ({ width: 44, height: 44, mb: 0.25, bgcolor: input.trim() ? t.fs.primary : 'transparent', color: input.trim() ? t.fs.onPrimary : 'inherit', '&:hover': { bgcolor: t.fs.primary } })}
          >
            <ArrowUpwardRounded />
          </IconButton>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
          {ctx.settings.aiProvider === 'local' ? tr("Answers come from Gemma 4 on this PC.") : tr("Answers are written by a cloud model; your files are searched on this PC.")}{' '}{tr("Check important answers against the cited sources.")}
        </Typography>
      </Box>
    </Box>
  )
}
