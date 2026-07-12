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

// Timestamp variant of hasMaintenanceRun, for callers that need to gate on
// "has it run recently" (e.g. once/day) rather than "has it ever run" (a
// one-off repair). Returns null when the key has never completed.
export function maintenanceRunAt(db: Database.Database, key: string): number | null {
  ensureMaintenanceRunsTable(db)
  const row = db.prepare(`
    SELECT completed_at
    FROM maintenance_runs
    WHERE key = ?
    LIMIT 1
  `).get(key) as { completed_at: number } | undefined
  return row?.completed_at ?? null
}

export function markMaintenanceRun(db: Database.Database, key: string, completedAt = Date.now()): void {
  ensureMaintenanceRunsTable(db)
  db.prepare(`
    INSERT INTO maintenance_runs (key, completed_at)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET completed_at = excluded.completed_at
  `).run(key, completedAt)
}
