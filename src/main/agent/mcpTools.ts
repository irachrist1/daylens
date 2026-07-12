// MCP client for the chat agent (ADR 0003): connects to the MCP servers the
// user has configured and exposes their tools to the loop. MCP is the one
// interface for "whatever's installed on this laptop" — never a parallel
// plugin system. Config lives in settings (`mcpServers`), same shape as
// Claude Desktop's { command, args, env } entries. Servers that fail to start
// are skipped with a warning; a broken server never breaks chat.
import { createMCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import type { ToolSet } from 'ai'

export interface McpServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpToolPool {
  tools: ToolSet
  close: () => Promise<void>
}

const CONNECT_TIMEOUT_MS = 8_000

export async function connectMcpTools(servers: McpServerConfig[]): Promise<McpToolPool> {
  const clients: Array<{ close: () => Promise<void> }> = []
  const tools: ToolSet = {}

  await Promise.all(servers.map(async (server) => {
    try {
      const client = await Promise.race([
        createMCPClient({
          transport: new StdioMCPTransport({
            command: server.command,
            args: server.args ?? [],
            env: { ...process.env as Record<string, string>, ...(server.env ?? {}) },
          }),
        }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('connect timeout')), CONNECT_TIMEOUT_MS)
        }),
      ])
      clients.push(client)
      const serverTools = await client.tools()
      for (const [name, toolDef] of Object.entries(serverTools)) {
        // Namespace to avoid collisions between servers and with built-ins.
        tools[`mcp_${server.name}_${name}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64)] = toolDef
      }
    } catch (error) {
      console.warn(`[agent:mcp] skipping server "${server.name}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }))

  return {
    tools,
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()))
    },
  }
}
