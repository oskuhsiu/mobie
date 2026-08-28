export interface ResultIdentity {
  resultId: string
  resultFingerprint: string
}

export type ResultIdentityClassification = 'new' | 'same-result' | 'collision'

/** Classifies an incoming settlement identity without inspecting mutable game state. */
export function classifyResultIdentity(
  existing: ResultIdentity | null,
  incoming: ResultIdentity,
): ResultIdentityClassification {
  if (!existing || existing.resultId !== incoming.resultId) return 'new'
  return existing.resultFingerprint === incoming.resultFingerprint
    ? 'same-result'
    : 'collision'
}
