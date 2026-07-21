// Model cost catalog for the picker (DEV-201).
//
// Cost transparency in money and estimated questions, never raw tokens first
// (billing-and-entitlements.md §Usage metering). The picker asks with the
// model ids it offers; this service prices each one from the SAME pricing
// table billing settlement estimates use (modelPricing.ts), so the number the
// picker quotes can never diverge from what the meter charges. The managed
// allowance block comes from the validated billing snapshot — remaining
// credit in dollars plus the whole questions it still covers, with a plain
// reason when managed AI cannot serve a turn right now.

import type { AIManagedAllowanceView, AIModelCostCatalog, AIModelCostEntry, AIProviderMode, BillingAccessSnapshot } from '@shared/types'
import { estimateQuestionsRemaining, typicalQuestionCostUsd } from './modelPricing'
import { getBillingAccess } from './billing'

export interface ModelCatalogRequestEntry {
  provider: AIProviderMode
  modelId: string
}

/** Pure catalog assembly — everything the IPC handler returns, testable
 *  without Electron or a billing service. */
export function buildModelCostCatalog(
  models: ModelCatalogRequestEntry[],
  billing: BillingAccessSnapshot | null,
): AIModelCostCatalog {
  const entries: AIModelCostEntry[] = []
  const seen = new Set<string>()
  for (const model of models) {
    if (!model?.modelId || !model.provider) continue
    const key = `${model.provider}:${model.modelId}`
    if (seen.has(key)) continue
    seen.add(key)
    const costUsd = typicalQuestionCostUsd(model.modelId)
    entries.push({
      provider: model.provider,
      modelId: model.modelId,
      typicalQuestionCostUsd: costUsd,
      questionsPerUsd: costUsd > 0 ? Math.floor(1 / costUsd) : 0,
    })
  }

  return {
    models: entries,
    allowance: allowanceView(billing),
  }
}

function allowanceView(billing: BillingAccessSnapshot | null): AIManagedAllowanceView | null {
  // No billing service in this build (or it reports unavailable): there is no
  // managed allowance to show — the picker's managed source disappears rather
  // than showing a made-up figure.
  if (!billing || billing.mode === 'unavailable') return null
  const remainingUsd = Math.max(0, billing.creditRemainingUsd)
  return {
    grantedUsd: billing.creditGrantedUsd,
    remainingUsd,
    // Managed routing picks the model server-side, so the estimate uses the
    // managed default tier (null model), same as the billing usage view.
    estimatedQuestionsRemaining: estimateQuestionsRemaining(remainingUsd, null),
    canUseManagedAI: billing.canUseAI,
    unavailableReason: billing.canUseAI ? null : billing.message,
  }
}

/** IPC entry: prices the requested models against the live billing snapshot.
 *  A billing lookup failure degrades to costs-only — the picker still shows
 *  honest per-model prices when the allowance cannot be read. */
export async function getModelCostCatalog(models: ModelCatalogRequestEntry[]): Promise<AIModelCostCatalog> {
  const billing = await getBillingAccess().catch(() => null)
  return buildModelCostCatalog(models, billing)
}
