import type Database from 'better-sqlite3'

function ensureMaintenanceRunsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_runs (
      key TEXT PRIMARY KEY,
      completed_at INTEGER NOT NULL
    );
  `)
}

export function hasMaintenanceRun(db: Database.Database, key: string): boolean {
  ensureMaintenanceRunsTable(db)
  const row = db.prepare(`
    SELECT 1
    FROM maintenance_runs
    WHERE key = ?
    LIMIT 1
  `).get(key)
  return Boolean(row)
}

export function markMaintenanceRun(db: Database.Database, key: string, completedAt = Date.now()): void {
  ensureMaintenanceRunsTable(db)
  db.prepare(`
    INSERT INTO maintenance_runs (key, completed_at)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET completed_at = excluded.completed_at
  `).run(key, completedAt)
}
