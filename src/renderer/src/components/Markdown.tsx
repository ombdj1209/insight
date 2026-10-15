import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Box, Tooltip } from '@mui/material'
import type { Citation } from '../../../shared/types'

const linkCites = (md: string): string => md.replace(/\[(\d{1,2})\](?!\()/g, '[$1](#cite-$1)')

export function Markdown({ text, citations, onCite }: { text: string; citations?: Citation[]; onCite?: (c: Citation) => void }) {
  return (
    <Box
      sx={(t) => ({
        fontSize: 15,
        lineHeight: 1.65,
        color: 'text.primary',
        '& h1, & h2, & h3': { fontWeight: 500, lineHeight: 1.3, mt: 2.5, mb: 1 },
        '& h1': { fontSize: 22 },
        '& h2': { fontSize: 18 },
        '& h3': { fontSize: 16 },
        '& > :first-of-type': { mt: 0 },
        '& p': { my: 1 },
        '& ul, & ol': { pl: 3, my: 1 },
        '& li': { my: 0.5 },
        '& li::marker': { color: t.fs.onSurfaceVariant },
        '& blockquote': { borderLeft: `3px solid ${t.fs.primary}`, m: 0, pl: 2, color: 'text.secondary' },
        '& code': { fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: 13, bgcolor: t.fs.container, px: 0.5, borderRadius: 1 },
        '& table': { borderCollapse: 'collapse', my: 1.5 },
        '& td, & th': { border: `1px solid ${t.fs.outline}`, px: 1.25, py: 0.5 },
        '& a': { color: t.fs.primary }
      })}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#cite-')) {
              const n = Number(href.slice(6))
              const c = citations?.find((x) => x.n === n)
              const chip = (
                <Box
                  component="button"
                  onClick={() => c && onCite?.(c)}
                  sx={(t) => ({
                    all: 'unset',
                    cursor: c ? 'pointer' : 'default',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 18,
                    height: 18,
                    px: 0.5,
                    mx: 0.25,
                    borderRadius: '9px',
                    fontSize: 11,
                    fontWeight: 600,
                    verticalAlign: 'text-top',
                    bgcolor: t.fs.primaryContainer,
                    color: t.fs.onPrimaryContainer,
                    '&:focus-visible': { outline: `2px solid ${t.fs.primary}` }
                  })}
                >
                  {n}
                </Box>
              )
              return c ? <Tooltip title={`${c.title}${c.loc ? ` · ${c.loc}` : ''}`}>{chip}</Tooltip> : chip
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          }
        }}
      >
        {linkCites(text)}
      </ReactMarkdown>
    </Box>
  )
}
