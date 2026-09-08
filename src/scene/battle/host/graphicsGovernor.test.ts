import { describe, expect, it } from 'vitest'
import {
  GraphicsGovernor,
  summarizeGraphicsFrameWindow,
} from './graphicsGovernor'

function failTwoWindows(governor: GraphicsGovernor, startAt = 0): number {
  let at = startAt
  // Four gaps fill the first rolling window; two more gaps trigger the second evaluation.
  for (let index = 0; index < 7; index += 1) {
    governor.recordRenderedFrame(at, true)
    at += 40
  }
  return at
}

describe('GraphicsGovernor', () => {
  it('uses p95 or over-budget rate as the failure signal', () => {
    expect(summarizeGraphicsFrameWindow([16, 18, 20, 35, 36], 34, 0.05)).toMatchObject({
      p50Ms: 20,
      p95Ms: 36,
      overBudgetCount: 2,
      failing: true,
    })
    expect(summarizeGraphicsFrameWindow([16, 18, 20, 21, 22], 34, 0.05)?.failing).toBe(false)
  })

  it('ignores idle frames and requires two failing rolling windows before queuing', () => {
    const governor = new GraphicsGovernor({
      preference: 'high', windowSize: 4, evaluateEvery: 2,
    })
    governor.recordRenderedFrame(0, true)
    governor.recordRenderedFrame(1_000, false)
    governor.recordRenderedFrame(1_010, true)
    expect(governor.snapshot().activeGapCount).toBe(0)

    governor.recordRenderedFrame(1_020, true)
    expect(governor.snapshot().activeGapCount).toBe(1)
    failTwoWindows(governor, 1_020)
    expect(governor.snapshot().pending).toBeTruthy()
    expect(governor.snapshot().profile.stage).toBe('high')
  })

  it('applies a queued downgrade only at a safe cue boundary and never upgrades in place', () => {
    const governor = new GraphicsGovernor({
      preference: 'high', windowSize: 4, evaluateEvery: 2,
    })
    failTwoWindows(governor)
    const transition = governor.applyAtSafeCueBoundary()
    expect(transition).toMatchObject({ action: 'reduce-dpr', from: { stage: 'high' }, to: { stage: 'high-dpr-reduced' } })
    expect(governor.snapshot().pending).toBeNull()
    expect(governor.profile.stage).toBe('high-dpr-reduced')

    governor.reset({ preference: 'balanced' })
    expect(governor.profile.stage).toBe('balanced')
    expect(governor.snapshot().transitions).toHaveLength(0)
  })

  it('follows DPR, post, effects, then compatibility in one direction', () => {
    const governor = new GraphicsGovernor({
      preference: 'high', windowSize: 4, evaluateEvery: 2,
    })
    const actions: string[] = []
    for (let index = 0; index < 4; index += 1) {
      failTwoWindows(governor)
      const transition = governor.applyAtSafeCueBoundary()
      if (!transition) break
      actions.push(transition.action)
    }
    expect(actions).toEqual(['reduce-dpr', 'disable-post', 'reduce-particles-weather', 'compatibility'])
    expect(governor.profile.stage).toBe('compatibility')
    expect(governor.applyAtSafeCueBoundary()).toBeNull()
  })

  it('skips already-applied DPR/post reductions when Auto starts Balanced', () => {
    const governor = new GraphicsGovernor({
      preference: 'auto', windowSize: 4, evaluateEvery: 2,
    })
    failTwoWindows(governor)
    expect(governor.applyAtSafeCueBoundary()?.action).toBe('reduce-particles-weather')
    failTwoWindows(governor)
    expect(governor.applyAtSafeCueBoundary()?.action).toBe('compatibility')
  })
})
