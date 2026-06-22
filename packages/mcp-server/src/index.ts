// Daylens MCP server — stdio transport, wraps aiTools.ts executors.
// Spawned by Claude Desktop (or another MCP client) via the config snippet
// shown in Daylens Settings.
//
// Required env: DAYLENS_DB_PATH (absolute path to daylens.sqlite)
// Set env ELECTRON_RUN_AS_NODE=1 when launching via the Daylens binary.
import Database from 'better-sqlite3'
import { Server } from '@modelcontextprotocol/sdk/server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import os from 'node:os'
import path from 'node:path'
import { executeTool } from '../../../src/main/services/aiTools'
import type { TrackingControlsState } from '../../../src/shared/trackingControls'
import { anthropicTools } from './tools'

const dbPath =
  process.env.DAYLENS_DB_PATH ??
  path.join(os.homedir(), 'Library', 'Application Support', 'Daylens', 'daylens.sqlite')

const db = new Database(dbPath, { readonly: true })
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')

// The subprocess can't reach the Electron settings store, so the current
// exclusion set is handed in by env (see mcpServer.ts). Without this the MCP
// boundary would have no exclusion list and excluded apps/sites could leave the
// machine through an MCP client. System noise is stripped regardless.
function envList(name: string): string[] {
  try {
    const parsed = JSON.parse(process.env[name] ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

const trackingControls: TrackingControlsState = {
  enabled: process.env.DAYLENS_TRACKING_CONTROLS_ENABLED === '1',
  paused: false,
  excludedApps: envList('DAYLENS_TRACKING_EXCLUDED_APPS'),
  excludedSites: envList('DAYLENS_TRACKING_EXCLUDED_SITES'),
  skipIncognito: true,
}

process.on('exit', () => { try { db.close() } catch { /* ignore */ } })
process.on('SIGTERM', () => { db.close(); process.exit(0) })
process.on('SIGINT', () => { db.close(); process.exit(0) })

const server = new Server(
  { name: 'daylens', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: anthropicTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  try {
    const result = executeTool(
      name as Parameters<typeof executeTool>[0],
      (args ?? {}) as Record<string, unknown>,
      db,
      trackingControls,
    )
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  } catch (err) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    }
  }
})

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
