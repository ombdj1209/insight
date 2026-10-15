import type { ChatMessage, ChatScope, Citation, SearchHit } from '../shared/types'
import { fmtTime, meetingSourceId, rememberAnswer, search } from './ingest'
import { chat, chatWithTools, isCloudAi } from './llm'
import { callMcpTool, mcpAvailable, mcpTools, toolLabel } from './mcp'
import { callMsTool, msConnected, msTools } from './microsoft'
import { markCloud, sourcesBlock } from './meetings'
import { getSettings } from './settings'
import { getMeeting, saveMeeting } from './store'
import { emit, uid } from './util'

const CHAT_SYSTEM = `You are Insight, an on-device assistant over the user's personal knowledge: their files, calendar, bookmarks and past meetings.
Answer using the numbered sources. Cite every claim inline with [n]. Prefer exact figures, names and dates from the sources.
If the sources do not contain the answer, say so plainly and suggest what to add. Use concise Markdown.`

const agentSystem = (): string => `You are Insight, the user's assistant. You can read their Google account (Gmail, Calendar, Chat) and Microsoft 365 (Outlook mail and calendar) with the provided tools, and you get numbered local sources: files, past meetings and answers remembered from earlier lookups.
- Use the numbered sources first. Cite them inline with [n].
- Call tools when the question needs the user's mail, calendar, chats, files or contacts, or when a remembered answer may be outdated (anything about "today", "latest", "unread", "next", or a time window). Search narrowly: use the sender, subject words, date range or attendee from the question.
- For facts from tools, name where they came from in plain words, e.g. (Gmail, from Tanaka, 3 Oct) or (Calendar). Never invent message content, times or people.
- If nothing relevant is found, say what you searched.
- Answer in the language of the question. Concise Markdown.
Now: ${new Date().toString()}.`

export async function ask(
  requestId: string,
  question: string,
  scope: ChatScope,
  history: Pick<ChatMessage, 'role' | 'content'>[]
): Promise<{ answer: string; citations: Citation[] }> {
  const hits: SearchHit[] = []
  if (scope.meetingId) {
    const m = getMeeting(scope.meetingId)
    if (m && m.transcript.length) {
      // live meeting transcript is always source [1] in meeting chat (it may not be indexed yet)
      const tail = m.transcript.map((l) => `[${fmtTime(l.startMs)}] ${l.speaker}: ${l.text}`).join('\n').slice(-14000)
      hits.push({ chunkId: `live:${m.id}`, title: m.title, loc: 'Live transcript', text: tail, kind: 'meeting', label: 'Meetings', sourceId: meetingSourceId(m.id), score: 1 })
    }
  }
  const found = await search(question, scope.meetingId ? 5 : 8, {
    labels: scope.labels,
    kinds: scope.kinds,
    excludeSourceIds: scope.meetingId ? [meetingSourceId(scope.meetingId)] : undefined
  })
  hits.push(...found)
  const user = `Sources:\n${hits.length ? sourcesBlock(hits) : '(no matching sources)'}\n\nQuestion: ${question}`
  const past = history.slice(-6).map((h) => ({ role: h.role, content: h.content }))

  let answer: string
  // Google tools only in the main Ask page; meeting chat stays on the transcript and local knowledge
  const tools = scope.meetingId ? [] : [...(mcpAvailable() ? await mcpTools() : []), ...(msConnected() ? msTools() : [])]
  if (tools.length) {
    emit('chat:status', { requestId, text: 'Thinking' })
    const r = await chatWithTools([{ role: 'system', content: agentSystem() }, ...past, { role: 'user', content: user }], tools, (name, args) => (name.startsWith('outlook__') ? callMsTool(name, args) : callMcpTool(name, args)), {
      maxTokens: 1400,
      onTool: (name) => emit('chat:status', { requestId, text: `Searching ${toolLabel(name)}` })
    })
    answer = r.answer
    emit('chat:delta', { requestId, text: answer })
    if (r.results.length && answer && getSettings().rememberAnswers) {
      const details = r.results
        .map((x) => `${toolLabel(x.tool)}: ${x.result}`)
        .join('\n')
        .slice(0, 2500)
      void rememberAnswer(question, answer, details).catch((e) => console.warn('remember failed', e))
    }
  } else {
    answer = await chat([{ role: 'system', content: CHAT_SYSTEM }, ...past, { role: 'user', content: user }], {
      maxTokens: 1200,
      temperature: 0.3,
      onDelta: (text) => emit('chat:delta', { requestId, text })
    })
  }
  if (scope.meetingId && isCloudAi()) {
    const m = getMeeting(scope.meetingId)
    if (m) {
      markCloud(m, 'chat')
      saveMeeting(m)
    }
  }
  const used = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1])))
  const citations: Citation[] = hits
    .map((h, i) => ({ n: i + 1, chunkId: h.chunkId, title: h.title, path: h.path, loc: h.loc, snippet: h.chunkId.startsWith('live:') ? h.text.slice(-360) : h.text.slice(0, 360), kind: h.kind, label: h.label, score: h.score }))
    .filter((c) => used.has(c.n))
  return { answer, citations }
}

export const newId = uid
