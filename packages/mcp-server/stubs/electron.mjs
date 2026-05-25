// Minimal Electron stub for the MCP server subprocess.
// The MCP server imports aiTools.ts which transitively imports database.ts
// which imports electron. Since the MCP server never calls getDb()/initDb(),
// only the import binding needs to exist — the functions are never called.
export const app = {
  getPath: () => '',
  getAppPath: () => '',
  isPackaged: false,
}
export const shell = {}
export const ipcMain = { handle: () => {}, on: () => {} }
export const BrowserWindow = class {}
export default { app, shell, ipcMain, BrowserWindow }
