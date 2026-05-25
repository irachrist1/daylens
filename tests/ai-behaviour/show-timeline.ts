// Terminal Timeline viewer — shows what the Timeline view would render for a
// given date, side-by-side with what the AI reads from the DB. Reuses the
// behavioural harness staging (read-only DB copy + electron-real stub).
//
// Run:
//   npm run timeline                # today
//   npm run timeline -- 2026-05-12  # specific date
//
// This is the "show me the logs / show me the view from the terminal" tool.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageReadOnlyCopyOfRealDb, cleanupRealDbCopy } from './realDb'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}
const isTTY = process.stdout.isTTY
const c = (k: keyof typeof ANSI, s: string) => (isTTY ? `${ANSI[k]}${s}${ANSI.reset}` : s)

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

function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m`
  return `${m}m`
}

async function main() {
  const dateArg = process.argv[2] ?? ymd(new Date())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    console.error(c('red', `Bad date: ${dateArg}. Use YYYY-MM-DD.`))
    process.exit(2)
  }

  const dbCtx = stageReadOnlyCopyOfRealDb()
  console.log(c('dim', `[setup] DB copy at ${dbCtx.copiedDbPath}`))

  const { initDb, getDb } = await import('../../src/main/services/database')
  initDb()

  const { getTimelineDayPayload, userVisibleLabelForBlock } = await import('../../src/main/services/workBlocks')
  const db = getDb()

  console.log(c('bold', `\n=== Timeline view for ${dateArg} ===\n`))

  // ─── Side A: what the renderer would show ────────────────────────────────
  const payload = getTimelineDayPayload(db, dateArg)
  console.log(c('bold', `A) Renderer view (getTimelineDayPayload — live recompute from app_sessions):`))
  console.log(c('dim', `   total tracked: ${fmtDuration(payload.totalSeconds * 1000)} · focus: ${fmtDuration((payload.focusSeconds ?? 0) * 1000)} · blocks: ${payload.blocks.length}`))
  console.log('')
  if (payload.blocks.length === 0) {
    console.log(c('gray', '   (no blocks)'))
  }
  for (const b of payload.blocks) {
    const labelText = userVisibleLabelForBlock(b)
    const apps = (b.topApps ?? []).slice(0, 5).map((a) => a.appName ?? '?').join(', ')
    const pages = (b.pageRefs ?? []).slice(0, 3).map((p) => (p as { title?: string; url?: string }).title ?? (p as { url?: string }).url ?? '?').join(' | ')
    const artifacts = (b.topArtifacts ?? []).slice(0, 3).map((a) => (a as { name?: string; path?: string }).name ?? (a as { path?: string }).path ?? '?').join(' | ')
    console.log(`   ${c('cyan', `${fmtTime(b.startTime)}–${fmtTime(b.endTime)}`)} (${fmtDuration(b.endTime - b.startTime)})  ${c('bold', labelText)}`)
    if (apps) console.log(c('dim', `      apps: ${apps}`))
    if (pages) console.log(c('dim', `      pages: ${pages}`))
    if (artifacts) console.log(c('dim', `      artifacts: ${artifacts}`))
  }

  // ─── Side B: persisted timeline_blocks index (NOT the AI source anymore) ─
  // After AI-FIX-STRATEGY F2, the AI tool layer reads block labels via the
  // same live recompute path the renderer uses (Section A). This section is
  // kept for inspection so you can see how badly the persisted labels drift
  // — but the divergence in Section C no longer reaches the user.
  console.log('')
  console.log(c('bold', `B) Stored view (timeline_blocks.label_current — index only; informational):`))
  const storedRows = db.prepare(`
    SELECT
      id,
      start_time AS startTime,
      end_time   AS endTime,
      label_current AS label,
      label_source AS labelSource,
      dominant_category AS dominantCategory,
      heuristic_version AS heuristicVersion,
      invalidated_at AS invalidatedAt
    FROM timeline_blocks
    WHERE date = ?
    ORDER BY start_time ASC
  `).all(dateArg) as Array<{
    id: string
    startTime: number
    endTime: number
    label: string
    labelSource: string
    dominantCategory: string
    heuristicVersion: string
    invalidatedAt: number | null
  }>

  const activeRows = storedRows.filter((r) => r.invalidatedAt == null)
  const invalidatedRows = storedRows.filter((r) => r.invalidatedAt != null)
  console.log(c('dim', `   ${activeRows.length} active row(s), ${invalidatedRows.length} invalidated`))
  console.log('')
  for (const r of activeRows) {
    const sourceColor = r.labelSource === 'artifact' ? 'green' : r.labelSource === 'ai' ? 'yellow' : 'gray'
    console.log(`   ${c('cyan', `${fmtTime(r.startTime)}–${fmtTime(r.endTime)}`)} (${fmtDuration(r.endTime - r.startTime)})  ${c('bold', r.label)}  ${c(sourceColor as keyof typeof ANSI, `[${r.labelSource}]`)}`)
    console.log(c('dim', `      id=${r.id} category=${r.dominantCategory} heuristic=${r.heuristicVersion}`))
  }

  // ─── Side-by-side diff ───────────────────────────────────────────────────
  console.log('')
  console.log(c('bold', `C) Divergence (block start → renderer label || stored label):`))
  const rendererByStart = new Map<number, string>()
  for (const b of payload.blocks) {
    const labelText = userVisibleLabelForBlock(b)
    rendererByStart.set(b.startTime, labelText)
  }
  const storedByStart = new Map<number, string>()
  for (const r of activeRows) {
    if (!storedByStart.has(r.startTime)) storedByStart.set(r.startTime, r.label)
  }
  const allStarts = [...new Set<number>([...rendererByStart.keys(), ...storedByStart.keys()])].sort((a, b) => a - b)
  let diverged = 0
  for (const st of allStarts) {
    const rl = rendererByStart.get(st) ?? '(absent)'
    const sl = storedByStart.get(st) ?? '(absent)'
    const match = rl === sl
    if (!match) diverged += 1
    const tag = match ? c('green', '   match  ') : c('red', '   DIVERGE')
    console.log(`${tag} ${c('cyan', fmtTime(st))}  renderer="${rl}"  ||  stored="${sl}"`)
  }
  console.log('')
  console.log(
    diverged === 0
      ? c('green', `   No divergence on ${dateArg}.`)
      : c('yellow', `   ${diverged}/${allStarts.length} blocks diverge between renderer and stored labels. After F2 this is informational only — AI tools read the renderer path.`)
  )

  // ─── Section D: what AI tools now see ─────────────────────────────────────
  // Exercise the actual AI-facing tool to prove parity with the renderer.
  console.log('')
  console.log(c('bold', `D) What AI tools see now (execGetDaySummary via aiTools):`))
  const { executeTool } = await import('../../src/main/services/aiTools')
  const summary = executeTool('getDaySummary', { date: dateArg }, db) as { timelineBlockLabels: string[] }
  const aiLabels = new Set(summary.timelineBlockLabels)
  const rendererLabels = new Set([...rendererByStart.values()])
  let aiDivergence = 0
  for (const label of aiLabels) {
    if (!rendererLabels.has(label)) aiDivergence += 1
  }
  for (const label of rendererLabels) {
    if (!aiLabels.has(label) && summary.timelineBlockLabels.length >= rendererByStart.size) aiDivergence += 1
  }
  console.log(c('dim', `   AI sees ${aiLabels.size} unique labels; renderer produced ${rendererLabels.size}.`))
  console.log(
    aiDivergence === 0
      ? c('green', `   AI and renderer labels are in sync (Option B holds).`)
      : c('red', `   ${aiDivergence} label(s) differ between AI tool output and renderer.`)
  )

  cleanupRealDbCopy(dbCtx)
  // Exit non-zero only when the AI surface itself disagrees with the
  // renderer. Renderer-vs-stored divergence is no longer a build break.
  process.exit(aiDivergence > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(c('red', `[fatal] ${err instanceof Error ? err.stack : String(err)}`))
  process.exit(1)
})
