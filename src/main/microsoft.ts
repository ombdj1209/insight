import { shell } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import type { CalEvent, Person } from '../shared/google'
import { joinUrlOf } from '../shared/google'
import type { ToolDef } from './llm'
import { getSecret, setSecret } from './secrets'
import { getSettings } from './settings'
import { appConfig } from './appConfig'

/**
 * Microsoft 365 (Outlook mail and calendar, To Do, Teams) through Microsoft Graph.
 * Public-client sign-in with PKCE on a loopback redirect: no client secret is stored. Token kept encrypted (DPAPI).
 */
export const MS_PORT = 47821
export const MS_REDIRECT = `http://localhost:${MS_PORT}`
const READ = ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.Read', 'Mail.Read']
const WRITE = ['Mail.ReadWrite', 'Tasks.ReadWrite', 'Calendars.ReadWrite']
const GRAPH = 'https://graph.microsoft.com/v1.0'

interface Token {
  access_token: string
  refresh_token: string
  expires_at: number
  scope: string
  email?: string
}
const load = (): Token | null => {
  try {
    const raw = getSecret('msToken')
    return raw ? (JSON.parse(raw) as Token) : null
  } catch {
    return null
  }
}
const save = (t: Token | null): void => setSecret('msToken', t ? JSON.stringify(t) : '')
// the user's own app registration wins; otherwise the one built into this copy of Insight
const msClientId = (): string => getSettings().msClientId.trim() || appConfig().msClientId || ''
export const msBuiltIn = (): boolean => !!appConfig().msClientId
const authority = (): string => `https://login.microsoftonline.com/${encodeURIComponent((getSettings().msClientId.trim() ? getSettings().msTenant : appConfig().msTenant) || 'common')}/oauth2/v2.0`

export const msConnected = (): boolean => !!load()?.refresh_token
export const msEmail = (): string | undefined => load()?.email
export const msActionsNeedReconnect = (): boolean => {
  const granted = (load()?.scope ?? '').toLowerCase()
  return getSettings().msActions && WRITE.some((s) => !granted.includes(s.toLowerCase()))
}
export const msActionsReady = (): boolean => msConnected() && getSettings().msActions && !msActionsNeedReconnect()
export const msStatus = (): { configured: boolean; connected: boolean; email?: string; actionsNeedReconnect: boolean } => ({
  configured: !!msClientId(),
  connected: msConnected(),
  email: msEmail(),
  actionsNeedReconnect: msConnected() && msActionsNeedReconnect()
})

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${authority()}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) })
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw Object.assign(new Error(`Microsoft sign-in failed: ${String(j.error_description ?? j.error ?? res.status).split('\r\n')[0]}`), { code: j.error })
  return j
}

let signingIn: Promise<void> | null = null
export const connectMicrosoft = (): Promise<void> => (signingIn ??= doConnect().finally(() => (signingIn = null)))

async function doConnect(): Promise<void> {
  const clientId = msClientId()
  if (!clientId) throw new Error('Microsoft sign-in is not set up in this copy of Insight. Add your own app registration in Settings > Microsoft 365.')
  const scopes = [...READ, ...(getSettings().msActions ? WRITE : [])].join(' ')
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(16).toString('hex')
  const url = new URL(`${authority()}/authorize`)
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: MS_REDIRECT,
    response_mode: 'query',
    scope: scopes,
    state,
    prompt: 'select_account',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256'
  }).toString()
  const code = await new Promise<string>((resolve, reject) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url ?? '/', MS_REDIRECT)
      const err = u.searchParams.get('error_description') ?? u.searchParams.get('error')
      const c = u.searchParams.get('code')
      if (!c && !err) {
        res.writeHead(404).end()
        return
      }
      const ok = !err && !!c && u.searchParams.get('state') === state
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<p style="font:16px system-ui;margin:3em">${ok ? 'Insight is connected to Microsoft 365. You can close this tab.' : 'Sign-in failed. You can close this tab and try again.'}</p>`)
      clearTimeout(timer)
      srv.close()
      if (ok) resolve(c!)
      else reject(new Error(`Microsoft sign-in failed: ${err ?? 'state mismatch'}`))
    })
    const timer = setTimeout(() => {
      srv.close()
      reject(new Error('Microsoft sign-in timed out. Try Connect again.'))
    }, 5 * 60_000)
    srv.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Could not listen on port ${MS_PORT} for the sign-in redirect: ${e.message}`))
    })
    srv.listen(MS_PORT, '127.0.0.1', () => void shell.openExternal(url.toString()))
  })
  const j = await tokenRequest({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: MS_REDIRECT, code_verifier: verifier, scope: scopes })
  const t: Token = { access_token: String(j.access_token), refresh_token: String(j.refresh_token ?? ''), expires_at: Date.now() + Number(j.expires_in ?? 3600) * 1000, scope: String(j.scope ?? scopes) }
  if (!t.refresh_token) throw new Error('Microsoft did not return a refresh token (offline_access). Check the app registration.')
  save(t)
  try {
    const me = (await (await msFetch(`${GRAPH}/me?$select=mail,userPrincipalName`)).json()) as { mail?: string; userPrincipalName?: string }
    save({ ...t, email: me.mail ?? me.userPrincipalName })
  } catch {
    /* email is cosmetic */
  }
}

let refreshing: Promise<string> | null = null
async function accessToken(): Promise<string> {
  const t = load()
  if (!t) throw new Error('Microsoft 365 is not connected. Open Settings > Microsoft 365.')
  if (t.expires_at - 60_000 > Date.now()) return t.access_token
  return (refreshing ??= (async () => {
    try {
      const j = await tokenRequest({ client_id: msClientId(), grant_type: 'refresh_token', refresh_token: t.refresh_token, scope: t.scope })
      const next = { ...t, access_token: String(j.access_token), refresh_token: String(j.refresh_token ?? t.refresh_token), expires_at: Date.now() + Number(j.expires_in ?? 3600) * 1000, scope: String(j.scope ?? t.scope) }
      save(next)
      return next.access_token
    } catch (e) {
      if ((e as { code?: string }).code === 'invalid_grant') {
        save(null)
        throw new Error('Microsoft sign-in expired. Connect again in Settings > Microsoft 365.')
      }
      throw e
    } finally {
      refreshing = null
    }
  })())
}

export async function msFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${await accessToken()}`)
  return fetch(url, { ...init, headers })
}
export const disconnectMicrosoft = (): void => save(null)

async function graph<T>(path: string, init: RequestInit = {}, what = 'Microsoft 365'): Promise<T> {
  const res = await msFetch(path.startsWith('http') ? path : `${GRAPH}${path}`, init)
  if (!res.ok) throw new Error(`${what} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 240)}`)
  return (res.status === 204 ? {} : await res.json()) as T
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ---------- calendar ----------
interface MsEvent {
  id: string
  subject?: string
  isAllDay?: boolean
  isCancelled?: boolean
  start: { dateTime: string }
  end: { dateTime: string }
  location?: { displayName?: string }
  onlineMeeting?: { joinUrl?: string } | null
  onlineMeetingUrl?: string | null
  webLink?: string
  bodyPreview?: string
  responseStatus?: { response?: string }
  attendees?: { emailAddress?: { address?: string; name?: string }; type?: string }[]
}
const utc = (s: string): number => Date.parse(s.endsWith('Z') ? s : `${s}Z`)

export async function msEvents(from: number, to: number): Promise<CalEvent[]> {
  const q = new URLSearchParams({ startDateTime: new Date(from).toISOString(), endDateTime: new Date(to).toISOString(), $top: '100', $orderby: 'start/dateTime', $select: 'id,subject,isAllDay,isCancelled,start,end,location,onlineMeeting,onlineMeetingUrl,webLink,bodyPreview,responseStatus,attendees' })
  const j = await graph<{ value?: MsEvent[] }>(`/me/calendarView?${q}`, { headers: { Prefer: 'outlook.timezone="UTC"' } }, 'Outlook calendar sync')
  const me = (msEmail() ?? '').toLowerCase()
  return (j.value ?? [])
    .filter((e) => !e.isCancelled && e.responseStatus?.response !== 'declined')
    .map((e) => {
      const people: Person[] = (e.attendees ?? []).filter((a) => a.emailAddress?.address && a.type !== 'resource').map((a) => ({ email: a.emailAddress!.address!, name: a.emailAddress!.name, self: a.emailAddress!.address!.toLowerCase() === me }))
      return {
        id: `ms:${e.id}`,
        title: e.subject || '(No title)',
        start: utc(e.start.dateTime),
        end: utc(e.end.dateTime),
        allDay: !!e.isAllDay,
        location: e.location?.displayName,
        joinUrl: e.onlineMeeting?.joinUrl || e.onlineMeetingUrl || joinUrlOf({ location: e.location?.displayName, description: e.bodyPreview }),
        htmlLink: e.webLink,
        attendees: people.length,
        people,
        description: e.bodyPreview?.slice(0, 1200)
      }
    })
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end))
}

// ---------- tools for Ask and briefs (read-only) ----------
export const msTools = (): ToolDef[] =>
  !msConnected()
    ? []
    : [
        { name: 'outlook__search_mail', description: '[Outlook] Search the user\'s Outlook mail. Use sender/recipient names or emails and topic words.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search words, e.g. "budget from:daniel@contoso.com"' }, top: { type: 'integer', description: 'Max results (1-15)' } }, required: ['query'] } },
        { name: 'outlook__get_message', description: '[Outlook] Read one Outlook message by id (from search results).', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
        { name: 'outlook__list_events', description: '[Outlook] List Outlook calendar events between two ISO dates.', parameters: { type: 'object', properties: { start: { type: 'string', description: 'ISO date-time' }, end: { type: 'string', description: 'ISO date-time' } }, required: ['start', 'end'] } }
      ]

export async function callMsTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'outlook__search_mail') {
      const top = Math.max(1, Math.min(15, Number(args.top) || 8))
      const q = new URLSearchParams({ $search: `"${String(args.query ?? '').replace(/"/g, '')}"`, $top: String(top), $select: 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,webLink' })
      const j = await graph<{ value?: unknown[] }>(`/me/messages?${q}`, { headers: { ConsistencyLevel: 'eventual' } })
      return JSON.stringify(j.value ?? []).slice(0, 12_000)
    }
    if (name === 'outlook__get_message') {
      const j = await graph<{ subject?: string; from?: unknown; toRecipients?: unknown; receivedDateTime?: string; body?: { content?: string } }>(`/me/messages/${encodeURIComponent(String(args.id))}?$select=subject,from,toRecipients,receivedDateTime,body`, { headers: { Prefer: 'outlook.body-content-type="text"' } })
      return JSON.stringify({ ...j, body: j.body?.content?.slice(0, 8000) })
    }
    if (name === 'outlook__list_events') {
      const ev = await msEvents(Date.parse(String(args.start)) || Date.now(), Date.parse(String(args.end)) || Date.now() + 7 * 86_400_000)
      return JSON.stringify(ev.map((e) => ({ title: e.title, start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString(), attendees: e.people?.map((p) => p.name ?? p.email), joinUrl: e.joinUrl }))).slice(0, 12_000)
    }
    return `Unknown tool ${name}`
  } catch (e) {
    return `Error: ${(e as Error).message.slice(0, 300)}`
  }
}

// ---------- write actions (confirmed in the UI first) ----------
function requireActions(): void {
  if (!msConnected()) throw new Error('Connect Microsoft 365 in Settings first.')
  if (!getSettings().msActions) throw new Error('Turn on "Allow actions" in Settings > Microsoft 365.')
  if (msActionsNeedReconnect()) throw new Error('Reconnect Microsoft 365 in Settings to allow drafts, tasks and events.')
}
const recipients = (to: string[]): { emailAddress: { address: string } }[] => to.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).map((address) => ({ emailAddress: { address } }))

export async function msDraft(p: { to: string[]; subject: string; body: string }): Promise<{ url: string }> {
  requireActions()
  const j = await graph<{ webLink?: string }>('/me/messages', json({ subject: p.subject, body: { contentType: 'Text', content: p.body }, toRecipients: recipients(p.to) }), 'Creating the Outlook draft')
  return { url: j.webLink ?? 'https://outlook.office.com/mail/drafts' }
}

export async function msTasks(items: { title: string; notes?: string; due?: string | null }[]): Promise<{ added: number; url: string }> {
  requireActions()
  const lists = await graph<{ value?: { id: string; wellknownListName?: string }[] }>('/me/todo/lists', {}, 'Reading To Do lists')
  const list = lists.value?.find((l) => l.wellknownListName === 'defaultList') ?? lists.value?.[0]
  if (!list) throw new Error('No Microsoft To Do list found.')
  let added = 0
  for (const it of items.slice(0, 25)) {
    const body: Record<string, unknown> = { title: it.title.slice(0, 255) }
    if (it.notes) body.body = { content: it.notes.slice(0, 4000), contentType: 'text' }
    if (it.due && /^\d{4}-\d{2}-\d{2}$/.test(it.due)) body.dueDateTime = { dateTime: `${it.due}T00:00:00`, timeZone: 'UTC' }
    await graph(`/me/todo/lists/${encodeURIComponent(list.id)}/tasks`, json(body), 'Adding to Microsoft To Do')
    added++
  }
  return { added, url: 'https://to-do.office.com/tasks/' }
}

export async function msEvent(p: { title: string; start: number; minutes: number; attendees: string[]; description?: string; meet: boolean }): Promise<{ url: string }> {
  requireActions()
  if (!(p.start > Date.now() - 60_000)) throw new Error('Pick a time in the future.')
  const iso = (ms: number): string => new Date(ms).toISOString().replace('Z', '')
  const j = await graph<{ webLink?: string }>(
    '/me/events',
    json({
      subject: p.title,
      body: { contentType: 'Text', content: p.description ?? '' },
      start: { dateTime: iso(p.start), timeZone: 'UTC' },
      end: { dateTime: iso(p.start + Math.max(5, p.minutes) * 60_000), timeZone: 'UTC' },
      attendees: recipients(p.attendees).map((r) => ({ ...r, type: 'required' })),
      ...(p.meet ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {})
    }),
    'Booking the Outlook meeting'
  )
  return { url: j.webLink ?? 'https://outlook.office.com/calendar/' }
}

/** Evidence that a promise was kept: the latest Outlook message sent to `email` after `since`. */
export async function msLastSentTo(email: string, since: number): Promise<{ subject: string; date: number } | null> {
  if (!msConnected()) return null
  const q = new URLSearchParams({ $search: `"to:${email}"`, $top: '5', $select: 'subject,sentDateTime' })
  const j = await graph<{ value?: { subject?: string; sentDateTime?: string }[] }>(`/me/mailFolders/sentitems/messages?${q}`, { headers: { ConsistencyLevel: 'eventual' } }).catch(() => ({ value: [] }))
  const hit = (j.value ?? []).map((m) => ({ subject: m.subject ?? '(no subject)', date: Date.parse(m.sentDateTime ?? '') })).filter((m) => m.date > since).sort((a, b) => b.date - a.date)[0]
  return hit ?? null
}
