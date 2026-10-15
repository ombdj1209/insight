import { useSyncExternalStore } from 'react'
import { findWorld, worldFromLocale } from '../../shared/languages'
import { api } from './api'

/**
 * Interface translation. English source strings are the keys: t('Start listening'), t('Added {n} tasks', { n }).
 * Unknown strings are collected, translated in one batch by the main process (cached per language on disk),
 * and the UI re-renders. Never pass user content (titles, transcripts, notes) through t().
 */
let lang = 'English'
let cat: Record<string, string> = {}
const pending = new Set<string>()
const asked = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let version = 0
const subs = new Set<() => void>()
const bump = (): void => {
  version++
  subs.forEach((f) => f())
}

const fill = (s: string, vars?: Record<string, string | number>): string => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s)

export function t(s: string, vars?: Record<string, string | number>): string {
  if (lang === 'English' || !s) return fill(s, vars)
  const hit = cat[s]
  if (hit === undefined && !asked.has(s)) {
    pending.add(s)
    timer ??= setTimeout(flush, 250)
  }
  return fill(hit ?? s, vars)
}

function flush(): void {
  timer = undefined
  const batch = [...pending]
  pending.clear()
  if (!batch.length) return
  batch.forEach((s) => asked.add(s))
  const forLang = lang
  void api
    .translate(forLang, batch)
    .then((out) => {
      if (forLang !== lang) return
      let changed = false
      batch.forEach((s, i) => {
        if (out[i] !== s) (cat[s] = out[i]), (changed = true)
      })
      // ponytail: untranslated strings (no AI provider yet) retry on the next language change or restart
      if (changed) bump()
    })
    .catch(() => undefined)
}

/** Resolve 'auto' to the Windows display language; returns the WORLD language name. */
export const resolveUiLanguage = (setting: string): string => (setting && setting !== 'auto' ? setting : worldFromLocale(navigator.language)?.name ?? 'English')

export async function setUiLanguage(setting: string): Promise<void> {
  const next = resolveUiLanguage(setting)
  const w = findWorld(next)
  document.documentElement.lang = w?.locale ?? 'en'
  document.documentElement.dir = w?.rtl ? 'rtl' : 'ltr'
  if (next === lang) return
  lang = next
  asked.clear()
  pending.clear()
  cat = next === 'English' ? {} : await api.i18nCatalog(next).catch(() => ({}))
  bump()
}

export const uiLanguage = (): string => lang

/** Re-render on catalog changes. Call once near the root (App); no memo() components exist below it. */
export const useI18nVersion = (): number => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => version)
