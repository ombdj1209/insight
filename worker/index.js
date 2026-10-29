// Insight download gate (Cloudflare Worker).
// The site never sees the installer URL: a sign-up mails a signed, expiring link through Resend,
// and /d/<token> streams the installer from a private R2 bucket. Nothing in the page can be edited
// in DevTools to skip this, because the only thing that unlocks the file is a token we signed.
//
// Routes
//   POST /api/register  { name, email, mac?, ref?, hp?, turnstile? } -> { position, ref }
//   GET  /api/stats     -> { people, downloads, mac, recent: [{ n, c, t }] }
//   GET  /d/<token>     -> the installer (attachment)

const LINK_HOURS = 48
const RECENT = 12
// ponytail: small blocklist; swap for a maintained list if throwaway sign-ups become a problem
const THROWAWAY = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com'])
const EMAIL = /^[^\s@<>"']{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const cors = corsHeaders(req, env)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    try {
      if (url.pathname === '/api/register' && req.method === 'POST') return json(await register(req, env), 200, cors)
      if (url.pathname === '/api/stats' && req.method === 'GET') return json(await stats(env), 200, { ...cors, 'Cache-Control': 'public, max-age=15' })
      if (url.pathname.startsWith('/d/')) return await download(url.pathname.slice(3), env)
      return new Response('Not found', { status: 404 })
    } catch (e) {
      if (e instanceof UserError) return json({ error: e.message }, e.status, cors)
      console.error(e)
      return json({ error: 'Something went wrong on our side. Try again in a minute.' }, 500, cors)
    }
  }
}

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || ''
  const allowed = (env.SITE_ORIGINS || '').split(',').map((s) => s.trim())
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {}
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

async function register(req, env) {
  const origin = req.headers.get('Origin') || ''
  if (!(env.SITE_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin)) throw new UserError('Sign up from the Insight website.', 403)
  if (Number(req.headers.get('Content-Length') || 0) > 4096) throw new UserError('Too large.', 413)
  const b = await req.json().catch(() => ({}))
  if (b.hp) return { position: 0, ref: '' } // honeypot filled: a bot, answer quietly

  const name = String(b.name || '').replace(/[\u0000-\u001f<>]/g, '').trim()
  const email = String(b.email || '').trim().toLowerCase()
  if (name.length < 2 || name.length > 80) throw new UserError('Please enter your name.')
  if (!EMAIL.test(email) || email.length > 254) throw new UserError('That email doesn’t look right.')
  if (THROWAWAY.has(email.split('@')[1])) throw new UserError('Please use an email you’ll keep. The link goes there.')

  const ip = req.headers.get('CF-Connecting-IP') || '0'
  await limit(env, `rl:ip:${ip}`, 6, 3600, 'Too many tries from this network. Try again in an hour.')
  await limit(env, `rl:mail:${email}`, 3, 3600, 'We already sent a few links to this address. Check your inbox and spam folder.')
  if (env.TURNSTILE_SECRET) await turnstile(b.turnstile, ip, env)

  const country = req.cf?.country || ''
  const key = `u:${email}`
  let user = await env.DB.get(key, 'json')
  if (!user) {
    const position = (await count(env, 'people', 1))
    user = { name, position, country, mac: !!b.mac, at: Date.now(), ref: (await hmac(env, `ref:${email}`)).slice(0, 8), by: cleanRef(b.ref), dl: false }
    await env.DB.put(key, JSON.stringify(user))
    await env.DB.put(`ref:${user.ref}`, email)
    if (user.mac) await count(env, 'mac', 1)
    if (user.by && (await env.DB.get(`ref:${user.by}`))) await count(env, `invites:${user.by}`, 1)
    const recent = (await env.DB.get('recent', 'json')) || []
    recent.unshift({ n: name.split(/\s+/)[0].slice(0, 1).toUpperCase() + '.', c: country, t: Date.now() })
    await env.DB.put('recent', JSON.stringify(recent.slice(0, RECENT)))
  }

  const token = await sign(env, { e: email, x: Date.now() + LINK_HOURS * 3600e3 })
  await sendMail(env, email, user.name, `${new URL(req.url).origin}/d/${token}`, user)
  return { position: user.position, ref: user.ref }
}

async function stats(env) {
  const [people, downloads, mac, recent] = await Promise.all([
    count(env, 'people', 0), count(env, 'downloads', 0), count(env, 'mac', 0), env.DB.get('recent', 'json')
  ])
  return { people, downloads, mac, recent: recent || [] }
}

async function download(token, env) {
  const p = await verify(env, token)
  if (!p) return page('This link is invalid.', 'Ask for a new one on the Insight website.', env, 403)
  if (p.x < Date.now()) return page('This link has expired.', `Links last ${LINK_HOURS} hours. Ask for a fresh one on the Insight website.`, env, 410)
  const key = `u:${p.e}`
  const user = await env.DB.get(key, 'json')
  if (!user) return page('This link is invalid.', 'Ask for a new one on the Insight website.', env, 403)
  if (!user.dl) {
    user.dl = true
    await env.DB.put(key, JSON.stringify(user))
    await count(env, 'downloads', 1)
  }
  const obj = env.FILES && (await env.FILES.get(env.INSTALLER_KEY))
  if (!obj) return page('The installer is being updated.', 'Try this same link again in a few minutes.', env, 503)
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/vnd.microsoft.portable-executable',
      'Content-Disposition': `attachment; filename="${env.INSTALLER_KEY}"`,
      'Content-Length': String(obj.size),
      'Cache-Control': 'private, no-store'
    }
  })
}

// ponytail: KV read-modify-write is not atomic; two sign-ups in the same instant can share a number.
// Fine at launch scale. Move counters to a Durable Object if that ever matters.
async function count(env, name, add) {
  const n = Number((await env.DB.get(`n:${name}`)) || 0) + add
  if (add) await env.DB.put(`n:${name}`, String(n))
  return n
}

async function limit(env, key, max, ttl, message) {
  const n = Number((await env.DB.get(key)) || 0)
  if (n >= max) throw new UserError(message, 429)
  await env.DB.put(key, String(n + 1), { expirationTtl: ttl })
}

async function turnstile(token, ip, env) {
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(token || ''), remoteip: ip })
  })
  if (!(await r.json()).success) throw new UserError('Please complete the check and try again.', 403)
}

const cleanRef = (r) => (/^[a-f0-9]{8}$/.test(String(r || '')) ? String(r) : '')

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function key(env) {
  if (!env.LINK_SECRET || env.LINK_SECRET.length < 32) throw new Error('LINK_SECRET is missing or shorter than 32 characters')
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.LINK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function hmac(env, text) {
  const sig = await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(text))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sign(env, payload) {
  const body = b64u(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(body))
  return `${body}.${b64u(sig)}`
}

async function verify(env, token) {
  const [body, sig] = String(token).split('.')
  if (!body || !sig) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(env), unb64u(sig), new TextEncoder().encode(body))
    return ok ? JSON.parse(new TextDecoder().decode(unb64u(body))) : null
  } catch {
    return null
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

async function sendMail(env, to, name, link, user) {
  if (!env.RESEND_API_KEY) throw new UserError('Downloads open in a moment. We’re finishing setup.', 503)
  const first = esc(name.split(/\s+/)[0])
  const site = (env.SITE_ORIGINS || '').split(',')[0]
  const html = `<!doctype html><html><body style="margin:0;background:#f1f3f4;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1f1f1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:28px" cellpadding="0" cellspacing="0"><tr><td style="padding:40px">
<p style="margin:0 0 8px;font-size:14px;color:#5f6368">Insight for Windows</p>
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;font-weight:600">Here’s your download, ${first}.</h1>
<p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#444746">You’re number ${user.position.toLocaleString('en-US')} to get Insight. The link below works for ${LINK_HOURS} hours.</p>
<a href="${esc(link)}" style="display:inline-block;background:#0b57d0;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:999px">Download Insight</a>
<p style="margin:28px 0 0;font-size:14px;line-height:1.6;color:#5f6368">Windows 10 or 11. Run the installer and Insight opens by itself. Pip will be waiting.</p>
${site ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#5f6368">Bring your team: <a href="${esc(site)}/?ref=${user.ref}" style="color:#0b57d0">${esc(site)}/?ref=${user.ref}</a></p>` : ''}
</td></tr></table>
<p style="margin:20px 0 0;font-size:12px;color:#80868b">You asked for this link on the Insight website. If it wasn’t you, ignore this email.</p>
</td></tr></table></body></html>`
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'Insight <onboarding@resend.dev>',
      to: [to],
      subject: 'Your Insight download link',
      html,
      text: `Hi ${name.split(/\s+/)[0]},\n\nDownload Insight for Windows (link works for ${LINK_HOURS} hours):\n${link}\n\nIf you didn’t ask for this, ignore this email.`
    })
  })
  if (!r.ok) {
    console.error('resend', r.status, await r.text())
    throw new UserError('We couldn’t send the email. Check the address and try again.', 502)
  }
}

function page(title, text, env, status) {
  const site = esc((env.SITE_ORIGINS || '').split(',')[0] || '/')
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Insight</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f1f3f4;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1f1f1f;padding:16px">
<main style="max-width:440px;background:#fff;border-radius:28px;padding:40px;text-align:center"><h1 style="font-size:24px;margin:0 0 12px">${esc(title)}</h1>
<p style="color:#444746;line-height:1.6;margin:0 0 24px">${esc(text)}</p><a href="${site}" style="display:inline-block;background:#0b57d0;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600">Go to the website</a></main>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

// exported for scripts/check-gate.mjs
export const _test = { sign, verify, EMAIL }
