import { setUiLanguage, t as tr, useI18nVersion } from '../i18n'
import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import '@fontsource-variable/google-sans-flex/full.css'
import { WORLD } from '../../../shared/languages'
import { api, useEvent } from '../api'

const FONT = '"Google Sans Flex Variable", "Segoe UI", "Yu Gothic UI", Meiryo, "Microsoft YaHei UI", "Nirmala UI", sans-serif'
const COLORS = ['#8AB4F8', '#F28B82', '#FDD663', '#81C995', '#C58AF9', '#78D9EC']

interface Line {
  id: string
  speaker: string
  text: string
  tr?: string
}

function Captions() {
  const [lines, setLines] = useState<Line[]>([])
  const [lang, setLang] = useState('')
  const [size, setSize] = useState(22)
  const [listening, setListening] = useState(false)
  const colors = useRef(new Map<string, string>())
  useI18nVersion()
  const langRef = useRef(lang)
  langRef.current = lang

  useEffect(() => {
    void api.getSettings().then((s) => {
      setLang(s.captionsLanguage)
      void setUiLanguage(s.uiLanguage)
    })
    try {
      const v = Number(localStorage.getItem('captions.size'))
      if (v >= 14 && v <= 40) setSize(v)
    } catch {
      /* storage unavailable */
    }
  }, [])
  useEvent('captions:language', setLang)
  useEvent('meeting:state', (m) => setListening(m.recording))
  useEvent('transcript:line', ({ line }) => {
    if (!colors.current.has(line.speaker)) colors.current.set(line.speaker, COLORS[colors.current.size % COLORS.length])
    setLines((ls) => [...ls, { id: line.id, speaker: line.speaker, text: line.text }].slice(-3))
    if (langRef.current) {
      void api.captionsTranslate(line.text).then((tr) => {
        if (tr) setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, tr } : l)))
      })
    }
  })
  const zoom = (d: number): void => {
    const v = Math.max(14, Math.min(40, size + d))
    setSize(v)
    try {
      localStorage.setItem('captions.size', String(v))
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, padding: 6, fontFamily: FONT }}>
      <div style={{ height: '100%', boxSizing: 'border-box', borderRadius: 22, background: 'rgba(32,33,36,.92)', color: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 6px 24px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 4px 14px', fontSize: 12, color: '#BDC1C6', ...drag }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: listening ? '#F28B82' : '#5F6368' }} />
          <span style={{ fontWeight: 700, letterSpacing: 0.4 }}>{tr("Live captions")}</span>
          <span style={{ flex: 1 }} />
          <select value={lang} onChange={(e) => void api.captionsSetLanguage(e.target.value)} style={{ ...noDrag, ...control }} aria-label={tr("Translate captions to")}>
            <option value="">{tr("Original only")}</option>
            {WORLD.map((w) => (
              <option key={w.name} value={w.name}>
                → {w.native}
              </option>
            ))}
          </select>
          <button onClick={() => zoom(-2)} style={{ ...noDrag, ...control }} aria-label={tr("Smaller text")}>
            A−
          </button>
          <button onClick={() => zoom(2)} style={{ ...noDrag, ...control }} aria-label={tr("Larger text")}>
            A+
          </button>
          <button onClick={() => void api.captionsToggle(false)} style={{ ...noDrag, ...control }} aria-label={tr("Close captions")}>
            ✕
          </button>
        </div>
        <div style={{ flex: 1, padding: '0 18px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 4, overflow: 'hidden' }}>
          {!lines.length && <div style={{ color: '#9AA0A6', fontSize: 16 }}>{listening ? tr("Listening… captions appear after each sentence.") : tr("Captions appear while Insight is listening to a meeting.")}</div>}
          {lines.map((l, i) => (
            <div key={l.id} dir="auto" style={{ opacity: i === lines.length - 1 ? 1 : 0.62, lineHeight: 1.3 }}>
              <span style={{ color: colors.current.get(l.speaker), fontWeight: 700, fontSize: size * 0.7, marginInlineEnd: 8 }}>{l.speaker}</span>
              <span style={{ fontSize: size }}>{l.text}</span>
              {l.tr && (
                <div dir="auto" style={{ color: '#FDD663', fontSize: size * 0.9 }}>
                  {l.tr}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const drag = { WebkitAppRegion: 'drag' } as CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties
const control: CSSProperties = { background: 'rgba(255,255,255,.1)', color: '#E8EAED', border: 'none', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontFamily: FONT, cursor: 'pointer' }

createRoot(document.getElementById('root')!).render(<Captions />)
