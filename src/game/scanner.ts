/** Camera capability helpers shared by the scanner UI and browser evidence. */

export type CameraFailure = 'denied' | 'unsupported'

/**
 * Map the browser's getUserMedia failure surface to one of the two player
 * facing recovery paths. A missing device/API is unsupported; permission and
 * secure-context failures are denied. Unknown failures choose unsupported so
 * the scanner never loops a permission prompt it cannot explain.
 */
export function cameraFailureOf(error: unknown): CameraFailure {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'denied'
  if (name === 'AbortError' || name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError' || name === 'NotSupportedError' || name === 'TypeError') return 'unsupported'

  const message = error instanceof Error ? error.message.toLocaleLowerCase() : String(error ?? '').toLocaleLowerCase()
  if (/permission|denied|blocked|secure context/.test(message)) return 'denied'
  return 'unsupported'
}
