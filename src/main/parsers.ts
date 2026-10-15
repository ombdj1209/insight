import { readFileSync } from 'fs'
import { basename, extname } from 'path'

export interface Section {
  loc?: string
  text: string
}

export interface Parsed {
  title: string
  sections: Section[]
}

export const TEXT_EXT = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.yaml', '.yml', '.xml', '.rst']
export const DOC_EXT = ['.pdf', '.docx', '.pptx', '.xlsx', '.xls', '.ods', '.html', '.htm', '.ics', '.url']
export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']
export const SUPPORTED_EXT = [...TEXT_EXT, ...DOC_EXT, ...IMAGE_EXT]

export const isImage = (p: string): boolean => IMAGE_EXT.includes(extname(p).toLowerCase())
export const imageMime = (p: string): string => {
  const e = extname(p).toLowerCase().slice(1)
  return e === 'jpg' ? 'image/jpeg' : `image/${e}`
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

function parseIcs(raw: string): Section[] {
  const unfolded = raw.replace(/\r?\n[ \t]/g, '')
  const events = unfolded.split('BEGIN:VEVENT').slice(1)
  return events.map((ev) => {
    const get = (key: string): string => {
      const m = ev.match(new RegExp(`^${key}[^:\\n]*:(.*)$`, 'm'))
      return m ? m[1].replace(/\\n/g, '\n').replace(/\\,/g, ',').trim() : ''
    }
    const attendees = [...ev.matchAll(/^ATTENDEE([^:\n]*):(?:mailto:)?(.*)$/gim)].map((m) => {
      const cn = m[1].match(/CN="?([^;:"]+)"?/i)?.[1]
      return (cn || m[2]).trim()
    })
    const start = get('DTSTART')
    const fmt = start.replace(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2}))?.*$/, (_, y, mo, d, _t, h, mi) => `${y}-${mo}-${d}${h ? ` ${h}:${mi}` : ''}`)
    const text = [
      `Event: ${get('SUMMARY')}`,
      `When: ${fmt}`,
      get('LOCATION') && `Where: ${get('LOCATION')}`,
      attendees.length ? `Attendees: ${attendees.join(', ')}` : '',
      get('DESCRIPTION')
    ]
      .filter(Boolean)
      .join('\n')
    return { loc: fmt, text }
  })
}

export function parseBookmarks(raw: string, file: string): Section[] {
  // Chrome/Edge "Bookmarks" JSON
  if (raw.trim().startsWith('{')) {
    const out: Section[] = []
    const walk = (node: { type?: string; name?: string; url?: string; children?: unknown[] }, folder: string): void => {
      if (node.type === 'url' && node.url) out.push({ loc: folder, text: `${node.name}\n${node.url}` })
      for (const c of (node.children ?? []) as (typeof node)[]) walk(c, node.name ? `${folder}/${node.name}` : folder)
    }
    const j = JSON.parse(raw) as { roots: Record<string, typeof Object> }
    for (const root of Object.values(j.roots ?? {})) if (root && typeof root === 'object') walk(root as never, '')
    return out
  }
  // Netscape HTML export (Chrome, Edge, Firefox)
  return [...raw.matchAll(/<A[^>]*HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi)].map((m) => ({
    loc: basename(file),
    text: `${decodeEntities(m[2])}\n${m[1]}`
  }))
}

async function parsePptx(buf: Buffer): Promise<Section[]> {
  const mod = await import('jszip')
  const JSZip = ((mod as { default?: unknown }).default ?? mod) as typeof import('jszip')
  const zip = await JSZip.loadAsync(buf)
  const slides = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()))
  const out: Section[] = []
  for (const [i, f] of slides.entries()) {
    const xml = await zip.files[f].async('string')
    const notesFile = f.replace('slides/slide', 'notesSlides/notesSlide')
    const notes = zip.files[notesFile] ? await zip.files[notesFile].async('string') : ''
    const grab = (x: string): string => [...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeEntities(m[1])).join(' ')
    const text = [grab(xml), notes && `Speaker notes: ${grab(notes)}`].filter(Boolean).join('\n')
    if (text.trim()) out.push({ loc: `Slide ${i + 1}`, text })
  }
  return out
}

export async function parseFile(file: string): Promise<Parsed> {
  const ext = extname(file).toLowerCase()
  const title = basename(file)
  const buf = readFileSync(file)
  if (TEXT_EXT.includes(ext)) return { title, sections: [{ text: buf.toString('utf8') }] }
  switch (ext) {
    case '.pdf': {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(buf))
      const { text } = await extractText(pdf, { mergePages: false })
      return { title, sections: (text as string[]).map((t, i) => ({ loc: `Page ${i + 1}`, text: t })) }
    }
    case '.docx': {
      const mod = await import('mammoth')
      const mammoth = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod
      const r = await mammoth.extractRawText({ buffer: buf })
      return { title, sections: [{ text: r.value }] }
    }
    case '.pptx':
      return { title, sections: await parsePptx(buf) }
    case '.xlsx':
    case '.xls':
    case '.ods': {
      const mod = await import('xlsx')
      const XLSX = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod
      const wb = XLSX.read(buf, { type: 'buffer' })
      return {
        title,
        sections: wb.SheetNames.map((n) => ({ loc: `Sheet ${n}`, text: XLSX.utils.sheet_to_csv(wb.Sheets[n]) }))
      }
    }
    case '.html':
    case '.htm': {
      const raw = buf.toString('utf8')
      if (/NETSCAPE-Bookmark-file/i.test(raw)) return { title, sections: parseBookmarks(raw, file) }
      const t = raw.match(/<title>([^<]*)<\/title>/i)?.[1]
      return { title: t ? decodeEntities(t) : title, sections: [{ text: htmlToText(raw) }] }
    }
    case '.ics':
      return { title, sections: parseIcs(buf.toString('utf8')) }
    case '.url': {
      const url = buf.toString('utf8').match(/^URL=(.*)$/m)?.[1] ?? ''
      return { title, sections: [{ text: `${title.replace(/\.url$/i, '')}\n${url}` }] }
    }
  }
  return { title, sections: [] }
}

/** Split text into ~maxChars chunks on paragraph/sentence boundaries with overlap. */
export function chunkText(text: string, maxChars = 1200, overlap = 180): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []
  if (clean.length <= maxChars) return [clean]
  const pieces = clean.split(/(?<=[.!?。])\s+|\n\n/)
  const chunks: string[] = []
  let cur = ''
  for (const p of pieces) {
    if ((cur + ' ' + p).length > maxChars && cur) {
      chunks.push(cur.trim())
      cur = cur.slice(-overlap) + ' ' + p
    } else cur = cur ? `${cur} ${p}` : p
    while (cur.length > maxChars * 1.5) {
      chunks.push(cur.slice(0, maxChars))
      cur = cur.slice(maxChars - overlap)
    }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks
}
