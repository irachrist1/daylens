export type ProjectionScope = 'timeline' | 'apps' | 'insights' | 'settings' | 'all'

export interface ProjectionInvalidationEvent {
  scope: ProjectionScope
  reason: string
  at: number
  date?: string | null
  canonicalAppId?: string | null
}

export type DerivedStateComponent =
  | 'app_normalization'
  | 'inference_pipeline'
  | 'projection_contracts'
  | 'assistant_context'
