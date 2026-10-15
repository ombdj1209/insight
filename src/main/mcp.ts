import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { GOOGLE_SERVICES, type GoogleService, type GoogleStatus } from '../shared/google'
import { actionsNeedReconnect, clientConfigured, googleConnected, googleEmail, googleFetch, missingScopes } from './google'
import type { ToolDef } from './llm'
import { getSettings } from './settings'

/** MCP client for the Google Workspace servers. Tools are namespaced `<service>__<tool>` for the model. */
interface Conn {
  client: Client
  tools: ToolDef[]
  /** namespaced name -> server tool name */
  names: Map<string, string>
}

const conns = new Map<GoogleService, Promise<Conn>>()
const errors = new Map<GoogleService, string>()
const MAX_RESULT_CHARS = 12_000
const SEP = '__'

/** Gemini's function schema is a subset of JSON Schema: drop keywords it rejects. */
function cleanSchema(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(cleanSchema)
  if (!v || typeof v !== 'object') return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (['$schema', '$id', '$comment', 'additionalProperties', 'examples', 'deprecated'].includes(k) || k.startsWith('x-')) continue
    if (k === 'format' && x !== 'enum' && x !== 'date-time') continue
    out[k] = k === 'properties' && x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([p, s]) => [p, cleanSchema(s)])) : cleanSchema(x)
  }
  return out
}

function connect(svc: GoogleService): Promise<Conn> {
  let c = conns.get(svc)
  if (!c) {
    c = (async () => {
      const client = new Client({ name: 'insight', version: '0.3.0' })
      const transport = new StreamableHTTPClientTransport(new URL(GOOGLE_SERVICES[svc].url), {
        // fresh bearer token on every request; tokens expire hourly
        fetch: (url, init) => googleFetch(String(url), init as RequestInit)
      })
      await client.connect(transport)
      // read-only: the servers also expose trash, spam, label, create and delete tools, which Ask must never call
      const tools = (await client.listTools()).tools.filter((t) => t.annotations?.readOnlyHint === true)
      errors.delete(svc)
      const names = new Map(tools.map((t) => [`${svc}${SEP}${t.name}`.slice(0, 64), t.name]))
      return {
        client,
        names,
        tools: tools.map((t) => ({
          name: `${svc}${SEP}${t.name}`.slice(0, 64),
          description: `[${GOOGLE_SERVICES[svc].label}] ${t.description ?? t.name}`.slice(0, 1000),
          parameters: (cleanSchema(t.inputSchema) as Record<string, unknown>) ?? { type: 'object', properties: {} }
        }))
      }
    })()
    c.catch((e: Error) => {
      conns.delete(svc)
      errors.set(svc, e.message.slice(0, 240))
    })
    conns.set(svc, c)
  }
  return c
}

export function resetMcp(): void {
  for (const c of conns.values()) void c.then((x) => x.client.close()).catch(() => undefined)
  conns.clear()
  errors.clear()
}

export const mcpAvailable = (): boolean => googleConnected() && getSettings().googleServices.length > 0

/** Tools from every enabled service that connects; a service that fails is skipped and reported in status. */
export async function mcpTools(): Promise<ToolDef[]> {
  if (!mcpAvailable()) return []
  const settled = await Promise.allSettled(getSettings().googleServices.map(connect))
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value.tools : []))
}

export const toolLabel = (name: string): string => {
  if (name.startsWith('outlook__')) return 'Outlook'
  const [svc] = name.split(SEP)
  return GOOGLE_SERVICES[svc as GoogleService]?.label ?? 'Google'
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const i = name.indexOf(SEP)
  const svc = name.slice(0, i) as GoogleService
  if (i < 0 || !GOOGLE_SERVICES[svc]) return `Unknown tool ${name}`
  const conn = await connect(svc)
  const tool = conn.names.get(name)
  if (!tool) return `Unknown tool ${name}`
  try {
    const r = (await conn.client.callTool({ name: tool, arguments: args })) as { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }
    const text =
      (r.content ?? []).map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n') || (r.structuredContent ? JSON.stringify(r.structuredContent) : '')
    const out = (r.isError ? 'Error: ' : '') + (text || '(empty result)')
    return out.length > MAX_RESULT_CHARS ? `${out.slice(0, MAX_RESULT_CHARS)}\n…(truncated)` : out
  } catch (e) {
    return `Error: ${(e as Error).message.slice(0, 400)}`
  }
}

export async function googleStatus(probe = false): Promise<GoogleStatus> {
  const s = getSettings()
  const connected = googleConnected()
  if (probe && connected) await Promise.allSettled(s.googleServices.map(connect))
  const services = await Promise.all(
    s.googleServices.map(async (id) => {
      const c = conns.get(id)
      const tools = c ? await c.then((x) => x.tools.length).catch(() => undefined) : undefined
      return { id, tools, error: errors.get(id) }
    })
  )
  return { clientConfigured: clientConfigured(), connected, email: googleEmail(), missingScopes: connected ? missingScopes() : [], actionsNeedReconnect: connected && actionsNeedReconnect(), services }
}
