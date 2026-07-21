// Screen-context paired evaluation (DEV-198; screen-context.md §Evaluation).
// The experiment is a measurement with ship-or-kill criteria. What must hold:
//   - every pair answers the SAME question twice — once without and once with
//     screen evidence — through injected answerers, and stores both;
//   - a tester's verdict is the only review mutation;
//   - the report is built from aggregates and reviewed labels ONLY: no
//     question, answer, OCR, or title text can appear anywhere in it;
//   - the numeric ship criteria are computed and recorded whatever the
//     verdict, and criteria this build cannot measure (real machines,
//     batteries, adversarial rigs) are explicitly 'unmeasured' with reasons;
//   - the pairs table is local-only: withheld from the full-history export
//     and named in the omissions manifest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  buildScreenExperimentReport,
  listEvalPairs,
  recordEvalVerdict,
  runPairedEvalCase,
  screenEvalAvailable,
  type PairedAnswerers,
} from '../src/main/services/screenContext/pairedEval.ts'
import { insertFrameRecord, transitionFrameState, commitExtractionResult, getFrameRecord } from '../src/main/services/screenContext/repository.ts'
import { planHistoryExport } from '../src/main/services/historyExport.ts'

const SECRET_QUESTION = 'What was in the SECRET_Q_MARKER acquisition doc?'
const SECRET_BASELINE = 'Baseline answer SECRET_A_MARKER without screen'
const SECRET_SCREEN = 'Screen answer SECRET_B_MARKER with screen'

function scriptedAnswerers(log: Array<{ question: string; withScreen: boolean }>): PairedAnswerers {
  return {
    async answer(question, options) {
      log.push({ question, withScreen: options.withScreenEvidence })
      return options.withScreenEvidence ? SECRET_SCREEN : SECRET_BASELINE
    },
  }
}

function seedExtractedFrame(db: ReturnType<typeof createProductionTestDatabase>, useful: boolean, capturedAt: number, indexDelayMs: number): void {
  const frame = insertFrameRecord(db, {
    capturedAt,
    trigger: 'interval',
    appBundleId: 'com.apple.Numbers',
    appName: 'Numbers',
    displayId: 1,
    exclusionPolicyVersion: 1,
    localPath: `/fake/eval/${capturedAt}.scframe`,
    byteSize: 10,
  })
  transitionFrameState(db, frame.id, 'extracting')
  const originalNow = Date.now
  // Pin the evidence commit time so latency percentiles are deterministic.
  Date.now = () => capturedAt + indexDelayMs
  try {
    commitExtractionResult(db, getFrameRecord(db, frame.id)!, {
      docTitle: useful ? 'Budget SECRET_OCR_MARKER worksheet' : null,
      ocrSpans: useful ? ['row 12 SECRET_OCR_MARKER'] : [],
      subjectRefs: [],
      extractorModel: 'fixture',
      extractorSchemaVersion: 1,
      confidence: 1,
    }, `digest_${capturedAt}`)
  } finally {
    Date.now = originalNow
  }
}

test('migration v64 creates the pairs table; a pair answers twice and stores both, and the verdict is recorded', async () => {
  const db = createProductionTestDatabase()
  assert.equal(screenEvalAvailable(db), true, 'v64 table exists after migrations')

  const log: Array<{ question: string; withScreen: boolean }> = []
  const pair = await runPairedEvalCase(db, {
    targetKind: 'untitled_native_doc',
    question: SECRET_QUESTION,
  }, scriptedAnswerers(log))

  assert.deepEqual(log.map((entry) => entry.withScreen), [false, true], 'same question, baseline first, then with screen evidence')
  assert.equal(log[0].question, log[1].question)
  assert.equal(pair.baselineAnswer, SECRET_BASELINE)
  assert.equal(pair.screenAnswer, SECRET_SCREEN)
  assert.equal(pair.verdict, null, 'unreviewed until a tester decides')

  const reviewed = recordEvalVerdict(db, pair.id, 'screen_more_specific')
  assert.equal(reviewed?.verdict, 'screen_more_specific')
  assert.ok(reviewed?.reviewedAt)
  assert.equal(listEvalPairs(db).length, 1)
  db.close()
})

test('the report aggregates verdicts and derived-record usefulness, and computes the numeric ship criteria', async () => {
  const db = createProductionTestDatabase()
  const answerers = scriptedAnswerers([])
  const kinds = ['untitled_native_doc', 'generic_window_title', 'visual_research', 'false_context_risk'] as const
  const pairs = []
  for (const kind of kinds) {
    pairs.push(await runPairedEvalCase(db, { targetKind: kind, question: SECRET_QUESTION }, answerers))
  }
  recordEvalVerdict(db, pairs[0].id, 'screen_more_accurate')
  recordEvalVerdict(db, pairs[1].id, 'screen_more_specific')
  recordEvalVerdict(db, pairs[2].id, 'unchanged')
  recordEvalVerdict(db, pairs[3].id, 'screen_worse')

  // Three useful derived records, one empty one; deterministic latencies.
  const base = 1_800_000_000_000
  seedExtractedFrame(db, true, base, 5_000)
  seedExtractedFrame(db, true, base + 1_000, 10_000)
  seedExtractedFrame(db, true, base + 2_000, 12_000)
  seedExtractedFrame(db, false, base + 3_000, 70_000)

  const report = buildScreenExperimentReport(db)
  assert.equal(report.pairs.total, 4)
  assert.equal(report.pairs.reviewed, 4)
  assert.equal(report.pairs.improvedShare, 0.5, 'accurate + specific over 4 reviewed')
  assert.equal(report.pairs.byTargetKind.untitled_native_doc, 1)
  assert.equal(report.derived.evidenceCount, 4)
  assert.equal(report.derived.usefulShare, 0.75)

  const byId = new Map(report.criteria.map((criterion) => [criterion.id, criterion]))
  assert.equal(byId.get('target_pass_rate_improves_20pct')?.status, 'pass')
  assert.equal(byId.get('half_of_derived_records_add_useful_detail')?.status, 'pass')
  assert.equal(byId.get('raw_storage_inside_cap')?.status, 'pass')
  // p95 of [5000,10000,12000,70000] lands on the 70s outlier → over the 60s bound.
  assert.equal(byId.get('extraction_latency_within_bounds')?.status, 'fail')
  // Real-machine legs are explicitly unmeasured, never silently passed.
  assert.equal(byId.get('privacy_adversarial_zero_protected_captures')?.status, 'unmeasured')
  assert.equal(byId.get('cpu_and_battery_overhead')?.status, 'unmeasured')
  db.close()
})

test('the report never carries content: no question, answer, or OCR text appears anywhere in it', async () => {
  const db = createProductionTestDatabase()
  const pair = await runPairedEvalCase(db, {
    targetKind: 'visual_research',
    question: SECRET_QUESTION,
  }, scriptedAnswerers([]))
  recordEvalVerdict(db, pair.id, 'screen_more_accurate')
  seedExtractedFrame(db, true, 1_800_000_000_000, 4_000)

  const serialized = JSON.stringify(buildScreenExperimentReport(db))
  for (const marker of ['SECRET_Q_MARKER', 'SECRET_A_MARKER', 'SECRET_B_MARKER', 'SECRET_OCR_MARKER', 'Numbers', 'acquisition']) {
    assert.ok(!serialized.includes(marker), `report leaked content: ${marker}`)
  }
  db.close()
})

test('the pairs table is withheld from the full-history export and named in the omissions', async () => {
  const db = createProductionTestDatabase()
  await runPairedEvalCase(db, {
    targetKind: 'design_spreadsheet',
    question: SECRET_QUESTION,
  }, scriptedAnswerers([]))

  const plan = planHistoryExport(db)
  const exportedTables = plan.sections.flatMap((section) => section.tables.map((table) => table.table))
  assert.ok(!exportedTables.includes('screen_eval_pairs'), 'eval pairs must not export')
  assert.ok(
    plan.omissions.some((omission) => omission.tables?.some((table) => table.startsWith('screen_eval_pairs'))),
    'the omission manifest names the withheld eval table',
  )
  db.close()
})
