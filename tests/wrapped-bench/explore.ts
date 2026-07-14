// One-off explorer (not a test): stage a read-only copy of the real DB, then for
// every date with activity, build the real DayWrapFacts and the planned day-deck
// slide ids, so we can pick fixture days that collectively cover every slide type
// in the catalog. Also reports which provider key is present so the benchmark
// knows it can call real AI.
//
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
//     --loader ./tests/support/ts-loader-real.mjs ./tests/wrapped-bench/explore.ts

import { stageReadOnlyCopyOfRealDb, cleanupRealDbCopy } from '../ai-behaviour/realDb'

async function main(): Promise<void> {
  const dbCtx = await stageReadOnlyCopyOfRealDb()
  const { initDb, getDb } = await import('../../src/main/services/database')
  initDb()
  const db = getDb()

  const { getApiKey, getSettings } = await import('../../src/main/services/settings')
  const settings = getSettings()
  console.log(`[provider] aiProvider=${settings.summaryVoice ? '' : ''}${(settings as { aiProvider?: string }).aiProvider ?? '(unset)'} summaryVoice=${settings.summaryVoice}`)
  for (const p of ['anthropic', 'openai', 'google'] as const) {
    const k = await getApiKey(p).catch(() => null)
    console.log(`[key] ${p}: ${k ? 'present' : 'missing'}`)
  }

  const { buildDayWrapFacts } = await import('../../src/renderer/lib/dayWrapScenes')
  const { planDayWrapSlides } = await import('../../src/renderer/lib/wrapDeck')
  const { getTimelineDayPayload } = await import('../../src/main/services/workBlocks')

  // Every date that has any session, newest first.
  const dates = (db.prepare(
    `SELECT DISTINCT date(start_time/1000,'unixepoch','localtime') d
     FROM app_sessions ORDER BY d DESC`,
  ).all() as Array<{ d: string }>).map((r) => r.d)

  const coverage = new Map<string, string[]>() // slide id -> dates that produce it
  const rows: Array<{ date: string; quality: string; active: number; slides: string[] }> = []

  for (const date of dates) {
    let payload
    try { payload = getTimelineDayPayload(db, date, null) } catch { continue }
    let facts
    try { facts = buildDayWrapFacts(payload) } catch { continue }
    if (facts.quality === 'empty') continue
    const slides = planDayWrapSlides(facts).filter((s) => s.ask).map((s) => s.id)
    rows.push({ date, quality: facts.quality, active: Math.round(facts.activeSeconds / 60), slides })
    for (const id of slides) {
      if (!coverage.has(id)) coverage.set(id, [])
      coverage.get(id)!.push(date)
    }
  }

  console.log(`\n=== ${rows.length} days with usable activity ===`)
  // Print the 25 richest days (most slide types) as fixture candidates.
  const richest = rows.slice().sort((a, b) => b.slides.length - a.slides.length).slice(0, 25)
  for (const r of richest) {
    console.log(`${r.date}  q=${r.quality}  ${r.active}m  [${r.slides.length}] ${r.slides.join(',')}`)
  }

  console.log(`\n=== slide-type coverage (id: #days, e.g. dates) ===`)
  const allIds = [...coverage.keys()].sort()
  for (const id of allIds) {
    const ds = coverage.get(id)!
    console.log(`${id.padEnd(16)} ${String(ds.length).padStart(3)} days  e.g. ${ds.slice(0, 4).join(', ')}`)
  }

  // Which day-slide catalog ids never appear in any real day (so I know the gaps).
  const catalog = ['opening', 'headline', 'story-lateNight', 'story-morning', 'story-midday', 'story-evening', 'focus', 'timesink', 'apps', 'split', 'earlystart', 'latenight', 'forgotten', 'meetings', 'wildcard']
  const missing = catalog.filter((id) => !coverage.has(id))
  console.log(`\n=== catalog day-slides with NO real coverage: ${missing.length ? missing.join(', ') : '(none — all covered)'} ===`)

  cleanupRealDbCopy(dbCtx)
}

main().catch((e) => { console.error(e); process.exit(1) })
