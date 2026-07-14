type Row = Record<string, unknown> & {
  _id: string
  _creationTime: number
}

const INDEX_FIELDS: Record<string, string[]> = {
  by_workspace: ['workspaceId'],
  by_workspace_and_device: ['workspaceId', 'deviceId'],
  by_workspace_device: ['workspaceId', 'deviceId'],
  by_workspace_device_date: ['workspaceId', 'deviceId', 'localDate'],
  by_workspace_date: ['workspaceId', 'localDate'],
  by_workspace_block: ['workspaceId', 'blockId'],
  by_workspace_entity: ['workspaceId', 'entityKey'],
  by_workspace_artifact: ['workspaceId', 'artifactId'],
  by_workspace_heartbeat: ['workspaceId', 'heartbeatAt'],
  by_workspace_finished: ['workspaceId', 'finishedAt'],
  by_workspace_failed_at: ['workspaceId', 'failedAt'],
}

class IndexFilter {
  readonly matches: Array<[string, unknown]> = []

  eq(field: string, value: unknown): this {
    this.matches.push([field, value])
    return this
  }
}

class Query {
  private matches: Array<[string, unknown]> = []
  private indexFields: string[] = []
  private direction: 'asc' | 'desc' = 'asc'

  constructor(private readonly rows: () => Row[]) {}

  withIndex(index: string, configure: (filter: IndexFilter) => unknown): this {
    const filter = new IndexFilter()
    configure(filter)
    this.matches = filter.matches
    this.indexFields = INDEX_FIELDS[index] ?? []
    return this
  }

  order(direction: 'asc' | 'desc'): this {
    this.direction = direction
    return this
  }

  async collect(): Promise<Row[]> {
    return this.selected()
  }

  async take(limit: number): Promise<Row[]> {
    return this.selected().slice(0, limit)
  }

  async first(): Promise<Row | null> {
    return this.selected()[0] ?? null
  }

  async unique(): Promise<Row | null> {
    const selected = this.selected()
    if (selected.length > 1) {
      throw new Error(`Expected a unique Convex row, found ${selected.length}`)
    }
    return selected[0] ?? null
  }

  private selected(): Row[] {
    const selected = this.rows().filter((row) =>
      this.matches.every(([field, value]) => row[field] === value),
    )
    const sortFields = this.indexFields.length > 0 ? this.indexFields : ['_creationTime']
    selected.sort((left, right) => {
      for (const field of sortFields) {
        const comparison = compareValues(left[field], right[field])
        if (comparison !== 0) return this.direction === 'desc' ? -comparison : comparison
      }
      return compareValues(left._creationTime, right._creationTime)
    })
    return selected
  }
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0
  if (left === undefined || left === null) return -1
  if (right === undefined || right === null) return 1
  return left < right ? -1 : 1
}

export class InMemoryConvexDatabase {
  private readonly tables = new Map<string, Row[]>()
  private nextId = 1
  private now = 1

  query(table: string): Query {
    return new Query(() => this.table(table))
  }

  async insert(table: string, value: Record<string, unknown>): Promise<string> {
    const id = `${table}:${this.nextId++}`
    this.table(table).push({ ...value, _id: id, _creationTime: this.now++ })
    return id
  }

  async patch(id: string, value: Record<string, unknown>): Promise<void> {
    const row = this.find(id)
    if (!row) throw new Error(`Unknown Convex id: ${id}`)
    Object.assign(row, value)
  }

  async delete(id: string): Promise<void> {
    for (const rows of this.tables.values()) {
      const index = rows.findIndex((row) => row._id === id)
      if (index >= 0) {
        rows.splice(index, 1)
        return
      }
    }
  }

  async get(id: string): Promise<Row | null> {
    return this.find(id) ?? null
  }

  rows(table: string): Row[] {
    return this.table(table).map((row) => structuredClone(row))
  }

  private table(name: string): Row[] {
    const existing = this.tables.get(name)
    if (existing) return existing
    const rows: Row[] = []
    this.tables.set(name, rows)
    return rows
  }

  private find(id: string): Row | undefined {
    for (const rows of this.tables.values()) {
      const row = rows.find((candidate) => candidate._id === id)
      if (row) return row
    }
    return undefined
  }
}
