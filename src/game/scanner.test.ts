import { describe, expect, it } from 'vitest'
import { cameraFailureOf } from './scanner'

describe('scanner camera capability mapping', () => {
  it('keeps permission failures on the denied/manual path', () => {
    expect(cameraFailureOf({ name: 'NotAllowedError' })).toBe('denied')
    expect(cameraFailureOf(new Error('permission was blocked'))).toBe('denied')
  })

  it('maps missing or unsupported camera APIs to a stable fallback', () => {
    expect(cameraFailureOf({ name: 'NotFoundError' })).toBe('unsupported')
    expect(cameraFailureOf({ name: 'NotSupportedError' })).toBe('unsupported')
    expect(cameraFailureOf({ name: 'NotReadableError' })).toBe('unsupported')
    expect(cameraFailureOf(new Error('unknown browser failure'))).toBe('unsupported')
  })
})
