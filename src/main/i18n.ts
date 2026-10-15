import { app } from 'electron'
import { join } from 'path'
import { worldFromLocale } from '../shared/languages'
import { chat } from './llm'
import { getSettings } from './settings'
import { dir } from './paths'
import { readJson, SerialQueue, writeJson } from './util'

/**
 * Translation cache for the interface and the pet. Strings are translated once by the configured AI provider
 * (local Gemma works offline) and kept per language in %LOCALAPPDATA%\Insight\i18n\<language>.json.
 * English is the source language and never translated.
 */
const caches = new Map<string, Record<string, string>>()
const queue = new SerialQueue()
const fileFor = (lang: string): string => join(dir('i18n'), `${lang.replace(/[^\w() -]/g, '_')}.json`)
const isEnglish = (lang: string): boolean => !lang || /^english$/i.test(lang)

export function catalog(lang: string): Record<string, string> {
  if (isEnglish(lang)) return {}
  if (!caches.has(lang)) caches.set(lang, readJson<Record<string, string>>(fileFor(lang), {}))
  return caches.get(lang)!
}

const SYSTEM = (lang: string): string => `Translate each string in the JSON array into ${lang} for a desktop meeting app's interface.
Rules: keep placeholders such as {name}, {n}, {0} exactly; keep product and brand names (Insight, Gmail, Google, Microsoft, Outlook, Teams, Zoom, Meet, Gemini, Gemma, Whisper, Ctrl, Shift);
translate ordinary short words too ("Pet", "Ask", "People", "Transcript" are UI labels, not names);
keep emoji, punctuation style and Markdown; keep it short and natural, like a native app. Return ONLY a JSON array of the same length, in the same order.`

async function translateChunk(lang: string, chunk: string[]): Promise<string[] | null> {
  const raw = await chat([{ role: 'system', content: SYSTEM(lang) }, { role: 'user', content: JSON.stringify(chunk) }], { maxTokens: 4000, temperature: 0.1 })
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)) as unknown[]
    if (!Array.isArray(arr) || arr.length !== chunk.length) return null
    return arr.map((x, i) => (typeof x === 'string' && x.trim() ? x : chunk[i]))
  } catch {
    return null
  }
}

// ponytail: one try per string per run; a failed translation (no AI provider yet) retries after restart
const asked = new Set<string>()
const pending = new Set<string>()
let flushTimer: NodeJS.Timeout | undefined

/** The interface language from Settings ('auto' follows Windows), as a WORLD language name. */
export const uiLanguage = (): string => {
  const s = getSettings().uiLanguage
  return s && s !== 'auto' ? s : worldFromLocale(app.getLocale()).name
}

/**
 * Menus and notifications: the cached translation now, English until it exists (translated in the background,
 * so the next menu or notification shows it). Placeholders: L('Say something, {name}', { name }).
 */
export function L(s: string, vars?: Record<string, string | number>): string {
  const lang = uiLanguage()
  const hit = catalog(lang)[s]
  if (hit === undefined && !isEnglish(lang) && !asked.has(s)) {
    asked.add(s)
    pending.add(s)
    flushTimer ??= setTimeout(() => {
      flushTimer = undefined
      const batch = [...pending]
      pending.clear()
      void translate(lang, batch).catch(() => undefined)
    }, 300)
  }
  const out = hit ?? s
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out
}

/** Translate strings (cached). Returns the originals for English or when no AI provider is available. */
export function translate(lang: string, texts: string[]): Promise<string[]> {
  if (isEnglish(lang) || !texts.length) return Promise.resolve(texts)
  return queue.push(async () => {
    const cat = catalog(lang)
    const missing = [...new Set(texts.filter((t) => t && cat[t] === undefined))]
    for (let i = 0; i < missing.length; i += 60) {
      const chunk = missing.slice(i, i + 60)
      let out: string[] | null = null
      try {
        out = await translateChunk(lang, chunk)
        if (!out && chunk.length > 1) {
          // one retry in halves: models occasionally drop an item in long arrays
          const a = await translateChunk(lang, chunk.slice(0, chunk.length >> 1))
          const b = await translateChunk(lang, chunk.slice(chunk.length >> 1))
          out = a && b ? [...a, ...b] : null
        }
      } catch {
        out = null // no AI provider yet: fall back to English for now, retry next time
      }
      if (!out) break
      // unchanged results (brand names, or a model that skipped a word) are not cached, so they retry next session
      chunk.forEach((s, j) => out![j] !== s && (cat[s] = out![j]))
      writeJson(fileFor(lang), cat)
    }
    return texts.map((t) => cat[t] ?? t)
  })
}
