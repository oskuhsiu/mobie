import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  M23_BASELINE_SCENARIO_ID,
  M23_GRAPHICS_OPTIONS,
  M23_MOTION_OPTIONS,
} from '@/dev/m23/contracts'
import {
  M23_EVIDENCE_SCHEMA_VERSION,
  M23_REQUIRED_CHECKPOINTS,
  parseM23AccessibilityEvidence,
  parseM23EvidencePath,
  parseM23MetricsEvidence,
  validateM23EvidenceFileSet,
} from './evidenceSchema'

function validMetrics(): Record<string, unknown> {
  return {
    schemaVersion: M23_EVIDENCE_SCHEMA_VERSION,
    evidenceKind: 'full',
    scenarioId: 'baseline-win',
    environment: {
      device: 'desktop-chrome',
      os: { name: 'macOS', version: '15.6' },
      browser: { name: 'Chrome', version: '140.0' },
    },
    viewport: { width: 1180, height: 820 },
    seed: 'm23-baseline-1',
    graphics: 'auto',
    motion: 'full',
    checkpoints: [...M23_REQUIRED_CHECKPOINTS],
    activeFrameGapsMs: [16.6, 17.1, 20.2],
    idleCadenceGapsMs: [50, 49.8],
    longTasks: [{ startTimeMs: 402.1, durationMs: 53.4 }],
    rendererResources: { geometries: 12, textures: 8, programs: 5, triangles: 2400, drawCalls: 25 },
    pools: { particles: { live: 120, capacity: 250 } },
    dpr: 1,
    tier: 'balanced',
    governor: {
      profile: {
        stage: 'balanced', tier: 'balanced', dprCap: 1, postEnabled: false,
        particleScale: 1, weatherScale: 0.3, transientParticleCap: 160,
      },
      activeFrameCount: 180,
      activeGapCount: 120,
      consecutiveFailingWindows: 0,
      pending: null,
      lastWindow: {
        sampleCount: 120, p50Ms: 16.6, p95Ms: 20.2, maxMs: 24,
        overBudgetCount: 0, overBudgetRate: 0, failing: false,
      },
      transitions: [],
    },
    artworkCache: {
      totalEntries: 2, activeEntries: 2, inactiveEntries: 0,
      estimatedDecodedBytes: 8_388_608, evictions: 0,
    },
    activeCue: 'normal-attack:impact',
    assetComplexity: { artworkEntries: 2, estimatedBytes: 8_388_608, liveParticles: 120 },
    firstCastLatencyMs: 442.5,
    battleChunks: {
      files: [{ name: 'BattleStage-example.js', bytes: 4000, gzipBytes: 1800, battleRelevant: true }],
    },
    limitations: ['JS heap unavailable in this capture'],
  }
}

function validAccessibility(): Record<string, unknown> {
  return {
    schemaVersion: M23_EVIDENCE_SCHEMA_VERSION,
    scenarioId: 'baseline-win',
    checkpoints: M23_REQUIRED_CHECKPOINTS.map((label) => ({
      label,
      nodes: [{ role: 'button', name: `${label} primary action`, disabled: false }],
    })),
    limitations: [],
  }
}

describe('M23 metrics evidence', () => {
  it('keeps the harness mirror aligned and entry points wired to the typed DEV contract', () => {
    const harness = readFileSync(new URL('../../../scripts/m23-baseline.mjs', import.meta.url), 'utf8')
    const main = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8')
    const app = readFileSync(new URL('../../app/App.tsx', import.meta.url), 'utf8')
    const strings = (block: string) => [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
    const arrayBlock = (name: string) => new RegExp(String.raw`const ${name} = \[([\s\S]*?)\]`).exec(harness)?.[1] ?? ''
    const setBlock = (name: string) => new RegExp(String.raw`const ${name} = new Set\(\[([\s\S]*?)\]\)`).exec(harness)?.[1] ?? ''

    expect(/const SCENARIO_ID = '([^']+)'/.exec(harness)?.[1]).toBe(M23_BASELINE_SCENARIO_ID)
    expect(strings(arrayBlock('REQUIRED_CHECKPOINTS'))).toEqual([...M23_REQUIRED_CHECKPOINTS])
    expect(strings(setBlock('GRAPHICS'))).toEqual([...M23_GRAPHICS_OPTIONS])
    expect(strings(setBlock('MOTION'))).toEqual([...M23_MOTION_OPTIONS])
    for (const entryPoint of [main, app]) {
      expect(entryPoint).toContain("import { M23_BASELINE_SCENARIO_ID } from '@/dev/m23/contracts'")
      expect(entryPoint).toMatch(/\.get\('m23Scenario'\)\s*[!=]==?\s*M23_BASELINE_SCENARIO_ID/)
      expect(entryPoint).not.toContain(`'${M23_BASELINE_SCENARIO_ID}'`)
    }
  })

  it('parses the required environment, diagnostics, and separated frame cadence', () => {
    const evidence = parseM23MetricsEvidence(validMetrics())
    expect(evidence.scenarioId).toBe('baseline-win')
    expect(evidence.environment.browser.name).toBe('Chrome')
    expect(evidence.activeFrameGapsMs).toEqual([16.6, 17.1, 20.2])
    expect(evidence.idleCadenceGapsMs).toEqual([50, 49.8])
    expect(evidence.pools.particles).toEqual({ live: 120, capacity: 250 })
    expect(evidence.governor?.profile.stage).toBe('balanced')
    expect(evidence.artworkCache?.totalEntries).toBe(2)
  })

  it('accepts a performance capture with partial checkpoint coverage', () => {
    const evidence = validMetrics()
    evidence.evidenceKind = 'performance'
    evidence.checkpoints = ['player-choice']
    expect(parseM23MetricsEvidence(evidence)).toMatchObject({
      evidenceKind: 'performance', checkpoints: ['player-choice'],
    })
  })

  it('rejects missing checkpoint coverage and invalid pool counts', () => {
    const missingCheckpoint = validMetrics()
    missingCheckpoint.checkpoints = M23_REQUIRED_CHECKPOINTS.filter((label) => label !== 'qte')
    expect(() => parseM23MetricsEvidence(missingCheckpoint)).toThrow(/missing required checkpoint qte/)

    const invalidPool = validMetrics()
    invalidPool.pools = { particles: { live: 251, capacity: 250 } }
    expect(() => parseM23MetricsEvidence(invalidPool)).toThrow(/live must not exceed capacity/)
  })

  it('accepts null capacity for an observed legacy list with no enforced cap', () => {
    const evidence = validMetrics()
    evidence.pools = { legacyFx: { live: 12, capacity: null } }
    expect(parseM23MetricsEvidence(evidence).pools.legacyFx).toEqual({ live: 12, capacity: null })
  })

  it('rejects a missing active-frame series instead of treating idle cadence as performance data', () => {
    const evidence = validMetrics()
    delete evidence.activeFrameGapsMs
    expect(() => parseM23MetricsEvidence(evidence)).toThrow(/activeFrameGapsMs/)

    const emptyEvidence = validMetrics()
    emptyEvidence.activeFrameGapsMs = []
    expect(() => parseM23MetricsEvidence(emptyEvidence)).toThrow(/at least one active rendered frame gap/)
  })

  it('rejects zero-sized viewports and empty asset diagnostics', () => {
    const zeroViewport = validMetrics()
    zeroViewport.viewport = { width: 0, height: 820 }
    expect(() => parseM23MetricsEvidence(zeroViewport)).toThrow(/positive integer/)

    const noAssets = validMetrics()
    noAssets.assetComplexity = {}
    expect(() => parseM23MetricsEvidence(noAssets)).toThrow(/at least one metric/)
  })

  it('requires first-cast latency and at least one battle-relevant production chunk', () => {
    const noLatency = validMetrics()
    delete noLatency.firstCastLatencyMs
    expect(() => parseM23MetricsEvidence(noLatency)).toThrow(/firstCastLatencyMs/)

    const noBattleChunk = validMetrics()
    noBattleChunk.battleChunks = {
      files: [{ name: 'unrelated.js', bytes: 10, gzipBytes: 8, battleRelevant: false }],
    }
    expect(() => parseM23MetricsEvidence(noBattleChunk)).toThrow(/battle-relevant/)
  })
})

describe('M23 accessibility evidence', () => {
  it('parses checkpoint-labelled semantic/AX nodes', () => {
    const evidence = parseM23AccessibilityEvidence(validAccessibility())
    expect(evidence.checkpoints).toHaveLength(M23_REQUIRED_CHECKPOINTS.length)
    expect(evidence.checkpoints[0]?.nodes[0]).toMatchObject({ role: 'button', disabled: false })
  })

  it('rejects an empty semantic snapshot and missing outcome evidence', () => {
    const emptyNodes = validAccessibility()
    const checkpoints = emptyNodes.checkpoints as Array<{ label: string; nodes: unknown[] }>
    checkpoints[0]!.nodes = []
    expect(() => parseM23AccessibilityEvidence(emptyNodes)).toThrow(/at least one semantic\/AX node/)

    const missingOutcome = validAccessibility()
    missingOutcome.checkpoints = (missingOutcome.checkpoints as Array<{ label: string }>).filter(
      ({ label }) => label !== 'outcome',
    )
    expect(() => parseM23AccessibilityEvidence(missingOutcome)).toThrow(/missing required checkpoint outcome/)
  })
})

describe('M23 evidence path contract', () => {
  const root = 'test-runs/m23/desktop-chrome/baseline-win'

  it('accepts exactly the three required files in one device/scenario directory', () => {
    expect(validateM23EvidenceFileSet([
      `${root}/screenshot.png`,
      `${root}/metrics.json`,
      `${root}/accessibility.json`,
    ])).toHaveLength(3)
    expect(parseM23EvidencePath(`${root}/metrics.json`)).toMatchObject({
      device: 'desktop-chrome',
      scenarioId: 'baseline-win',
      fileName: 'metrics.json',
    })
  })

  it('rejects invalid roots, filenames, traversal, duplicates, and mixed scenarios', () => {
    expect(() => parseM23EvidencePath('tmp/m23/device/scenario/metrics.json')).toThrow(/expected test-runs/)
    expect(() => parseM23EvidencePath(`${root}/notes.json`)).toThrow(/expected one of/)
    expect(() => parseM23EvidencePath('test-runs/m23/../scenario/metrics.json')).toThrow(/safe path segments/)
    expect(() => validateM23EvidenceFileSet([
      `${root}/screenshot.png`,
      `${root}/metrics.json`,
      `${root}/metrics.json`,
    ])).toThrow(/exactly one metrics.json/)
    expect(() => validateM23EvidenceFileSet([
      `${root}/screenshot.png`,
      `${root}/metrics.json`,
      'test-runs/m23/desktop-chrome/other/accessibility.json',
    ])).toThrow(/share one device and scenario/)
  })
})
