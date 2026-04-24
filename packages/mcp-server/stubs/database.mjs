// Database singleton stub for the MCP server subprocess.
// The MCP server opens its own read-only DB connection and never uses the
// Electron main-process DB singleton.
export function getDb() {
  throw new Error('[mcp-server] getDb() should not be called — pass db explicitly')
}
export function initDb() {}
export function closeDb() {}
