// MCP tool manifest (ADR 0002). The Daylens MCP server exposes the resolver
// bodies in src/main/services/aiTools.ts to external MCP clients (e.g. Claude
// Desktop). The AI tab itself no longer uses these schemas — it goes through
// the planner + resolver layer (ai/resolvers.ts). These declarations live here,
// co-located with their only consumer, so the AI-tab code path stays free of
// model-facing tool schemas.
const DATE_PARAM = {
  type: 'string',
  description: 'Local calendar date in YYYY-MM-DD format (e.g. "2026-04-21").',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
}

const LIMIT_PARAM = {
  type: 'integer',
  description: 'Maximum number of results to return. Defaults to 25, capped at 100.',
  minimum: 1,
  maximum: 100,
}

// ---------------------------------------------------------------------------
// Anthropic tool schemas
// Spec: https://docs.anthropic.com/en/api/messages#tools
export interface AnthropicTool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, object>
    required?: string[]
  }
}

export const anthropicTools: AnthropicTool[] = [
  {
    name: 'searchSessions',
    description:
      'Full-text search across app sessions and browser page visits by app name, window title, URL, and page title. ' +
      'Use this to find when the user worked in a specific app, on a specific project, ' +
      'studied a topic, consumed web pages, or saw a particular window/page title. Results are sorted by recency.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Keywords to search for in app name and window title. ' +
            'Supports FTS5 operators: AND, OR, NOT, phrase quotes, prefix*.',
        },
        startDate: { ...DATE_PARAM, description: 'Restrict results to sessions starting on or after this date.' },
        endDate: { ...DATE_PARAM, description: 'Restrict results to sessions starting on or before this date.' },
        limit: LIMIT_PARAM,
      },
      required: ['query'],
    },
  },

  {
    name: 'getDaySummary',
    description:
      'Return a structured summary of all tracked activity for a given calendar day: ' +
      'total time, top apps, top websites, timeline block labels, and focus metrics.',
    input_schema: {
      type: 'object',
      properties: {
        date: { ...DATE_PARAM, description: 'The calendar day to summarize.' },
      },
      required: ['date'],
    },
  },

  {
    name: 'getAppUsage',
    description:
      'Return total usage time and session count for a specific application, ' +
      'optionally filtered by date range. Also returns a per-day breakdown ' +
      'and recent window titles so you can infer what the user was doing.',
    input_schema: {
      type: 'object',
      properties: {
        appName: {
          type: 'string',
          description:
            'App display name to look up (case-insensitive partial match, e.g. "Figma", "VS Code", "Chrome").',
        },
        startDate: { ...DATE_PARAM, description: 'Start of the date range (inclusive).' },
        endDate: { ...DATE_PARAM, description: 'End of the date range (inclusive).' },
      },
      required: ['appName'],
    },
  },

  {
    name: 'searchArtifacts',
    description:
      'Search AI-generated artifacts (reports, charts, CSVs, exports) by title and summary. ' +
      'Use this when the user asks about documents or files they generated via the AI.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search in artifact title and summary text.',
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'getWeekSummary',
    description:
      'Return a structured summary for a full calendar week (Mon–Sun): ' +
      'total time, focus percentage, top apps, per-day breakdown, best day, and most active day. ' +
      'Use this for questions about "last week", "this week", or week-over-week comparisons.',
    input_schema: {
      type: 'object',
      properties: {
        weekStartDate: {
          ...DATE_PARAM,
          description:
            'The Monday that starts the target week in YYYY-MM-DD format. ' +
            'To get last week, subtract 7 days from today\'s Monday.',
        },
      },
      required: ['weekStartDate'],
    },
  },

  {
    name: 'getAttributionContext',
    description:
      'Return how much time the user has spent on a specific client or project, ' +
      'based on attribution rules and labeled work sessions. ' +
      'Use this for questions like "how long on ClientX" or "Daylens project time this month".',
    input_schema: {
      type: 'object',
      properties: {
        entityName: {
          type: 'string',
          description:
            'Client or project name to look up. Partial, case-insensitive match. ' +
            'Examples: "ClientX", "Daylens", "acme".',
        },
      },
      required: ['entityName'],
    },
  },

  {
    name: 'searchFileMentions',
    description:
      'Extract filename-like tokens from window title strings in the tracked sessions. ' +
      'Use this when the user asks which files, documents, or code files they had open. ' +
      'Results are INFERRED from title strings — not from file-system events — so ' +
      'always surface the note field to the user so they understand the evidence level.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { ...DATE_PARAM, description: 'Restrict to sessions starting on or after this date.' },
        endDate: { ...DATE_PARAM, description: 'Restrict to sessions starting on or before this date.' },
      },
      required: [],
    },
  },

  {
    name: 'getBlockAtTime',
    description:
      'Return the timeline work block covering a specific moment. Use this for ' +
      'questions like "what was I doing at 4pm" or "what happened yesterday at 3pm". ' +
      'Returns the covering block plus the app sessions overlapping it. ' +
      'If no block covers the moment, `found` is false — do not fabricate an answer.',
    input_schema: {
      type: 'object',
      properties: {
        date: { ...DATE_PARAM, description: 'Calendar day the moment falls on.' },
        time: {
          type: 'string',
          description: 'Local time in 24-hour HH:MM format (e.g. "16:00" for 4 pm, "09:30" for 9:30 am).',
          pattern: '^\\d{2}:\\d{2}$',
        },
      },
      required: ['date', 'time'],
    },
  },

  {
    name: 'listClients',
    description:
      'Return the list of clients Daylens knows about, optionally ranked by ' +
      'attributed time in a date range. Always returns the full client roster ' +
      'from the clients table as `clientRoster`, and additionally returns ' +
      'ranked usage in `attributedClients` when a date range is given or when ' +
      'the most recent week has attributed sessions. Use this for questions ' +
      'like "who are my clients", "list my clients this month".',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { ...DATE_PARAM, description: 'Start of the attribution window (inclusive). Optional — omit for the full client roster.' },
        endDate: { ...DATE_PARAM, description: 'End of the attribution window (inclusive). Optional — omit for the full client roster.' },
      },
      required: [],
    },
  },
]

// ---------------------------------------------------------------------------
// Wrapped data-layer tools (wrapped.md Stage 0.3) — the deeper per-day reads
// behind Wrapped: title semantics, git/calendar signals, baselines,
// distraction split, and the computed surprise. Executed asynchronously via
// executeWrappedTool in src/main/services/wrappedTools.ts.

export const wrappedTools: AnthropicTool[] = [
  {
    name: 'getWindowTitleContext',
    description:
      'The window titles from one app on one day, clustered into semantic groups that describe what the user was '
      + 'doing ("SPCS Build Proposal, 9 sessions") — humanized descriptions, never raw titles. '
      + 'Use this to say WHAT was being done inside an app, not just how long the app was open.',
    input_schema: {
      type: 'object',
      properties: {
        date: DATE_PARAM,
        appName: { type: 'string', description: 'App to inspect ("Cursor", "Safari"). Loose matching is applied.' },
      },
      required: ['date', 'appName'],
    },
  },
  {
    name: 'getGitActivity',
    description:
      'Git activity for a day from the user\'s local repositories: repos touched, commit counts, commit subjects, '
      + 'and PR activity when the gh CLI is available. Returns null when git has nothing for the day.',
    input_schema: { type: 'object', properties: { date: DATE_PARAM }, required: ['date'] },
  },
  {
    name: 'getCalendarEvents',
    description:
      'Calendar events for a day: meeting names, durations, and attendee counts (never attendee names). '
      + 'Returns null when no calendar source is available.',
    input_schema: { type: 'object', properties: { date: DATE_PARAM }, required: ['date'] },
  },
  {
    name: 'getDayComparison',
    description:
      'This day\'s tracked time against the user\'s own 7-day rolling average and the same weekday last week. '
      + 'The evidence behind "this was a long one".',
    input_schema: { type: 'object', properties: { date: DATE_PARAM }, required: ['date'] },
  },
  {
    name: 'getLongestFocusStretch',
    description:
      'The single longest unbroken focused work stretch of the day: start, end, duration, primary app, and the '
      + 'work it was, when a clean name exists.',
    input_schema: { type: 'object', properties: { date: DATE_PARAM }, required: ['date'] },
  },
  {
    name: 'getDistractionProfile',
    description:
      'The split between high-distraction (leisure) and low-distraction time for a day, plus which distraction '
      + 'sites appeared and for how long. Facts, never a score or grade.',
    input_schema: { type: 'object', properties: { date: DATE_PARAM }, required: ['date'] },
  },
  {
    name: 'getMostSurprisingFact',
    description:
      'The single most likely-to-surprise true data point of the day, judged against the user\'s own baseline: '
      + 'the forgotten app, an unusually early or late session, a stretch record, a volume outlier. '
      + 'Returns null on a day with nothing genuinely surprising.',
    input_schema: { type: 'object', properties: { date: DATE_PARAM }, required: ['date'] },
  },
]
