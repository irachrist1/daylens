export type ScenarioRubric = Record<string, boolean | string>

export interface ScenarioRecord {
  id: string
  question: string
  family: string
  // What a colleague who had been watching the user work this week would say
  // when asked the same question, in 2-4 sentences. The judge grades the AI
  // primarily against this shape — does the answer reveal understanding, not
  // just data accuracy. Rubric flags remain as secondary signal.
  gold_answer_shape?: string
  rubric: ScenarioRubric
}
