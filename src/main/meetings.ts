import type { AssistCard, Citation, Meeting, SearchHit, SegmentPayload, TranscriptLine } from '../shared/types'
import { slidesForNotes } from './slides'
import { templateById } from '../shared/templates'
import { activeEngine, transcribe } from './asr'
import { assignSpeaker } from './diarize'
import { fmtTime, indexMeeting, meetingSourceId, search, vectorSearch } from './ingest'
import { chat, isCloudAi } from './llm'
import { getSettings } from './settings'
import { getMeeting, saveMeeting, saveSegmentAudio } from './store'
import { emit, SerialQueue, uid } from './util'

const asrQueue = new SerialQueue()
let lastAsrError = 0

export function markCloud(m: Meeting, what: 'audio' | 'notes' | 'chat'): void {
  m.cloudUsed ??= []
  if (!m.cloudUsed.includes(what)) m.cloudUsed.push(what)
}

// ---------- transcript ----------

const tokens = (t: string): Set<string> => {
  const out = new Set<string>()
  const clean = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
  for (const w of clean.split(/\s+/)) {
    if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(w)) for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2))
    else if (w.length > 1) out.add(w)
  }
  return out
}

function similar(a: string, b: string): boolean {
  const A = tokens(a)
  const B = tokens(b)
  if (!A.size || !B.size) return false
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / Math.min(A.size, B.size) >= 0.7 || inter / (A.size + B.size - inter) >= 0.5
}

const near = (a: TranscriptLine, b: { startMs: number; endMs: number }): boolean =>
  Math.abs(a.startMs - b.startMs) < 6000 || Math.abs(a.endMs - b.endMs) < 6000

function asrErrorMessage(msg: string): string {
  let gemma = false
  try {
    gemma = activeEngine() === 'gemma'
  } catch {
    /* no engine */
  }
  if (gemma && /audio|mmproj|multimodal/i.test(msg))
    return 'Gemma could not read audio with this llama.cpp build. Pick SenseVoice, Parakeet or Whisper in Settings > Speech recognition.'
  return `Transcription failed: ${msg.slice(0, 200)}`
}

export function handleSegment(p: SegmentPayload): void {
  emit('asr:busy', { pending: asrQueue.pending + 1 })
  void asrQueue.push(async () => {
    try {
      const wav = Buffer.from(p.wav)
      saveSegmentAudio(p.meetingId, `${p.startMs}-${p.channel}.wav`, wav)
      let text = ''
      let engine = ''
      try {
        ;({ text, engine } = await transcribe(wav))
      } catch (e) {
        if (Date.now() - lastAsrError > 15000) {
          lastAsrError = Date.now()
          emit('toast', { kind: 'error', message: asrErrorMessage((e as Error).message) })
        }
        return
      }
      if (!text) return
      const m = getMeeting(p.meetingId)
      if (!m) return
      const s = getSettings()
      if (engine === 'cloud') markCloud(m, 'audio')
      let speakerId: string | undefined
      try {
        speakerId = await assignSpeaker(m, p.channel, wav)
      } catch (e) {
        console.warn('speaker id failed', e)
      }
      const fallbackName = p.channel === 'mic' ? s.userName || 'You' : 'Others'
      const line: TranscriptLine = {
        id: uid(),
        channel: p.channel,
        speaker: speakerId ? m.speakers?.[speakerId] ?? fallbackName : fallbackName,
        speakerId,
        startMs: p.startMs,
        endMs: p.endMs,
        text,
        engine
      }
      if (s.echoFilter && !s.inRoomMode) {
        if (p.channel === 'mic' && m.transcript.some((l) => l.channel === 'system' && near(l, line) && similar(l.text, text))) return
        if (p.channel === 'system') {
          const echoes = m.transcript.filter((l) => l.channel === 'mic' && near(l, line) && similar(l.text, text))
          for (const e of echoes) emit('transcript:remove', { meetingId: m.id, lineId: e.id })
          m.transcript = m.transcript.filter((l) => !echoes.includes(l))
        }
      }
      m.transcript.push(line)
      m.transcript.sort((a, b) => a.startMs - b.startMs)
      m.durationMs = Math.max(m.durationMs, p.endMs)
      saveMeeting(m)
      emit('transcript:line', { meetingId: m.id, line })
      if (line.speakerId && m.speakers) emit('transcript:update', { meetingId: m.id, transcript: m.transcript, speakers: m.speakers })
      const fromOthers = p.channel === 'system' || (s.inRoomMode && line.speaker !== (s.userName || 'You'))
      if (fromOthers) void liveAssist(m.id, line)
    } finally {
      emit('asr:busy', { pending: Math.max(0, asrQueue.pending - 1) })
    }
  })
}

export function renameSpeaker(meetingId: string, speakerId: string, name: string): Meeting {
  const m = getMeeting(meetingId)
  if (!m) throw new Error('Meeting not found')
  m.speakers = { ...(m.speakers ?? {}), [speakerId]: name }
  m.transcript = m.transcript.map((l) => (l.speakerId === speakerId ? { ...l, speaker: name } : l))
  saveMeeting(m)
  emit('transcript:update', { meetingId, transcript: m.transcript, speakers: m.speakers })
  return m
}

// ---------- Live Assistance ----------

const QUESTION =
  /[?？]\s*$|(か|でしょうか|ですか|ますか|かな|っけ)[。]?$|^(what|why|how|when|where|who|whom|which|can|could|do|does|did|is|are|was|were|will|would|should|shall|have|has|any idea|remind me)\b/i
let assistBusy = false
const topicState = new Map<string, { lastAt: number; shown: Set<string> }>()

function lastQuestion(text: string): string | null {
  const sentences = text.split(/(?<=[.!?？。])\s*/).map((s) => s.trim()).filter(Boolean)
  for (let i = sentences.length - 1; i >= 0; i--) {
    const q = sentences[i]
    const long = /[\u3040-\u30ff\u3400-\u9fff]/.test(q) ? q.length >= 6 : q.split(/\s+/).length >= 3
    if (QUESTION.test(q) && long) return q
  }
  return null
}

const toCitations = (hits: SearchHit[]): Citation[] =>
  hits.map((h, i) => ({
    n: i + 1,
    chunkId: h.chunkId,
    title: h.title,
    path: h.path,
    loc: h.loc,
    snippet: h.text.slice(0, 360),
    kind: h.kind,
    label: h.label,
    score: h.score
  }))

export const sourcesBlock = (hits: SearchHit[]): string =>
  hits.map((h, i) => `[${i + 1}] ${h.title}${h.loc ? ` (${h.loc})` : ''}\n${h.text}`).join('\n\n')

const ASSIST_SYSTEM = `You are Live Assistance inside a meeting notetaker. Someone in the meeting just asked a question.
Answer it for the user in 1-3 short sentences using ONLY the numbered sources. Cite sources inline like [1] or [2].
Quote exact figures, names and dates from the sources. Answer in the language the question was asked in.
If the sources do not answer the question, reply exactly: NONE`

function pushCard(meetingId: string, card: AssistCard): void {
  const m = getMeeting(meetingId)
  if (m) {
    m.assist.push(card)
    if (card.kind === 'answer' && isCloudAi()) markCloud(m, 'chat')
    saveMeeting(m)
  }
  emit('assist:card', { meetingId, card })
}

export async function assist(meetingId: string, question: string, atMs: number, force = false): Promise<AssistCard | null> {
  const s = getSettings()
  const hits = await search(question, 4, { excludeSourceIds: [meetingSourceId(meetingId)] })
  const best = Math.max(0, ...hits.map((h) => h.score))
  if (!hits.length || (!force && best < s.liveAssistThreshold)) return null
  const answer = await chat(
    [
      { role: 'system', content: ASSIST_SYSTEM },
      { role: 'user', content: `Sources:\n${sourcesBlock(hits)}\n\nQuestion asked in the meeting: ${question}` }
    ],
    { temperature: 0.1, maxTokens: 220 }
  )
  const none = !answer || /^NONE\b/i.test(answer)
  if (none && !force) return null
  const used = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1])))
  const citations = toCitations(hits).filter((c) => used.size === 0 || used.has(c.n))
  const card: AssistCard = {
    id: uid(),
    kind: 'answer',
    atMs,
    question,
    answer: none ? 'Nothing in your sources answers this. Closest matches are below.' : answer,
    citations
  }
  for (const c of citations) topicState.get(meetingId)?.shown.add(c.chunkId)
  pushCard(meetingId, card)
  return card
}

/** Topic cards: when the conversation moves onto something in your files, surface it without being asked. */
async function topicAssist(meetingId: string, line: TranscriptLine): Promise<void> {
  const s = getSettings()
  const st = topicState.get(meetingId) ?? { lastAt: 0, shown: new Set<string>() }
  topicState.set(meetingId, st)
  if (Date.now() - st.lastAt < 25_000) return
  const m = getMeeting(meetingId)
  if (!m) return
  const window = m.transcript
    .filter((l) => l.startMs >= line.startMs - 45_000 && l.startMs <= line.startMs)
    .map((l) => l.text)
    .join(' ')
  if (window.length < 40) return
  const hits = await vectorSearch(window.slice(-600), 3, { excludeSourceIds: [meetingSourceId(meetingId)] })
  const fresh = hits.filter((h) => !st.shown.has(h.chunkId) && h.score >= s.liveAssistThreshold + 0.1)
  if (!fresh.length) return
  st.lastAt = Date.now()
  fresh.forEach((h) => st.shown.add(h.chunkId))
  pushCard(meetingId, {
    id: uid(),
    kind: 'context',
    atMs: line.startMs,
    question: line.text.length > 140 ? `${line.text.slice(0, 140)}…` : line.text,
    answer: '',
    citations: toCitations(fresh.slice(0, 2))
  })
}

async function liveAssist(meetingId: string, line: TranscriptLine): Promise<void> {
  const s = getSettings()
  if (!s.liveAssist || assistBusy) return
  assistBusy = true
  try {
    const q = lastQuestion(line.text)
    if (q) await assist(meetingId, q, line.startMs)
    else if (s.topicAssist) await topicAssist(meetingId, line)
  } catch (e) {
    console.warn('assist failed', e)
  } finally {
    assistBusy = false
  }
}

// ---------- Enhanced notes ----------

const estTokens = (t: string): number => {
  const cjk = (t.match(/[\u3000-\u9fff\uac00-\ud7af]/g) ?? []).length
  return cjk + Math.ceil((t.length - cjk) / 3.6)
}

const ENHANCE_SYSTEM = `You turn a person's rough shorthand meeting notes into polished notes, using the meeting transcript.
Rules:
- The person's own notes are the backbone. Every shorthand bullet they wrote becomes a heading or bullet in your output, expanded with specifics from the transcript: who said what, numbers, dates, reasons, open questions.
- Put important points they did not write down under "## Also discussed".
- End with "## Action items" (owner - task - due date if mentioned) and "## Decisions" when the transcript contains any.
- Add a short exact quote with its [mm:ss] timestamp only when the wording matters.
- Speaker names come from the transcript labels; keep them as given.
- Never invent facts that are not in the notes or transcript.
- Detect the main spoken language of the transcript and write the whole output in that language, headings included (e.g. a Japanese meeting gets Japanese notes, with headings like "## 決定事項" and "## アクションアイテム").
- Output Markdown only, no preamble.`

const CONDENSE_SYSTEM = `Condense this part of a meeting transcript into dense bullet points. Keep every name, number, date, decision, commitment and question, with [mm:ss] timestamps. Keep the original language. No preamble.`

const transcriptText = (m: Meeting): string[] => m.transcript.map((l) => `[${fmtTime(l.startMs)}] ${l.speaker}: ${l.text}`)

export async function fitTranscript(m: Meeting): Promise<string> {
  const s = getSettings()
  const lines = transcriptText(m)
  const transcript = lines.join('\n')
  // Cloud models have far larger windows than the local 2-slot server
  const budget = isCloudAi() ? 200_000 : Math.floor(s.contextSize / 2) - 3500
  if (estTokens(transcript) <= budget) return transcript
  const parts: string[] = []
  let cur = ''
  for (const l of lines) {
    if (estTokens(cur + l) > budget * 0.8 && cur) {
      parts.push(cur)
      cur = ''
    }
    cur += l + '\n'
  }
  if (cur) parts.push(cur)
  const condensed: string[] = []
  for (const p of parts)
    condensed.push(await chat([{ role: 'system', content: CONDENSE_SYSTEM }, { role: 'user', content: p }], { maxTokens: 1500, temperature: 0.1 }))
  return condensed.join('\n')
}

export async function enhanceNotes(meetingId: string): Promise<string> {
  const m = getMeeting(meetingId)
  if (!m) throw new Error('Meeting not found')
  if (!m.transcript.length && !m.notes.trim()) throw new Error('Nothing to enhance yet. Record the meeting or write some notes first.')
  const tpl = templateById(m.template ?? getSettings().noteTemplate)
  const transcript = await fitTranscript(m)
  const slides = slidesForNotes(m.id)
  let streamed = ''
  const out = await chat(
    [
      { role: 'system', content: ENHANCE_SYSTEM + (tpl.instructions ? `\n- Meeting type: ${tpl.label}. ${tpl.instructions}` : '') },
      {
        role: 'user',
        content: `My notes:\n${m.notes.trim() || '(no notes - summarise the meeting)'}\n\nMeeting transcript:\n${transcript || '(no transcript)'}${slides ? `\n\nSlides shown on screen (text read from the screen, with timestamps):\n${slides}` : ''}`
      }
    ],
    {
      maxTokens: 2500,
      temperature: 0.2,
      onDelta: (d) => {
        streamed += d
        emit('enhance:delta', { meetingId, text: streamed })
      }
    }
  )
  const fresh = getMeeting(meetingId)!
  fresh.enhanced = out
  delete fresh.translation // stale once the notes change; the UI keeps the language for a one-click redo
  if (isCloudAi()) markCloud(fresh, 'notes')
  if (/^Meeting /.test(fresh.title)) {
    try {
      const t = await chat(
        [{ role: 'user', content: `Write a title of at most 6 words for these meeting notes, in the notes' language. Output only the title.\n\n${out.slice(0, 3000)}` }],
        { maxTokens: 24, temperature: 0.2 }
      )
      const title = t.replace(/^["#*\s]+|["*\s]+$/g, '').split('\n')[0]
      if (title) fresh.title = title
    } catch {
      /* keep default title */
    }
  }
  saveMeeting(fresh)
  void indexMeeting(fresh).catch(() => undefined)
  return out
}

export async function draftFollowUp(meetingId: string, language: string, tone: 'formal' | 'friendly'): Promise<string> {
  const m = getMeeting(meetingId)
  if (!m) throw new Error('Meeting not found')
  const basis = m.enhanced || (await fitTranscript(m))
  if (!basis.trim()) throw new Error('Nothing to base a follow-up on yet.')
  const style =
    language === 'Japanese'
      ? tone === 'formal'
        ? 'Japanese business email in proper keigo (尊敬語・謙譲語), with a 件名 line, an opening greeting (いつもお世話になっております), the body, and a closing (何卒よろしくお願い申し上げます).'
        : 'polite but light Japanese email (です・ます調), with a 件名 line.'
      : tone === 'formal'
        ? `formal business email written in ${language}, using that language's business conventions, with a first line "Subject: …" (the word "Subject" may be in ${language}).`
        : `friendly, concise email written in ${language}, with a first line "Subject: …" (the word "Subject" may be in ${language}).`
  const out = await chat(
    [
      {
        role: 'system',
        content: `Write a follow-up email after a meeting as a ${style} Thank the attendees, recap decisions, list action items with owners and dates, and state the next step. Use only facts from the notes. Leave [placeholders] for names you do not know. Output only the email.`
      },
      { role: 'user', content: `Meeting: ${m.title}\n\n${basis}` }
    ],
    { maxTokens: 900, temperature: 0.3 }
  )
  const fresh = getMeeting(meetingId)!
  fresh.followUp = out
  if (isCloudAi()) markCloud(fresh, 'notes')
  saveMeeting(fresh)
  return out
}

/** Translate the enhanced notes; the notes themselves stay in the meeting's own (auto-detected) language. */
export async function translateNotes(meetingId: string, language: string): Promise<string> {
  const m = getMeeting(meetingId)
  if (!m) throw new Error('Meeting not found')
  const target = language.trim()
  if (!target) throw new Error('Enter a language to translate into.')
  if (!m.enhanced.trim()) throw new Error('Enhance the notes first, then translate them.')
  const out = await chat(
    [
      {
        role: 'system',
        content: `Translate the user's Markdown meeting notes into ${target}. Keep the Markdown structure, headings, bullets, [mm:ss] timestamps, numbers, dates and people's names exactly. Translate headings too. Use natural business wording for ${target}. Output only the translation.`
      },
      { role: 'user', content: m.enhanced }
    ],
    { maxTokens: 3000, temperature: 0.1 }
  )
  const fresh = getMeeting(meetingId)!
  fresh.translation = { language: target, text: out }
  if (isCloudAi()) markCloud(fresh, 'notes')
  saveMeeting(fresh)
  return out
}

export function meetingMarkdown(m: Meeting): string {
  const d = new Date(m.createdAt)
  return [
    `# ${m.title}`,
    `${d.toLocaleString()}${m.durationMs ? ` · ${fmtTime(m.durationMs)}` : ''}`,
    m.enhanced ? `## Notes\n\n${m.enhanced}` : '',
    m.translation ? `## Notes (${m.translation.language})\n\n${m.translation.text}` : '',
    m.notes.trim() ? `## My notes\n\n${m.notes.trim()}` : '',
    m.followUp ? `## Follow-up email\n\n${m.followUp}` : '',
    m.transcript.length ? `## Transcript\n\n${transcriptText(m).join('  \n')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

export async function finishMeeting(meetingId: string, durationMs: number): Promise<void> {
  await asrQueue.push(async () => undefined) // let queued segments finish
  topicState.delete(meetingId)
  const m = getMeeting(meetingId)
  if (!m) return
  m.status = 'done'
  m.durationMs = Math.max(m.durationMs, durationMs)
  saveMeeting(m)
  await indexMeeting(m).catch(() => undefined)
}
