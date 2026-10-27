import { shell } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import { ACTION_SCOPES, GOOGLE_SERVICES, OAUTH_PORT, OAUTH_REDIRECT, type GoogleService } from '../shared/google'
import { getSecret, setSecret } from './secrets'
import { getSettings } from './settings'
import { appConfig } from './appConfig'

/**
 * Google OAuth for the Workspace MCP servers and Calendar sync.
 * Loopback flow with PKCE; the refresh token is stored encrypted (DPAPI) and never leaves the main process.
 */
interface Token {
  access_token: string
  refresh_token: string
  expires_at: number
  scope: string
  email?: string
}

const load = (): Token | null => {
  try {
    const raw = getSecret('googleToken')
    return raw ? (JSON.parse(raw) as Token) : null
  } catch {
    return null
  }
}
const save = (t: Token | null): void => setSecret('googleToken', t ? JSON.stringify(t) : '')

export const googleConnected = (): boolean => !!load()?.refresh_token
export const googleEmail = (): string | undefined => load()?.email

/** Enabled services whose scopes were not granted at sign-in. */
export function missingScopes(): GoogleService[] {
  const granted = new Set((load()?.scope ?? '').split(' '))
  return getSettings().googleServices.filter((s) => GOOGLE_SERVICES[s].scopes.some((x) => !granted.has(x)))
}

/** True when "Allow actions" is on but its write scopes were not granted yet (needs a reconnect). */
export function actionsNeedReconnect(): boolean {
  const granted = new Set((load()?.scope ?? '').split(' '))
  return getSettings().googleActions && ACTION_SCOPES.some((x) => !granted.has(x))
}
export const actionsReady = (): boolean => googleConnected() && getSettings().googleActions && !actionsNeedReconnect()

/** The user's own OAuth client wins; otherwise the client built into this copy of Insight. */
export const googleClient = (): { id: string; secret: string } | null => {
  const own = getSettings().googleClientId.trim()
  if (own) return getSecret('googleClientSecret') ? { id: own, secret: getSecret('googleClientSecret') } : null
  const b = appConfig()
  return b.googleClientId && b.googleClientSecret ? { id: b.googleClientId, secret: b.googleClientSecret } : null
}
export const clientConfigured = (): boolean => !!googleClient()
export const googleBuiltIn = (): boolean => !!appConfig().googleClientId

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  })
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw Object.assign(new Error(`Google token request failed: ${j.error_description ?? j.error ?? res.status}`), { code: j.error })
  return j
}

const emailFromIdToken = (idToken: unknown): string | undefined => {
  try {
    return (JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')) as { email?: string }).email
  } catch {
    return undefined
  }
}

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

let signingIn: Promise<void> | null = null

/** Opens the browser for Google sign-in and waits for the redirect on 127.0.0.1. */
export function connectGoogle(): Promise<void> {
  return (signingIn ??= doConnect().finally(() => (signingIn = null)))
}

async function doConnect(): Promise<void> {
  const s = getSettings()
  void s
  const client = googleClient()
  if (!client) throw new Error('Google sign-in is not set up in this copy of Insight. Add your own OAuth client in Settings > Google account.')
  const clientId = client.id
  const clientSecret = client.secret
  if (!s.googleServices.length) throw new Error('Turn on at least one Google service.')
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(16).toString('hex')
  const scopes = ['openid', 'email', ...new Set([...s.googleServices.flatMap((x) => [...GOOGLE_SERVICES[x].scopes]), ...(s.googleActions ? ACTION_SCOPES : [])])]
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: OAUTH_REDIRECT,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256'
  }).toString()

  const code = await new Promise<string>((resolve, reject) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url ?? '/', OAUTH_REDIRECT)
      if (u.pathname !== '/oauth/callback') {
        res.writeHead(404).end()
        return
      }
      const err = u.searchParams.get('error')
      const c = u.searchParams.get('code')
      const ok = !err && !!c && u.searchParams.get('state') === state
      res
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(`<p style="font:16px system-ui;margin:3em">${ok ? 'Insight is connected to Google. You can close this tab.' : `Sign-in failed: ${escapeHtml(err ?? 'state mismatch')}`}</p>`)
      clearTimeout(timer)
      srv.close()
      if (ok) resolve(c)
      else reject(new Error(`Google sign-in failed: ${err ?? 'state mismatch'}`))
    })
    const timer = setTimeout(() => {
      srv.close()
      reject(new Error('Google sign-in timed out. Try Connect again.'))
    }, 5 * 60_000)
    srv.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Could not listen on port ${OAUTH_PORT} for the sign-in redirect: ${e.message}`))
    })
    srv.listen(OAUTH_PORT, '127.0.0.1', () => void shell.openExternal(auth.toString()))
  })

  const j = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: OAUTH_REDIRECT, client_id: clientId, client_secret: clientSecret })
  const prev = load()
  const refresh = String(j.refresh_token ?? prev?.refresh_token ?? '')
  if (!refresh) throw new Error('Google did not return a refresh token. Remove Insight at myaccount.google.com/permissions and connect again.')
  save({
    access_token: String(j.access_token),
    refresh_token: refresh,
    expires_at: Date.now() + Number(j.expires_in ?? 3600) * 1000,
    scope: String(j.scope ?? scopes.join(' ')),
    email: emailFromIdToken(j.id_token) ?? prev?.email
  })
}

let refreshing: Promise<string> | null = null

/** A valid access token, refreshed when it is about to expire. */
export async function accessToken(): Promise<string> {
  const t = load()
  if (!t) throw new Error('Google is not connected. Open Settings > Google account.')
  if (t.expires_at - 60_000 > Date.now()) return t.access_token
  return (refreshing ??= (async () => {
    try {
      const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: googleClient()?.id ?? '', client_secret: googleClient()?.secret ?? '' })
      const next = { ...t, access_token: String(j.access_token), expires_at: Date.now() + Number(j.expires_in ?? 3600) * 1000, scope: String(j.scope ?? t.scope) }
      save(next)
      return next.access_token
    } catch (e) {
      if ((e as { code?: string }).code === 'invalid_grant') {
        save(null)
        throw new Error('Google sign-in expired or was revoked. Connect again in Settings > Google account.')
      }
      throw e
    } finally {
      refreshing = null
    }
  })())
}

export async function disconnectGoogle(): Promise<void> {
  const t = load()
  save(null)
  if (t) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' }).catch(() => undefined)
}

/** fetch() with the Google bearer token. */
export async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${await accessToken()}`)
  return fetch(url, { ...init, headers })
}
