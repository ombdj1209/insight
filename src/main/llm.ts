import { baseUrl, ensureRuntime, isReady } from './runtime'
import { getSecret } from './secrets'
import { getSettings } from './settings'

export type Part =
  | { type: 'text'; text: string }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' } }
  | { type: 'image_url'; image_url: { url: string } }

export interface Msg {
  role: 'system' | 'user' | 'assistant'
  content: string | Part[]
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** Messages in a tool loop. Assistant turns are echoed back verbatim (Gemini 3 needs its thought signatures). */
type LoopMsg = Msg | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] } | { role: 'tool'; tool_call_id: string; content: string }

interface ChatOpts {
  maxTokens?: number
  temperature?: number
  onDelta?: (text: string) => void
  signal?: AbortSignal
  /** Force the local Gemma server (audio transcription) regardless of the AI provider setting. */
  local?: boolean
}

interface Endpoint {
  url: string
  headers: Record<string, string>
  model?: string
  local: boolean
}

export const isCloudAi = (): boolean => getSettings().aiProvider !== 'local'

function endpoint(forceLocal: boolean): Endpoint {
  const s = getSettings()
  if (forceLocal || s.aiProvider === 'local') return { url: `${baseUrl('llm')}/v1/chat/completions`, headers: {}, local: true }
  if (s.aiProvider === 'gemini') {
    const key = getSecret('gemini')
    if (!key) throw new Error('Add your Gemini API key in Settings > AI model.')
    return {
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      headers: { Authorization: `Bearer ${key}` },
      model: s.geminiModel,
      local: false
    }
  }
  const key = getSecret('openai')
  return {
    url: `${s.openaiBaseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    model: s.openaiModel,
    local: false
  }
}

/** Strip leaked reasoning blocks some chat templates emit inline. */
const clean = (t: string): string =>
  t
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '')
    .replace(/<\|channel\|>analysis[\s\S]*?<\|message\|>/g, '')
    .trim()

export async function chat(messages: Msg[], opts: ChatOpts = {}): Promise<string> {
  const ep = endpoint(!!opts.local)
  if (ep.local && !isReady('llm')) await ensureRuntime()
  const stream = !!opts.onDelta
  const body: Record<string, unknown> = {
    messages,
    stream,
    temperature: opts.temperature ?? 0.3,
    max_tokens: (opts.maxTokens ?? 1024) * (ep.local ? 1 : 2)
  }
  if (ep.model) body.model = ep.model
  if (ep.local) body.chat_template_kwargs = { enable_thinking: false }
  const res = await fetch(ep.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ep.headers },
    signal: opts.signal,
    body: JSON.stringify(body)
  })
  if (!res.ok) throw await failure(ep, res)
  if (!stream) {
    const j = (await res.json()) as { choices: { message: { content: string } }[] }
    return clean(j.choices[0]?.message?.content ?? '')
  }
  let full = ''
  let buf = ''
  const decoder = new TextDecoder()
  const reader = res.body!.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data) as { choices: { delta?: { content?: string } }[] }
        const d = j.choices[0]?.delta?.content
        if (d) {
          full += d
          opts.onDelta!(d)
        }
      } catch {
        /* partial line */
      }
    }
  }
  return clean(full)
}

const failure = async (ep: Endpoint, res: Response): Promise<Error> => {
  const who = ep.local ? 'Gemma' : getSettings().aiProvider === 'gemini' ? 'Gemini' : 'AI provider'
  return new Error(`${who} request failed (HTTP ${res.status}): ${(await res.text()).slice(0, 400)}`)
}

/**
 * Tool-calling loop over the OpenAI-compatible endpoint: the model calls tools until it can answer.
 * Returns the final answer and the tool results it read.
 */
export async function chatWithTools(
  messages: Msg[],
  tools: ToolDef[],
  run: (name: string, args: Record<string, unknown>) => Promise<string>,
  opts: { maxTokens?: number; temperature?: number; maxRounds?: number; onTool?: (name: string) => void } = {}
): Promise<{ answer: string; results: { tool: string; args: string; result: string }[] }> {
  const ep = endpoint(false)
  if (ep.local && !isReady('llm')) await ensureRuntime()
  const convo: LoopMsg[] = [...messages]
  const results: { tool: string; args: string; result: string }[] = []
  const maxRounds = opts.maxRounds ?? 6
  for (let round = 0; ; round++) {
    const last = round >= maxRounds
    const body: Record<string, unknown> = {
      messages: convo,
      temperature: opts.temperature ?? 0.2,
      max_tokens: (opts.maxTokens ?? 1200) * (ep.local ? 1 : 2)
    }
    // on the last round, force a written answer from what was gathered
    if (tools.length && !last) body.tools = tools.map((t) => ({ type: 'function', function: t }))
    if (ep.model) body.model = ep.model
    if (ep.local) body.chat_template_kwargs = { enable_thinking: false }
    const res = await fetch(ep.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ep.headers }, body: JSON.stringify(body) })
    if (!res.ok) throw await failure(ep, res)
    const j = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] } & Record<string, unknown> }[] }
    const msg = j.choices[0]?.message
    if (!msg) throw new Error('The AI model returned no answer.')
    if (!msg.tool_calls?.length || last) return { answer: clean(msg.content ?? ''), results }
    convo.push({ ...msg, role: 'assistant', content: msg.content ?? null })
    for (const call of msg.tool_calls) {
      opts.onTool?.(call.function.name)
      let args: Record<string, unknown> = {}
      try {
        args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {}
      } catch {
        /* model sent malformed JSON; call with no arguments */
      }
      const result = await run(call.function.name, args)
      results.push({ tool: call.function.name, args: call.function.arguments, result })
      convo.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }
}

// EmbeddingGemma task prompts
const queryPrompt = (q: string): string => `task: search result | query: ${q}`
const docPrompt = (title: string, text: string): string => `title: ${title || 'none'} | text: ${text}`

function normalize(v: number[], dims: number): Float32Array {
  const out = new Float32Array(dims)
  let n = 0
  for (let i = 0; i < dims; i++) {
    out[i] = v[i] ?? 0
    n += out[i] * out[i]
  }
  n = Math.sqrt(n) || 1
  for (let i = 0; i < dims; i++) out[i] /= n
  return out
}

/** Embeddings always run locally (EmbeddingGemma 2 is small enough for any CPU). */
export async function embed(inputs: { text: string; title?: string }[], mode: 'query' | 'doc'): Promise<Float32Array[]> {
  if (!inputs.length) return []
  if (!isReady('embedder')) await ensureRuntime()
  const dims = getSettings().embedDims
  const out: Float32Array[] = []
  for (let i = 0; i < inputs.length; i += 16) {
    const batch = inputs.slice(i, i + 16).map((x) => (mode === 'query' ? queryPrompt(x.text) : docPrompt(x.title ?? '', x.text)))
    const res = await fetch(`${baseUrl('embedder')}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: batch, model: 'embeddinggemma-2' })
    })
    if (!res.ok) throw new Error(`Embedding request failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`)
    const j = (await res.json()) as { data: { index: number; embedding: number[] }[] }
    j.data.sort((a, b) => a.index - b.index).forEach((d) => out.push(normalize(d.embedding, dims)))
  }
  return out
}

export async function describeImage(buf: Buffer, mime: string): Promise<string> {
  return chat(
    [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } },
          {
            type: 'text',
            text: 'Describe this image for a search index: transcribe any visible text exactly, then summarise what the diagram, chart, slide or photo shows in 2-4 sentences.'
          }
        ]
      }
    ],
    { temperature: 0.1, maxTokens: 400 }
  )
}
