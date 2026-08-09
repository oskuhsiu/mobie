/**
 * The encounter contract has one featured foe: the final member of foeTeam.
 * Wild regions may offer this Mobie as a capture target; arena/tower callers
 * may still feature the same final opponent but must not promise capture.
 */
export function captureTargetOf<T>(foeTeam: readonly T[]): T | null {
  return foeTeam.at(-1) ?? null
}
