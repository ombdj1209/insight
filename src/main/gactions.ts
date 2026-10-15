import { actionsNeedReconnect, googleConnected, googleFetch } from './google'
import { getSettings } from './settings'

/**
 * Google write actions. Direct REST calls (no model in the loop), each triggered by an explicit confirm click in the app.
 * Drafts are never sent; events invite only the attendees the user confirmed.
 */
function requireActions(): void {
  if (!googleConnected()) throw new Error('Connect your Google account in Settings > Google account first.')
  if (!getSettings().googleActions) throw new Error('Turn on "Allow actions" in Settings > Google account.')
  if (actionsNeedReconnect()) throw new Error('Reconnect Google in Settings > Google account to allow drafts, tasks and events.')
}

async function ok(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`${what} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 240)}`)
  return (await res.json()) as Record<string, unknown>
}

/** RFC 2047 encoded-word for non-ASCII headers */
const header = (s: string): string => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`)
const validEmail = (e: string): boolean => /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(e)

export async function createDraft(p: { to: string[]; subject: string; body: string }): Promise<{ url: string }> {
  requireActions()
  const to = p.to.filter(validEmail)
  const mime = [
    to.length ? `To: ${to.join(', ')}` : '',
    `Subject: ${header(p.subject.replace(/[\r\n]+/g, ' '))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(p.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
  ]
    .filter((l, i) => l !== '' || i === 5)
    .join('\r\n')
  const res = await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw: Buffer.from(mime, 'utf8').toString('base64url') } })
  })
  await ok(res, 'Creating the Gmail draft')
  return { url: 'https://mail.google.com/mail/u/0/#drafts' }
}

export async function addTasks(items: { title: string; notes?: string; due?: string | null }[]): Promise<{ added: number; url: string }> {
  requireActions()
  let added = 0
  for (const it of items.slice(0, 25)) {
    const body: Record<string, string> = { title: it.title.slice(0, 1000) }
    if (it.notes) body.notes = it.notes.slice(0, 8000)
    if (it.due && /^\d{4}-\d{2}-\d{2}$/.test(it.due)) body.due = `${it.due}T00:00:00.000Z`
    const res = await googleFetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    await ok(res, 'Adding to Google Tasks')
    added++
  }
  return { added, url: 'https://tasks.google.com/' }
}

export async function createEvent(p: { title: string; start: number; minutes: number; attendees: string[]; description?: string; meet: boolean }): Promise<{ url: string }> {
  requireActions()
  if (!(p.start > Date.now() - 60_000)) throw new Error('Pick a time in the future.')
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const iso = (ms: number): string => new Date(ms).toISOString()
  const body: Record<string, unknown> = {
    summary: p.title,
    description: p.description,
    start: { dateTime: iso(p.start), timeZone: tz },
    end: { dateTime: iso(p.start + Math.max(5, p.minutes) * 60_000), timeZone: tz },
    attendees: p.attendees.filter(validEmail).map((email) => ({ email }))
  }
  if (p.meet) body.conferenceData = { createRequest: { requestId: `insight-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  const q = new URLSearchParams({ conferenceDataVersion: '1', sendUpdates: p.attendees.length ? 'all' : 'none' })
  const res = await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const j = await ok(res, 'Booking the meeting')
  return { url: String(j.htmlLink ?? 'https://calendar.google.com/') }
}

/** Most recent message the user sent to `email` since `since` (evidence that a promise was kept). Read-only. */
export async function lastSentTo(email: string, since: number): Promise<{ subject: string; date: number } | null> {
  if (!googleConnected() || !validEmail(email)) return null
  const d = new Date(since)
  const q = `in:sent to:${email} after:${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  const res = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: '1' })}`)
  if (!res.ok) return null
  const j = (await res.json()) as { messages?: { id: string }[] }
  const id = j.messages?.[0]?.id
  if (!id) return null
  const m = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject`)
  if (!m.ok) return null
  const mj = (await m.json()) as { internalDate?: string; payload?: { headers?: { name: string; value: string }[] } }
  return { subject: mj.payload?.headers?.find((h) => h.name === 'Subject')?.value ?? '(no subject)', date: Number(mj.internalDate ?? Date.now()) }
}
