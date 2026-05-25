import test from 'node:test'
import assert from 'node:assert/strict'
import type {
  ArtifactRef,
  DocumentRef,
  PageRef,
  WorkContextAppSummary,
  WorkContextBlock,
  WorkflowRef,
  WebsiteSummary,
} from '../src/shared/types.ts'
import { inferWorkIntent } from '../src/shared/workIntent.ts'

function makeApp(appName: string, category: WorkContextAppSummary['category'], totalSeconds: number, isBrowser = false): WorkContextAppSummary {
  return {
    bundleId: `${appName.toLowerCase()}.bundle`,
    appName,
    category,
    totalSeconds,
    sessionCount: 1,
    isBrowser,
  }
}

function makeWebsite(domain: string, totalSeconds: number, topTitle: string | null): WebsiteSummary {
  return {
    domain,
    totalSeconds,
    visitCount: 1,
    topTitle,
    browserBundleId: 'arc.bundle',
    canonicalBrowserId: 'arc',
  }
}

function makeArtifact(title: string, artifactType: ArtifactRef['artifactType'] = 'document'): ArtifactRef {
  return {
    id: `artifact:${title}`,
    artifactType,
    displayTitle: title,
    totalSeconds: 1800,
    confidence: 0.9,
    openTarget: { kind: 'unsupported', value: null },
  }
}

function makeDocumentRef(title: string): DocumentRef {
  return {
    ...makeArtifact(title, 'document'),
    artifactType: 'document',
    sourceSessionIds: [],
  }
}

function makePage(options: {
  title: string
  domain: string
  url: string
}): PageRef {
  return {
    id: `page:${options.domain}:${options.title}`,
    artifactType: 'page',
    displayTitle: options.title,
    pageTitle: options.title,
    domain: options.domain,
    totalSeconds: 1800,
    confidence: 0.9,
    openTarget: { kind: 'external_url', value: options.url },
    url: options.url,
    normalizedUrl: options.url,
  }
}

function makeWorkflow(label: string): WorkflowRef {
  return {
    id: `workflow:${label}`,
    signatureKey: label,
    label,
    confidence: 0.7,
    dominantCategory: 'development',
    canonicalApps: [],
    artifactKeys: [],
  }
}

function makeBlock(overrides: Partial<WorkContextBlock> = {}): WorkContextBlock {
  return {
    id: overrides.id ?? 'block-1',
    startTime: overrides.startTime ?? new Date('2026-04-20T09:00:00').getTime(),
    endTime: overrides.endTime ?? new Date('2026-04-20T10:00:00').getTime(),
    dominantCategory: overrides.dominantCategory ?? 'research',
    categoryDistribution: overrides.categoryDistribution ?? { research: 3600 },
    ruleBasedLabel: overrides.ruleBasedLabel ?? 'Research',
    aiLabel: overrides.aiLabel ?? null,
    sessions: overrides.sessions ?? [],
    topApps: overrides.topApps ?? [],
    websites: overrides.websites ?? [],
    keyPages: overrides.keyPages ?? [],
    pageRefs: overrides.pageRefs ?? [],
    documentRefs: overrides.documentRefs ?? [],
    topArtifacts: overrides.topArtifacts ?? [],
    workflowRefs: overrides.workflowRefs ?? [],
    label: overrides.label ?? {
      current: overrides.ruleBasedLabel ?? 'Research',
      source: 'rule',
      confidence: 0.6,
      narrative: null,
      ruleBased: overrides.ruleBasedLabel ?? 'Research',
      aiSuggested: overrides.aiLabel ?? null,
      override: null,
    },
    focusOverlap: overrides.focusOverlap ?? {
      totalSeconds: 0,
      pct: 0,
      sessionIds: [],
    },
    evidenceSummary: overrides.evidenceSummary ?? {
      apps: [],
      pages: [],
      documents: [],
      domains: [],
    },
    heuristicVersion: overrides.heuristicVersion ?? 'test',
    computedAt: overrides.computedAt ?? Date.now(),
    switchCount: overrides.switchCount ?? 1,
    confidence: overrides.confidence ?? 'medium',
    isLive: overrides.isLive ?? false,
  }
}

test('generic X home feed reads as ambient browsing rather than a workstream', () => {
  const block = makeBlock({
    dominantCategory: 'browsing',
    topApps: [makeApp('Arc', 'browsing', 3600, true)],
    websites: [makeWebsite('x.com', 3600, 'X (Twitter)')],
    pageRefs: [makePage({ title: 'X (Twitter)', domain: 'x.com', url: 'https://x.com/home' })],
  })

  const intent = inferWorkIntent(block)

  assert.equal(intent.role, 'ambient')
  assert.equal(intent.subject, null)
  assert.match(intent.summary, /Ambient browsing/)
})

test('coding plus generic X context still reads as execution on the named artifact', () => {
  const artifact = makeArtifact('src/renderer/views/Insights.tsx')
  const documentRef = makeDocumentRef('src/renderer/views/Insights.tsx')
  const block = makeBlock({
    dominantCategory: 'development',
    ruleBasedLabel: 'AI polish',
    topApps: [
      makeApp('Code', 'development', 3000),
      makeApp('Arc', 'browsing', 600, true),
    ],
    websites: [makeWebsite('x.com', 600, 'X (Twitter)')],
    pageRefs: [makePage({ title: 'X (Twitter)', domain: 'x.com', url: 'https://x.com/home' })],
    documentRefs: [documentRef],
    topArtifacts: [artifact],
  })

  const intent = inferWorkIntent(block)

  assert.equal(intent.role, 'execution')
  assert.equal(intent.subject, 'src/renderer/views/Insights.tsx')
  assert.match(intent.summary, /Execution work on src\/renderer\/views\/Insights\.tsx/)
})

test('github pull requests without an execution anchor read as review work', () => {
  const block = makeBlock({
    dominantCategory: 'development',
    ruleBasedLabel: 'GitHub',
    topApps: [makeApp('Arc', 'browsing', 2400, true)],
    websites: [makeWebsite('github.com', 2400, 'Fix recap summaries')],
    pageRefs: [
      makePage({
        title: 'Fix recap summaries',
        domain: 'github.com',
        url: 'https://github.com/daylens/daylens/pull/42',
      }),
    ],
    topArtifacts: [],
    switchCount: 1,
  })

  const intent = inferWorkIntent(block)

  assert.equal(intent.role, 'review')
  assert.equal(intent.subject, 'Fix recap summaries')
})

test('specific AI chats and threads read as research instead of generic browsing', () => {
  const block = makeBlock({
    dominantCategory: 'research',
    ruleBasedLabel: 'Research',
    topApps: [makeApp('Arc', 'research', 3600, true)],
    websites: [
      makeWebsite('chatgpt.com', 1800, 'Daily recap wording ideas'),
      makeWebsite('x.com', 1200, 'A long post about AI product UX'),
    ],
    pageRefs: [
      makePage({
        title: 'Daily recap wording ideas',
        domain: 'chatgpt.com',
        url: 'https://chatgpt.com/c/123',
      }),
      makePage({
        title: 'A long post about AI product UX',
        domain: 'x.com',
        url: 'https://x.com/someone/status/123',
      }),
    ],
  })

  const intent = inferWorkIntent(block)

  assert.equal(intent.role, 'research')
  assert.equal(intent.subject, 'Daily recap wording ideas')
  assert.match(intent.summary, /Research\/context gathering around Daily recap wording ideas/)
})

test('mixed browser blocks prefer concrete project pages over workflow app-pair labels', () => {
  const block = makeBlock({
    dominantCategory: 'browsing',
    ruleBasedLabel: 'X (Twitter)',
    topApps: [
      makeApp('Dia', 'browsing', 2200, true),
      makeApp('Warp', 'development', 240),
    ],
    websites: [
      makeWebsite('x.com', 1800, 'X (Twitter)'),
      makeWebsite('localhost', 300, 'Daylens — Searchable work history for your laptop'),
    ],
    pageRefs: [
      makePage({ title: 'X (Twitter)', domain: 'x.com', url: 'https://x.com/home' }),
      makePage({ title: 'Daylens — Searchable work history for your laptop', domain: 'localhost', url: 'http://localhost:3000/daylens' }),
    ],
    workflowRefs: [makeWorkflow('Dia + Warp')],
  })

  const intent = inferWorkIntent(block)

  assert.equal(intent.role, 'research')
  assert.equal(intent.subject, 'Daylens')
  assert.doesNotMatch(intent.summary, /Dia \+ Warp/)
})

test('noisy loading and entertainment pages do not become fake intent subjects', () => {
  const block = makeBlock({
    dominantCategory: 'browsing',
    ruleBasedLabel: 'Loading…',
    topApps: [
      makeApp('Dia', 'browsing', 1500, true),
      makeApp('Warp', 'development', 800),
    ],
    websites: [
      makeWebsite('app.raindrop.io', 400, 'Loading…'),
      makeWebsite('ww1.goojara.to', 300, 'Watch Inception (2010)'),
    ],
    pageRefs: [
      makePage({ title: 'Loading…', domain: 'app.raindrop.io', url: 'https://app.raindrop.io/my/0' }),
      makePage({ title: 'Watch Inception (2010)', domain: 'ww1.goojara.to', url: 'https://ww1.goojara.to/mKZNZ7' }),
    ],
    workflowRefs: [makeWorkflow('Dia + Warp')],
  })

  const intent = inferWorkIntent(block)

  assert.equal(intent.role, 'research')
  assert.equal(intent.subject, null)
  assert.doesNotMatch(intent.summary, /Dia \+ Warp|Watch Inception/)
})
