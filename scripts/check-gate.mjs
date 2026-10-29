// Checks the download gate in worker/index.js with an in-memory KV, R2 and a fake Resend.
// node scripts/check-gate.mjs
import assert from 'node:assert/strict'
import worker from '../worker/index.js'

const kv = new Map()
const env = {
  SITE_ORIGINS: 'https://ombdj1209.github.io,http://localhost:5173',
  INSTALLER_KEY: 'Insight-Setup-0.5.0.exe',
  LINK_SECRET: 'x'.repeat(40),
  RESEND_API_KEY: 'test',
  DB: { get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => void kv.set(k, v) },
  FILES: { get: async (k) => (k === 'Insight-Setup-0.5.0.exe' ? { body: 'MZ', size: 2 } : null) }
}
const mails = []
globalThis.fetch = async (url, o) => { mails.push(JSON.parse(o.body)); return new Response('{}') }

const post = (body, origin = 'https://ombdj1209.github.io', ip = '1.1.1.1') =>
  worker.fetch(new Request('https://gate.test/api/register', { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env)
const get = (path) => worker.fetch(new Request('https://gate.test' + path), env)

// wrong origin, bad input, throwaway mail
assert.equal((await post({ name: 'Ann', email: 'ann@example.com' }, 'https://evil.test')).status, 403)
assert.equal((await post({ name: 'A', email: 'ann@example.com' })).status, 400)
assert.equal((await post({ name: 'Ann', email: 'nope' })).status, 400)
assert.equal((await post({ name: 'Ann', email: 'ann@mailinator.com' })).status, 400)

// sign-up: the response carries no link; the link only goes to the email
const r = await post({ name: 'Ann Lee', email: 'Ann@Example.com', mac: true }, undefined, '2.2.2.2')
const body = await r.json()
assert.equal(r.status, 200)
assert.deepEqual(Object.keys(body).sort(), ['position', 'ref'])
assert.equal(body.position, 1)
const link = mails.at(-1).html.match(/https:\/\/gate\.test\/d\/[\w.-]+/)[0]
assert.ok(!JSON.stringify(body).includes('/d/'))

// same person again keeps the number; a referral counts
assert.equal((await (await post({ name: 'Ann Lee', email: 'ann@example.com' }, undefined, '2.2.2.3')).json()).position, 1)
assert.equal((await (await post({ name: 'Bo', email: 'bo@example.com', ref: body.ref }, undefined, '2.2.2.4')).json()).position, 2)
assert.equal(kv.get(`n:invites:${body.ref}`), '1')

// download: valid link streams once-counted; tampered and expired links fail
const ok = await get(new URL(link).pathname)
assert.equal(ok.status, 200)
assert.match(ok.headers.get('Content-Disposition'), /Insight-Setup-0\.5\.0\.exe/)
await get(new URL(link).pathname)
assert.equal(kv.get('n:downloads'), '1')
const [p, s] = new URL(link).pathname.slice(3).split('.')
const forged = Buffer.from(JSON.stringify({ e: 'ann@example.com', x: Date.now() + 1e9 })).toString('base64url')
assert.equal((await get(`/d/${forged}.${s}`)).status, 403)
assert.equal((await get(`/d/${p}.AAAA`)).status, 403)
const { sign } = (await import('../worker/index.js'))._test
assert.equal((await get('/d/' + (await sign(env, { e: 'ann@example.com', x: Date.now() - 1 })))).status, 410)

// stats are real counts; per-email rate limit kicks in
const st = await (await get('/api/stats')).json()
assert.deepEqual([st.people, st.downloads, st.mac, st.recent.length], [2, 1, 1, 2])
assert.equal(st.recent[0].n, 'B.')
assert.equal((await post({ name: 'Ann Lee', email: 'ann@example.com' }, undefined, '2.2.2.5')).status, 200)
assert.equal((await post({ name: 'Ann Lee', email: 'ann@example.com' }, undefined, '2.2.2.6')).status, 429)

// no Resend key yet: friendly 503
delete env.RESEND_API_KEY
assert.equal((await post({ name: 'Cy', email: 'cy@example.com' }, undefined, '3.3.3.3')).status, 503)
console.log('gate ok')
