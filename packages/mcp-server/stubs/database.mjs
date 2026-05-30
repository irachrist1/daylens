// Database singleton stub for the MCP server subprocess.
// The MCP server opens its own read-only DB connection and never uses the
// Electron main-process DB singleton.
export function getDb() {
  throw new Error('[mcp-server] getDb() should not be called — pass db explicitly')
}
export function initDb() {}
export function closeDb() {}
export function tableExists(db, tableName) {
  const row = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(tableName)
  return Boolean(row)
}
