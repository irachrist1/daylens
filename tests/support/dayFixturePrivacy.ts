import type Database from 'better-sqlite3'

export interface DatabaseTextMatch {
  table: string
  column: string
  rowid: number | null
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function findDatabaseTextMatches(
  db: Database.Database,
  term: string,
  onlyTables?: ReadonlySet<string>,
): DatabaseTextMatch[] {
  const needle = normalize(term)
  if (!needle) return []

  const tables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '%_fts%'
      AND name <> 'schema_version'
    ORDER BY name
  `).all() as Array<{ name: string }>

  const matches: DatabaseTextMatch[] = []
  for (const { name } of tables) {
    if (onlyTables && !onlyTables.has(name)) continue
    const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as Array<{ name: string }>
    const rows = db.prepare(`SELECT rowid AS __fixture_rowid, * FROM ${quoteIdentifier(name)}`).all() as Array<Record<string, unknown>>
    for (const row of rows) {
      for (const { name: column } of columns) {
        const value = row[column]
        if (typeof value === 'string' && normalize(value).includes(needle)) {
          matches.push({
            table: name,
            column,
            rowid: typeof row.__fixture_rowid === 'number' ? row.__fixture_rowid : null,
          })
        }
      }
    }
  }
  return matches
}
