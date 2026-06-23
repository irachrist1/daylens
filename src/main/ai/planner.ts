// The planner (ADR 0002, ai.md §4 step 1). Maps a question to one or more
// resolver calls. It NEVER executes anything, never loops, never fetches — it
// only decides what to ask for. Common shapes the deterministic router already
// owns; this handles the long tail the old agentic tool-loop used to.
//
// The long tail uses a SINGLE constrained model call that only emits a
// structured resolver query against the schema below. If it can't map the
// question to any resolver, it returns `{ kind: 'fallback' }` and the caller
// answers conversationally with a real model call (converse.ts) — it never
// falls back to free-form tool calls and never begs the user (ai.md §4.2).
import {
  executeTextAIJob,
  type AITextJobExecutionOptions,
  type ProviderTextResponse,
  type ResolvedProviderConfig,
} from '../services/aiOrchestration'
import { getCurrentTrace } from './trace'
import { RESOLVER_NAMES, type ResolverName, type ResolverQuery } from './resolvers'

export type PlannerRunner = (
  config: ResolvedProviderConfig,
  systemPrompt: string,
  prior: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  options: AITextJobExecutionOptions,
) => Promise<ProviderTextResponse>

export type PlannerResult =
  | { kind: 'queries'; queries: ResolverQuery[] }
  // No resolver maps (a greeting, an aside, general chat). The caller answers
  // this with a real conversational model call (converse.ts) — never a static
  // line (ai.md §4.2, §5).
  | { kind: 'fallback' }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sanitizeQuery(raw: unknown): ResolverQuery | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const resolver = obj.resolver
  if (typeof resolver !== 'string' || !RESOLVER_NAMES.includes(resolver as ResolverName)) return null
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const date = (v: unknown): string | undefined => { const s = str(v); return s && DATE_RE.test(s) ? s : undefined }

  switch (resolver as ResolverName) {
    case 'getDay': {
      const d = date(obj.date)
      return d ? { resolver: 'getDay', date: d } : null
    }
    case 'getRange': {
      const from = date(obj.from)
      const to = date(obj.to)
      return from && to ? { resolver: 'getRange', from, to } : null
    }
    case 'getApp': {
      const app = str(obj.app)
      return app ? { resolver: 'getApp', app, from: date(obj.from), to: date(obj.to) } : null
    }
    case 'getBlockAtTime': {
      const d = date(obj.date)
      const time = str(obj.time)
      return d && time && TIME_RE.test(time) ? { resolver: 'getBlockAtTime', date: d, time } : null
    }
    case 'recall': {
      const query = str(obj.query)
      return query ? { resolver: 'recall', query, from: date(obj.from), to: date(obj.to) } : null
    }
    case 'getAttribution':
      return { resolver: 'getAttribution', entity: str(obj.entity), from: date(obj.from), to: date(obj.to) }
    case 'listClients':
      return { resolver: 'listClients', from: date(obj.from), to: date(obj.to) }
  }
}

function parsePlannerJson(raw: string): ResolverQuery[] | null {
  const fenced = raw.replace(/```(?:json)?/gi, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as { queries?: unknown }
    if (!Array.isArray(parsed.queries)) return null
    return parsed.queries.map(sanitizeQuery).filter((q): q is ResolverQuery => q != null)
  } catch {
    return null
  }
}

// Monday of the week containing `d` — the app counts weeks Monday→Sunday
// (wrappedPeriodRange.ts), so the planner's "last week" must agree or the AI's
// numbers drift from the Timeline.
function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7))
  return r
}

function buildPlannerPrompt(now: Date, trackingStart: string | null): string {
  const today = localDateStr(now)
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const last7 = localDateStr(new Date(now.getTime() - 6 * 86_400_000))
  const last30 = localDateStr(new Date(now.getTime() - 29 * 86_400_000))
  // Exact calendar windows so "last week"/"this month" resolve to the SAME
  // dates every call — never an improvised, drifting range.
  const thisWeekMon = mondayOf(now)
  const lastWeekMon = new Date(thisWeekMon); lastWeekMon.setDate(thisWeekMon.getDate() - 7)
  const lastWeekSun = new Date(thisWeekMon); lastWeekSun.setDate(thisWeekMon.getDate() - 1)
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  return [
    'You are the planner for a personal activity assistant. Map the user question to data-resolver calls.',
    'You DO NOT answer. You DO NOT have the data. You only choose which resolvers to run and with what parameters.',
    'Output ONLY a JSON object: {"queries": [ ... ]}. No prose, no code fences.',
    '',
    `Today is ${weekday}, ${today}. "Last 7 days" = ${last7}..${today}. "Last 30 days" = ${last30}..${today}.`,
    `Weeks run Monday→Sunday. Use these EXACT windows — do not improvise a different range:`,
    `- "this week" = ${localDateStr(thisWeekMon)}..${today}`,
    `- "last week" = ${localDateStr(lastWeekMon)}..${localDateStr(lastWeekSun)} (the previous Monday–Sunday, NOT the last 7 days)`,
    `- "this month" = ${localDateStr(thisMonthStart)}..${today}`,
    `- "last month" = ${localDateStr(lastMonthStart)}..${localDateStr(lastMonthEnd)}`,
    trackingStart ? `Tracking started ${trackingStart}; never ask for dates before it.` : '',
    '',
    'Resolvers (use explicit YYYY-MM-DD local dates, and HH:MM 24h times):',
    '- {"resolver":"getDay","date":"YYYY-MM-DD"} — one day: blocks, totals. Use for "what did I do today/yesterday/on <date>".',
    '- {"resolver":"getRange","from":"YYYY-MM-DD","to":"YYYY-MM-DD"} — a span: per-day blocks + totals. Use for week/month summaries.',
    '- {"resolver":"getApp","app":"<name>","from":"YYYY-MM-DD","to":"YYYY-MM-DD"} — one app\'s time + daily breakdown. from/to optional.',
    '- {"resolver":"getBlockAtTime","date":"YYYY-MM-DD","time":"HH:MM"} — what was happening at a moment.',
    '- {"resolver":"recall","query":"<keywords>","from":"YYYY-MM-DD","to":"YYYY-MM-DD"} — find a page/link/video/article seen in history. from/to optional.',
    '- {"resolver":"getAttribution","entity":"<client/project, optional>","from":"YYYY-MM-DD","to":"YYYY-MM-DD"} — work grouped by client/project.',
    '- {"resolver":"listClients"} — the client/project roster.',
    '',
    'Rules:',
    '- Pick the fewest resolvers that fully answer the question. Usually one.',
    '- Read the conversation so far. People are casual and lean on context. If the user bounces the question back ("you tell me", "go on", "surprise me", "idk you tell me", "what do you think"), or answers vaguely right after you offered to talk about their day, they want their day — default to today: [{"resolver":"getDay","date":"' + today + '"}].',
    '- A bare "what did I do" / "catch me up" / "how was my day" with no timeframe means today.',
    '- If the user doubts or challenges the last answer ("are you sure?", "look harder", "really?", "that can\'t be right", "double-check"), re-run the EXACT same query as the previous turn — same resolver, same app/site, same date window. Never widen the range to find a bigger number; the honest figure does not change because they pushed.',
    '- For "that link/article/video I saw about X", use recall with the topic keywords (drop filler words).',
    '- For time-per-app questions over a period, use getApp with from/to.',
    '- Only return {"queries": []} when there is truly nothing about their activity to fetch — a greeting, general knowledge, math, or pure chit-chat with no pull toward their day.',
    'Output the JSON now.',
  ].filter(Boolean).join('\n')
}

// Cheap deterministic shortcut for the most common long-tail shape — link
// recall — so it never needs a model round-trip.
function recallShortcut(question: string, now: Date): ResolverQuery | null {
  const q = question.toLowerCase()
  if (!/\b(link|url|article|page|site|website|video|watch(?:ed|ing)?|read(?:ing)?|bookmark)\b/.test(q)) return null
  if (!/\b(that|the|find|which|where|saw|seen|forgot|earlier|yesterday|about|on)\b/.test(q)) return null
  const terms = question
    .replace(/[?!.]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !/^(that|this|link|url|article|page|site|website|video|watch|watched|watching|read|reading|about|saw|seen|forgot|which|where|earlier|yesterday|today|find|the|some)$/i.test(w))
    .join(' ')
    .trim()
  if (!terms) return null
  const from = localDateStr(new Date(now.getTime() - 29 * 86_400_000))
  return { resolver: 'recall', query: terms, from, to: localDateStr(now) }
}

export async function planQuestion(
  question: string,
  runner: PlannerRunner,
  options: {
    now?: Date
    trackingStart?: string | null
    /** Recent conversation, so the planner can resolve context-bound asks like
     *  "you tell me" or "go on" to the day they really mean (usually today). */
    prior?: Array<{ role: 'user' | 'assistant'; content: string }>
  } = {},
): Promise<PlannerResult> {
  const now = options.now ?? new Date()
  const trace = getCurrentTrace()

  const shortcut = recallShortcut(question, now)
  if (shortcut) {
    if (trace) trace.addEvent({ kind: 'planner_decision', source: 'shortcut', queries: [shortcut] })
    return { kind: 'queries', queries: [shortcut] }
  }

  let queries: ResolverQuery[] | null = null
  try {
    const { text } = await executeTextAIJob(
      {
        jobType: 'chat_answer',
        screen: 'ai_chat',
        triggerSource: 'user',
        systemPrompt: buildPlannerPrompt(now, options.trackingStart ?? null),
        userMessage: question,
        prior: options.prior,
      },
      runner,
    )
    queries = parsePlannerJson(text)
  } catch {
    queries = null
  }

  if (queries && queries.length > 0) {
    if (trace) trace.addEvent({ kind: 'planner_decision', source: 'model', queries })
    return { kind: 'queries', queries }
  }

  if (trace) trace.addEvent({ kind: 'planner_decision', source: 'fallback', queries: [] })
  return { kind: 'fallback' }
}
