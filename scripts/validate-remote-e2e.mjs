#!/usr/bin/env node
import crypto from 'node:crypto'

const SITE = process.env.DAYLENS_CONVEX_SITE_URL || 'https://decisive-aardvark-847.convex.site'
const CLOUD = process.env.DAYLENS_CONVEX_CLOUD_URL || 'https://decisive-aardvark-847.convex.cloud'
const CONTRACT = '2026-04-20-r2'

function header(title) {
  console.log('\n== ' + title + ' ==')
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex')
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${SITE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: res.status, body: parsed }
}

async function main() {
  header('1. Create workspace')
  const recoveryKeyHash = randomHex(32)
  const deviceId = `verify-desktop-${crypto.randomUUID()}`
  const createRes = await post('/createWorkspace', {
    recoveryKeyHash,
    deviceId,
    displayName: 'E2E Validation Desktop',
    platform: 'macos',
  })
  console.log('createWorkspace:', createRes.status, JSON.stringify(createRes.body).slice(0, 120))
  if (createRes.status !== 200 || !createRes.body?.sessionToken) {
    console.error('FAILED to create workspace')
    process.exit(1)
  }
  const sessionToken = createRes.body.sessionToken
  const workspaceId = createRes.body.workspaceId

  header('2. Heartbeat (presence)')
  const now = Date.now()
  const presence = {
    contractVersion: CONTRACT,
    deviceId,
    localDate: new Date().toISOString().slice(0, 10),
    state: 'active',
    heartbeatAt: now,
    capturedAt: now,
    lastMeaningfulCaptureAt: now,
    currentBlockLabel: 'Validation run',
    currentCategory: 'development',
    currentAppKey: 'node',
    currentFocusSeconds: 60,
  }
  const hbRes = await post('/remote/heartbeat', presence, sessionToken)
  console.log('heartbeat:', hbRes.status, JSON.stringify(hbRes.body).slice(0, 120))
  if (hbRes.status !== 200) {
    console.error('FAILED heartbeat')
    process.exit(1)
  }

  header('3. Day sync')
  const today = new Date().toISOString().slice(0, 10)
  const generatedAt = new Date().toISOString()
  const emptyRecapBlock = {
    headline: 'Validation run',
    chapters: [],
    metrics: [],
    changeSummary: '',
    promptChips: [],
    hasData: true,
  }
  const daySummary = {
    contractVersion: CONTRACT,
    deviceId,
    localDate: today,
    generatedAt,
    isPartialDay: true,
    focusScore: 72,
    focusSeconds: 3600,
    focusScoreV2: {
      score: 72,
      coherence: 0.7,
      deepWorkDensity: 0.6,
      artifactProgress: 0.4,
      switchPenalty: 0.2,
    },
    recap: {
      day: emptyRecapBlock,
      week: null,
      month: null,
    },
    coverage: {
      attributedPct: 0.8,
      untitledPct: 0.2,
      activeDayCount: 1,
      quietDayCount: 0,
      hasComparison: false,
      coverageNote: null,
    },
    topWorkstreams: [],
    latestWorkBlockId: 'blk_val_1',
    workBlockCount: 1,
    entityCount: 0,
    artifactCount: 0,
    privacyFiltered: false,
  }
  const workBlock = {
    id: 'blk_val_1',
    startAt: new Date(now - 3600_000).toISOString(),
    endAt: new Date(now).toISOString(),
    label: 'Validation run',
    labelSource: 'rule',
    dominantCategory: 'development',
    focusSeconds: 3000,
    switchCount: 1,
    confidence: 'high',
    topApps: [{ appKey: 'node', seconds: 3000 }],
    topPages: [],
    artifactIds: [],
  }
  const syncPayload = {
    contractVersion: CONTRACT,
    deviceId,
    localDate: today,
    generatedAt,
    daySummary,
    workBlocks: [workBlock],
    entities: [],
    artifacts: [],
  }
  const syncRes = await post('/remote/syncDay', syncPayload, sessionToken)
  console.log('syncDay:', syncRes.status, JSON.stringify(syncRes.body).slice(0, 200))
  if (syncRes.status !== 200) {
    console.error('FAILED syncDay')
    process.exit(1)
  }

  header('4. Summary')
  console.log(JSON.stringify({ workspaceId, deviceId, ok: true }, null, 2))
}

main().catch((err) => {
  console.error('E2E failed:', err)
  process.exit(1)
})
