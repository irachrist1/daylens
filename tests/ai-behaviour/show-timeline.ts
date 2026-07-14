import { stageReadOnlyCopyOfRealDb, cleanupRealDbCopy } from './realDb'

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}
const isTTY = process.stdout.isTTY
const c = (key: keyof typeof ANSI, value: string) => isTTY ? `${ANSI[key]}${value}${ANSI.reset}` : value

function ymd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDuration(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m`
  return `${m}m`
}

interface ComparableBlock {
  startMs: number
  endMs: number
  label: string
}

function equalBlocks(left: ComparableBlock[], right: ComparableBlock[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function printBlockDiff(leftName: string, left: ComparableBlock[], rightName: string, right: ComparableBlock[]): void {
  const count = Math.max(left.length, right.length)
  for (let index = 0; index < count; index += 1) {
    const a = left[index]
    const b = right[index]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    const describe = (block: ComparableBlock | undefined) => block
      ? `${fmtTime(block.startMs)}–${fmtTime(block.endMs)} ${JSON.stringify(block.label)}`
      : '(absent)'
    console.log(c('red', `   [${index}] ${leftName}=${describe(a)} || ${rightName}=${describe(b)}`))
  }
}

async function main(): Promise<void> {
  const dateArg = process.argv[2] ?? ymd(new Date())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    console.error(c('red', `Bad date: ${dateArg}. Use YYYY-MM-DD.`))
    process.exitCode = 2
    return
  }

  const dbCtx = await stageReadOnlyCopyOfRealDb()
  console.log(c('dim', `[setup] coherent DB backup at ${dbCtx.copiedDbPath}`))

  try {
    const { initDb, getDb } = await import('../../src/main/services/database')
    initDb()
    const db = getDb()
    const { userVisibleLabelForBlock, getTimelineDayPayload } = await import('../../src/main/services/workBlocks')
    const { getTimelineDayProjection } = await import('../../src/main/core/query/projections')
    const projection = getTimelineDayProjection(db, dateArg, null, { materialize: false })
    const projectionBlocks = projection.blocks.map((block) => ({
      startMs: block.startTime,
      endMs: block.endTime,
      label: userVisibleLabelForBlock(block),
    }))

    console.log(c('bold', `\n=== Timeline view for ${dateArg} ===\n`))
    console.log(c('bold', 'A) Renderer production projection (GET_TIMELINE_DAY owner):'))
    console.log(c('dim', `   version: ${projection.version} · total: ${fmtDuration(projection.totalSeconds)} · focus: ${fmtDuration(projection.focusSeconds ?? 0)} · blocks: ${projection.blocks.length}`))
    console.log('')
    if (projection.blocks.length === 0) console.log(c('gray', '   (no blocks)'))
    for (const block of projection.blocks) {
      const apps = block.topApps.slice(0, 5).map((app) => app.appName ?? '?').join(', ')
      const pages = block.pageRefs.slice(0, 3).map((page) => page.title ?? page.url ?? '?').join(' | ')
      console.log(`   ${c('cyan', `${fmtTime(block.startTime)}–${fmtTime(block.endTime)}`)} (${fmtDuration((block.endTime - block.startTime) / 1_000)})  ${c('bold', userVisibleLabelForBlock(block))}`)
      if (apps) console.log(c('dim', `      apps: ${apps}`))
      if (pages) console.log(c('dim', `      pages: ${pages}`))
    }

    console.log('')
    console.log(c('bold', 'B) Direct work-block payload parity:'))
    const direct = getTimelineDayPayload(db, dateArg, null, { materialize: false })
    const directBlocks = direct.blocks.map((block) => ({
      startMs: block.startTime,
      endMs: block.endTime,
      label: userVisibleLabelForBlock(block),
    }))
    const directBlocksMatch = equalBlocks(projectionBlocks, directBlocks)
    const directTotalMatches = projection.totalSeconds === direct.totalSeconds
    console.log(`   direct version: ${direct.version} · total: ${fmtDuration(direct.totalSeconds)} · blocks: ${direct.blocks.length}`)
    console.log(directBlocksMatch ? c('green', '   block sequence matches renderer projection.') : c('red', '   block sequence differs from renderer projection.'))
    if (!directBlocksMatch) printBlockDiff('renderer', projectionBlocks, 'direct', directBlocks)
    console.log(directTotalMatches ? c('green', '   tracked total matches renderer projection.') : c('red', `   tracked total differs: renderer=${projection.totalSeconds}s direct=${direct.totalSeconds}s`))
    const directDivergence = Number(!directBlocksMatch) + Number(!directTotalMatches)

    console.log('')
    console.log(c('bold', 'C) Stored timeline index (informational):'))
    const storedRows = db.prepare(`
      SELECT start_time AS startTime, end_time AS endTime, label_current AS label,
             label_source AS labelSource, invalidated_at AS invalidatedAt
      FROM timeline_blocks
      WHERE date = ?
      ORDER BY start_time ASC
    `).all(dateArg) as Array<{
      startTime: number
      endTime: number
      label: string
      labelSource: string
      invalidatedAt: number | null
    }>
    const activeRows = storedRows.filter((row) => row.invalidatedAt == null)
    console.log(c('dim', `   ${activeRows.length} active row(s), ${storedRows.length - activeRows.length} invalidated`))
    for (const row of activeRows) {
      console.log(`   ${c('cyan', `${fmtTime(row.startTime)}–${fmtTime(row.endTime)}`)} ${row.label} ${c('dim', `[${row.labelSource}]`)}`)
    }

    console.log('')
    console.log(c('bold', 'D) AI getDaySummary parity:'))
    const { executeTool } = await import('../../src/main/services/aiTools')
    const summary = executeTool('getDaySummary', { date: dateArg }, db) as {
      blocks: Array<{ startMs: number; endMs: number; label: string }>
      totalTrackedSeconds: number
      _evidence: { topApps: Array<{ appName: string; bundleId: string; totalSeconds: number }> }
    }
    const aiBlocks = summary.blocks.map((block) => ({
      startMs: block.startMs,
      endMs: block.endMs,
      label: block.label,
    }))
    const aiBlocksMatch = equalBlocks(projectionBlocks, aiBlocks)
    const aiTotalMatches = projection.totalSeconds === summary.totalTrackedSeconds
    console.log(aiBlocksMatch ? c('green', '   AI block evidence matches renderer projection.') : c('red', '   AI block evidence differs from renderer projection.'))
    if (!aiBlocksMatch) printBlockDiff('renderer', projectionBlocks, 'AI', aiBlocks)
    console.log(aiTotalMatches ? c('green', '   AI tracked total matches renderer projection.') : c('red', `   AI tracked total differs: renderer=${projection.totalSeconds}s AI=${summary.totalTrackedSeconds}s`))
    const aiDivergence = Number(!aiBlocksMatch) + Number(!aiTotalMatches)

    console.log('')
    console.log(c('bold', 'E) Apps parity:'))
    const { localDayBounds } = await import('../../src/main/lib/localDate')
    const { getCorrectedAppSummariesForRange } = await import('../../src/main/services/activityFacts')
    const [fromMs, toMs] = localDayBounds(dateArg)
    const apps = getCorrectedAppSummariesForRange(db, fromMs, toMs)
    const timelineApps = new Map<string, { name: string; seconds: number }>()
    for (const session of projection.sessions) {
      const key = session.canonicalAppId ?? session.bundleId
      const current = timelineApps.get(key) ?? { name: session.appName, seconds: 0 }
      current.seconds += session.durationSeconds
      timelineApps.set(key, current)
    }
    const appsSurface = new Map(apps.map((app) => [
      app.canonicalAppId ?? app.bundleId,
      { name: app.appName, seconds: app.totalSeconds },
    ]))
    const allAppKeys = [...new Set([...timelineApps.keys(), ...appsSurface.keys()])]
    let appsDivergence = 0
    for (const key of allAppKeys) {
      const timeline = timelineApps.get(key)
      const app = appsSurface.get(key)
      if (timeline?.seconds === app?.seconds) continue
      appsDivergence += 1
      console.log(c('red', `   ${timeline?.name ?? app?.name ?? key}: Timeline=${timeline ? `${timeline.seconds}s` : '(absent)'} Apps=${app ? `${app.seconds}s` : '(absent)'}`))
    }
    const appsTotal = apps.reduce((sum, app) => sum + app.totalSeconds, 0)
    const totalsMatch = projection.totalSeconds === appsTotal
    if (!totalsMatch) {
      appsDivergence += 1
      console.log(c('red', `   tracked total differs: Timeline=${projection.totalSeconds}s Apps=${appsTotal}s`))
    }
    console.log(appsDivergence === 0 ? c('green', '   Apps and Timeline app facts match.') : c('red', `   ${appsDivergence} Apps/Timeline disagreement(s).`))

    const aiAppTotals = new Map(summary._evidence.topApps.map((app) => [app.bundleId, app.totalSeconds]))
    let aiAppDivergence = 0
    for (const [bundleId, seconds] of aiAppTotals) {
      const app = apps.find((candidate) => candidate.bundleId === bundleId)
      if (app?.totalSeconds === seconds) continue
      aiAppDivergence += 1
      console.log(c('red', `   AI/Apps ${bundleId}: AI=${seconds}s Apps=${app?.totalSeconds ?? '(absent)'}`))
    }
    console.log(aiAppDivergence === 0 ? c('green', '   AI top-app facts match Apps.') : c('red', `   ${aiAppDivergence} AI/Apps disagreement(s).`))

    const divergenceCount = directDivergence + aiDivergence + appsDivergence + aiAppDivergence
    console.log('')
    console.log(divergenceCount === 0
      ? c('green', 'PASS: renderer, direct payload, AI, and Apps agree.')
      : c('red', `FAIL: ${divergenceCount} cross-surface divergence(s).`))
    process.exitCode = divergenceCount === 0 ? 0 : 1
  } finally {
    cleanupRealDbCopy(dbCtx)
  }
}

main().catch((error) => {
  console.error(c('red', `[fatal] ${error instanceof Error ? error.stack : String(error)}`))
  process.exitCode = 1
})
