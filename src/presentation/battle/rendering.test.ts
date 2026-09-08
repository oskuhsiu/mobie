import { describe, expect, it } from 'vitest'
import {
  createBattleRendererState,
  classifyRendererError,
  reduceBattleRendererState,
  rendererAttemptId,
  rendererIsReady,
  resolveBattleRendererRoute,
  resolveGraphicsPreference,
  graphicsQualityProfileOf,
  graphicsQualityProfileForStage,
  updateBattleRendererQuality,
  type GraphicsPreference,
} from './rendering'

describe('battle renderer policy', () => {
  it('keeps Release A next opt-in while allowing compatibility recovery', () => {
    expect(resolveBattleRendererRoute()).toBe('legacy')
    expect(resolveBattleRendererRoute('next')).toBe('legacy')
    expect(resolveBattleRendererRoute('next', true)).toBe('next')
    expect(resolveBattleRendererRoute('compatibility')).toBe('compatibility')

    const legacy = createBattleRendererState({
      attemptId: 'session-legacy:1', preference: 'auto', rendererRoute: 'legacy',
    })
    const ready = reduceBattleRendererState(legacy, {
      type: 'LEGACY_READY', attemptId: 'session-legacy:1',
    })
    expect(ready).toMatchObject({ phase: 'legacy-ready', route: 'legacy' })
    expect(rendererIsReady(ready)).toBe(true)
    expect(reduceBattleRendererState(legacy, {
      type: 'NEXT_READY', attemptId: 'session-legacy:1',
    })).toBe(legacy)
    expect(createBattleRendererState({
      attemptId: 'session-compat:1', preference: 'compatibility', rendererRoute: 'next',
    })).toMatchObject({ phase: 'compatibility-ready', route: 'compatibility' })
  })

  it('derives one full-token renderer attempt identity', () => {
    expect(rendererAttemptId({ battleSessionId: 'battle-a', resultFingerprint: 'fingerprint-a' }))
      .toBe('battle-a:fingerprint-a:renderer')
  })

  it('classifies shader/program failures separately from generic render errors', () => {
    expect(classifyRendererError(new Error('WebGLProgram link failed'))).toBe('shader-error')
    expect(classifyRendererError(new Error('scene render failed'))).toBe('render-error')
  })

  it.each([
    [undefined, 'auto', 'next', 'balanced', 1],
    ['auto', 'auto', 'next', 'balanced', 1],
    ['balanced', 'balanced', 'next', 'balanced', 1],
    ['high', 'high', 'next', 'high', 1.5],
    ['compatibility', 'compatibility', 'compatibility', 'compatibility', null],
  ] as const)('maps %s without reading storage', (input, requested, route, tier, dprCap) => {
    expect(resolveGraphicsPreference(input as GraphicsPreference | undefined)).toEqual({
      requested,
      route,
      tier,
      dprCap,
    })
  })

  it('fences stale attempts and makes compatibility terminal for the current battle', () => {
    const booting = createBattleRendererState({ attemptId: 'session-a:1', preference: 'auto' })
    expect(booting).toMatchObject({ phase: 'renderer-booting', tier: 'balanced' })
    expect(rendererIsReady(booting)).toBe(false)

    expect(reduceBattleRendererState(booting, {
      type: 'FALLBACK', attemptId: 'session-b:1', reason: 'context-lost',
    })).toBe(booting)

    const compatibility = reduceBattleRendererState(booting, {
      type: 'FALLBACK', attemptId: 'session-a:1', reason: 'chunk-reject',
    })
    expect(compatibility).toMatchObject({
      phase: 'compatibility-ready', tier: 'compatibility', fallbackReason: 'chunk-reject',
    })
    expect(rendererIsReady(compatibility)).toBe(true)
    expect(reduceBattleRendererState(compatibility, {
      type: 'NEXT_READY', attemptId: 'session-a:1',
    })).toBe(compatibility)
    expect(reduceBattleRendererState(compatibility, {
      type: 'FALLBACK', attemptId: 'session-a:1', reason: 'context-lost',
    })).toBe(compatibility)
  })

  it('allows a ready next renderer to fall one way to compatibility', () => {
    const booting = createBattleRendererState({ attemptId: 'session-a:1', preference: 'high', rendererRoute: 'next' })
    const ready = reduceBattleRendererState(booting, { type: 'NEXT_READY', attemptId: 'session-a:1' })
    expect(ready).toMatchObject({ phase: 'next-ready', tier: 'high' })

    const fallback = reduceBattleRendererState(ready, {
      type: 'FALLBACK', attemptId: 'session-a:1', reason: 'context-lost',
    })
    expect(fallback).toMatchObject({ phase: 'compatibility-ready', fallbackReason: 'context-lost' })
    expect(reduceBattleRendererState(fallback, {
      type: 'NEXT_READY', attemptId: 'session-a:1',
    })).toBe(fallback)
  })

  it('keeps graphics cost separate from motion and exposes the ordered quality stages', () => {
    expect(graphicsQualityProfileOf('auto')).toMatchObject({
      stage: 'balanced', tier: 'balanced', dprCap: 1, postEnabled: false, weatherScale: 0.3,
    })
    expect(graphicsQualityProfileOf('high')).toMatchObject({
      stage: 'high', tier: 'high', dprCap: 1.5, postEnabled: true,
    })
    expect(graphicsQualityProfileForStage('balanced-effects-reduced')).toMatchObject({
      tier: 'balanced', dprCap: 1, particleScale: 0.5, transientParticleCap: 80,
    })
  })

  it('updates a live next renderer profile without allowing a compatibility renderer to upgrade', () => {
    const booting = createBattleRendererState({ attemptId: 'session-a:1', preference: 'high', rendererRoute: 'next' })
    const ready = reduceBattleRendererState(booting, { type: 'NEXT_READY', attemptId: 'session-a:1' })
    const reduced = updateBattleRendererQuality(ready, graphicsQualityProfileForStage('high-dpr-reduced'))
    expect(reduced).toMatchObject({ tier: 'high', dprCap: 1, quality: { stage: 'high-dpr-reduced' } })
    const compatibility = reduceBattleRendererState(reduced, {
      type: 'FALLBACK', attemptId: 'session-a:1', reason: 'performance',
    })
    expect(updateBattleRendererQuality(compatibility, graphicsQualityProfileOf('high'))).toBe(compatibility)
  })
})
