import {
  M23_REQUIRED_CHECKPOINTS,
  M23_RENDERER_ROUTES,
  type M23ArtworkCache,
  type M23GraphicsGovernor,
  type M23Checkpoint,
  type M23PoolCount,
  type M23RendererResources,
} from '@/dev/m23/contracts'

export { M23_REQUIRED_CHECKPOINTS }
export type { M23Checkpoint }

export const M23_EVIDENCE_SCHEMA_VERSION = 2 as const
export type M23EvidenceFileName = 'screenshot.png' | 'metrics.json' | 'accessibility.json'

export interface M23EvidencePath {
  device: string
  scenarioId: string
  fileName: M23EvidenceFileName
}

export interface M23Environment {
  device: string
  os: { name: string; version: string }
  browser: { name: string; version: string }
}

export interface M23LongTask {
  startTimeMs: number
  durationMs: number
}

export interface M23MetricsEvidence {
  schemaVersion: typeof M23_EVIDENCE_SCHEMA_VERSION
  evidenceKind: 'full' | 'performance'
  scenarioId: string
  environment: M23Environment
  viewport: { width: number; height: number }
  seed: string
  graphics: string
  rendererFailure?: string | null
  artworkFixture?: string | null
  artworkModes?: {
    player: 'artwork' | 'silhouette' | null
    foe: 'artwork' | 'silhouette' | null
  }
  requestedRendererRoute?: string
  rendererRoute?: string
  motion: string
  checkpoints: M23Checkpoint[]
  activeFrameGapsMs: number[]
  idleCadenceGapsMs: number[]
  longTasks: M23LongTask[]
  rendererResources: M23RendererResources
  pools: Record<string, M23PoolCount>
  dpr: number
  tier: string
  governor: M23GraphicsGovernor | null
  artworkCache: M23ArtworkCache | null
  activeCue: string | null
  assetComplexity: Record<string, number>
  firstCastLatencyMs: number
  battleChunks: {
    files: Array<{ name: string; bytes: number; gzipBytes: number; battleRelevant: boolean }>
  }
  limitations: string[]
}

export interface M23AccessibilityNode {
  role: string
  name: string
  value?: string | number
  description?: string
  disabled?: boolean
}

export interface M23AccessibilityCheckpoint {
  label: M23Checkpoint
  nodes: M23AccessibilityNode[]
}

export interface M23AccessibilityEvidence {
  schemaVersion: typeof M23_EVIDENCE_SCHEMA_VERSION
  scenarioId: string
  checkpoints: M23AccessibilityCheckpoint[]
  limitations: string[]
}

export class M23EvidenceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'M23EvidenceValidationError'
  }
}

function fail(path: string, expectation: string): never {
  throw new M23EvidenceValidationError(`${path}: ${expectation}`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object')
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(path, 'expected a non-empty string')
  }
  return value
}

function finiteNumber(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    fail(path, `expected a finite number >= ${minimum}`)
  }
  return value
}

function nonNegativeInteger(value: unknown, path: string): number {
  const number = finiteNumber(value, path)
  if (!Number.isInteger(number)) fail(path, 'expected a non-negative integer')
  return number
}

function positiveInteger(value: unknown, path: string): number {
  const number = nonNegativeInteger(value, path)
  if (number === 0) fail(path, 'expected a positive integer')
  return number
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array')
  return value
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((entry, index) => nonEmptyString(entry, `${path}[${index}]`))
}

function checkpoint(value: unknown, path: string): M23Checkpoint {
  if (typeof value !== 'string' || !M23_REQUIRED_CHECKPOINTS.includes(value as M23Checkpoint)) {
    fail(path, `expected one of ${M23_REQUIRED_CHECKPOINTS.join(', ')}`)
  }
  return value as M23Checkpoint
}

function assertCheckpointCoverage(labels: readonly M23Checkpoint[], path: string): void {
  for (const required of M23_REQUIRED_CHECKPOINTS) {
    if (!labels.includes(required)) fail(path, `missing required checkpoint ${required}`)
  }
}

function parseEnvironment(value: unknown): M23Environment {
  const environment = record(value, 'environment')
  const os = record(environment.os, 'environment.os')
  const browser = record(environment.browser, 'environment.browser')
  return {
    device: nonEmptyString(environment.device, 'environment.device'),
    os: {
      name: nonEmptyString(os.name, 'environment.os.name'),
      version: nonEmptyString(os.version, 'environment.os.version'),
    },
    browser: {
      name: nonEmptyString(browser.name, 'environment.browser.name'),
      version: nonEmptyString(browser.version, 'environment.browser.version'),
    },
  }
}

function parseRendererResources(value: unknown): M23RendererResources {
  const resources = record(value, 'rendererResources')
  return {
    geometries: nonNegativeInteger(resources.geometries, 'rendererResources.geometries'),
    textures: nonNegativeInteger(resources.textures, 'rendererResources.textures'),
    programs: nonNegativeInteger(resources.programs, 'rendererResources.programs'),
    triangles: nonNegativeInteger(resources.triangles, 'rendererResources.triangles'),
    drawCalls: nonNegativeInteger(resources.drawCalls, 'rendererResources.drawCalls'),
  }
}

function parsePools(value: unknown): Record<string, M23PoolCount> {
  const rawPools = record(value, 'pools')
  const pools: Record<string, M23PoolCount> = {}
  for (const [name, rawPool] of Object.entries(rawPools)) {
    nonEmptyString(name, 'pools key')
    const pool = record(rawPool, `pools.${name}`)
    const live = nonNegativeInteger(pool.live, `pools.${name}.live`)
    const capacity = pool.capacity === null
      ? null
      : nonNegativeInteger(pool.capacity, `pools.${name}.capacity`)
    if (capacity !== null && live > capacity) fail(`pools.${name}`, 'live must not exceed capacity')
    pools[name] = { live, capacity }
  }
  return pools
}

function parseGraphicsProfile(value: unknown, path: string): M23GraphicsGovernor['profile'] {
  const profile = record(value, path)
  const stage = nonEmptyString(profile.stage, `${path}.stage`)
  const tier = nonEmptyString(profile.tier, `${path}.tier`)
  if (!['high', 'balanced', 'compatibility'].includes(tier)) {
    fail(`${path}.tier`, 'expected high, balanced, or compatibility')
  }
  const dprCap = profile.dprCap === null
    ? null
    : finiteNumber(profile.dprCap, `${path}.dprCap`)
  if (dprCap !== null && dprCap !== 1 && dprCap !== 1.5) {
    fail(`${path}.dprCap`, 'expected null, 1, or 1.5')
  }
  if (typeof profile.postEnabled !== 'boolean') fail(`${path}.postEnabled`, 'expected a boolean')
  return {
    stage: stage as M23GraphicsGovernor['profile']['stage'],
    tier: tier as M23GraphicsGovernor['profile']['tier'],
    dprCap: dprCap as M23GraphicsGovernor['profile']['dprCap'],
    postEnabled: profile.postEnabled,
    particleScale: finiteNumber(profile.particleScale, `${path}.particleScale`),
    weatherScale: finiteNumber(profile.weatherScale, `${path}.weatherScale`),
    transientParticleCap: nonNegativeInteger(profile.transientParticleCap, `${path}.transientParticleCap`),
  }
}

function parseArtworkCache(value: unknown): M23ArtworkCache {
  const cache = record(value, 'artworkCache')
  return {
    totalEntries: nonNegativeInteger(cache.totalEntries, 'artworkCache.totalEntries'),
    activeEntries: nonNegativeInteger(cache.activeEntries, 'artworkCache.activeEntries'),
    inactiveEntries: nonNegativeInteger(cache.inactiveEntries, 'artworkCache.inactiveEntries'),
    estimatedDecodedBytes: nonNegativeInteger(cache.estimatedDecodedBytes, 'artworkCache.estimatedDecodedBytes'),
    evictions: nonNegativeInteger(cache.evictions, 'artworkCache.evictions'),
  }
}

function parseGovernorWindow(value: unknown, path: string): M23GraphicsGovernor['lastWindow'] {
  if (value === null) return null
  const window = record(value, path)
  if (typeof window.failing !== 'boolean') fail(`${path}.failing`, 'expected a boolean')
  const overBudgetRate = finiteNumber(window.overBudgetRate, `${path}.overBudgetRate`)
  if (overBudgetRate > 1) fail(`${path}.overBudgetRate`, 'expected a value <= 1')
  return {
    sampleCount: nonNegativeInteger(window.sampleCount, `${path}.sampleCount`),
    p50Ms: finiteNumber(window.p50Ms, `${path}.p50Ms`),
    p95Ms: finiteNumber(window.p95Ms, `${path}.p95Ms`),
    maxMs: finiteNumber(window.maxMs, `${path}.maxMs`),
    overBudgetCount: nonNegativeInteger(window.overBudgetCount, `${path}.overBudgetCount`),
    overBudgetRate,
    failing: window.failing,
  }
}

function parseGovernorTransition(value: unknown, path: string): NonNullable<M23GraphicsGovernor['pending']> {
  const transition = record(value, path)
  return {
    action: nonEmptyString(transition.action, `${path}.action`) as NonNullable<M23GraphicsGovernor['pending']>['action'],
    from: parseGraphicsProfile(transition.from, `${path}.from`),
    to: parseGraphicsProfile(transition.to, `${path}.to`),
    reason: 'active-frame-window',
  }
}

function parseGovernor(value: unknown): M23GraphicsGovernor {
  const governor = record(value, 'governor')
  return {
    profile: parseGraphicsProfile(governor.profile, 'governor.profile'),
    activeFrameCount: nonNegativeInteger(governor.activeFrameCount, 'governor.activeFrameCount'),
    activeGapCount: nonNegativeInteger(governor.activeGapCount, 'governor.activeGapCount'),
    consecutiveFailingWindows: nonNegativeInteger(
      governor.consecutiveFailingWindows,
      'governor.consecutiveFailingWindows',
    ),
    pending: governor.pending === null
      ? null
      : parseGovernorTransition(governor.pending, 'governor.pending'),
    lastWindow: parseGovernorWindow(governor.lastWindow, 'governor.lastWindow'),
    transitions: array(governor.transitions, 'governor.transitions').map((entry, index) =>
      parseGovernorTransition(entry, `governor.transitions[${index}]`),
    ),
  }
}

function parseAssetComplexity(value: unknown): Record<string, number> {
  const rawComplexity = record(value, 'assetComplexity')
  if (Object.keys(rawComplexity).length === 0) fail('assetComplexity', 'expected at least one metric')
  const complexity: Record<string, number> = {}
  for (const [name, amount] of Object.entries(rawComplexity)) {
    complexity[name] = finiteNumber(amount, `assetComplexity.${name}`)
  }
  return complexity
}

function parseBattleChunks(value: unknown): M23MetricsEvidence['battleChunks'] {
  const raw = record(value, 'battleChunks')
  const files = array(raw.files, 'battleChunks.files').map((entry, index) => {
    const file = record(entry, `battleChunks.files[${index}]`)
    if (typeof file.battleRelevant !== 'boolean') {
      fail(`battleChunks.files[${index}].battleRelevant`, 'expected a boolean')
    }
    return {
      name: nonEmptyString(file.name, `battleChunks.files[${index}].name`),
      bytes: nonNegativeInteger(file.bytes, `battleChunks.files[${index}].bytes`),
      gzipBytes: nonNegativeInteger(file.gzipBytes, `battleChunks.files[${index}].gzipBytes`),
      battleRelevant: file.battleRelevant,
    }
  })
  if (!files.some((file) => file.battleRelevant)) {
    fail('battleChunks.files', 'expected at least one battle-relevant production chunk')
  }
  return { files }
}

function parseOptionalRendererRoute(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  const route = nonEmptyString(value, path)
  if (!M23_RENDERER_ROUTES.includes(route as (typeof M23_RENDERER_ROUTES)[number])) {
    fail(path, `expected one of ${M23_RENDERER_ROUTES.join(', ')}`)
  }
  return route
}

function parseOptionalNullableString(value: unknown, path: string): string | null | undefined {
  if (value === undefined || value === null) return value
  return nonEmptyString(value, path)
}

function parseOptionalArtworkModes(value: unknown): M23MetricsEvidence['artworkModes'] {
  if (value === undefined) return undefined
  const raw = record(value, 'artworkModes')
  const mode = (entry: unknown, path: string): 'artwork' | 'silhouette' | null => {
    if (entry === null) return null
    if (entry !== 'artwork' && entry !== 'silhouette') {
      fail(path, 'expected artwork, silhouette, or null')
    }
    return entry
  }
  return {
    player: mode(raw.player, 'artworkModes.player'),
    foe: mode(raw.foe, 'artworkModes.foe'),
  }
}

function parseSchemaVersion(value: unknown): typeof M23_EVIDENCE_SCHEMA_VERSION {
  if (value !== M23_EVIDENCE_SCHEMA_VERSION) {
    fail('schemaVersion', `expected ${M23_EVIDENCE_SCHEMA_VERSION}`)
  }
  return M23_EVIDENCE_SCHEMA_VERSION
}

export function parseM23MetricsEvidence(value: unknown): M23MetricsEvidence {
  const raw = record(value, 'metrics')
  const evidenceKind = raw.evidenceKind === undefined ? 'full' : raw.evidenceKind
  if (evidenceKind !== 'full' && evidenceKind !== 'performance') {
    fail('evidenceKind', 'expected full or performance')
  }
  const viewport = record(raw.viewport, 'viewport')
  const checkpoints = array(raw.checkpoints, 'checkpoints').map((entry, index) =>
    checkpoint(entry, `checkpoints[${index}]`),
  )
  if (evidenceKind === 'full') assertCheckpointCoverage(checkpoints, 'checkpoints')

  const longTasks = array(raw.longTasks, 'longTasks').map((entry, index) => {
    const task = record(entry, `longTasks[${index}]`)
    return {
      startTimeMs: finiteNumber(task.startTimeMs, `longTasks[${index}].startTimeMs`),
      durationMs: finiteNumber(task.durationMs, `longTasks[${index}].durationMs`),
    }
  })

  const activeCue = raw.activeCue
  if (activeCue !== null && (typeof activeCue !== 'string' || activeCue.trim().length === 0)) {
    fail('activeCue', 'expected null or a non-empty string')
  }

  return {
    schemaVersion: parseSchemaVersion(raw.schemaVersion),
    evidenceKind,
    scenarioId: nonEmptyString(raw.scenarioId, 'scenarioId'),
    environment: parseEnvironment(raw.environment),
    viewport: {
      width: positiveInteger(viewport.width, 'viewport.width'),
      height: positiveInteger(viewport.height, 'viewport.height'),
    },
    seed: nonEmptyString(raw.seed, 'seed'),
    graphics: nonEmptyString(raw.graphics, 'graphics'),
    rendererFailure: parseOptionalNullableString(raw.rendererFailure, 'rendererFailure'),
    artworkFixture: parseOptionalNullableString(raw.artworkFixture, 'artworkFixture'),
    artworkModes: parseOptionalArtworkModes(raw.artworkModes),
    requestedRendererRoute: parseOptionalRendererRoute(raw.requestedRendererRoute, 'requestedRendererRoute'),
    rendererRoute: parseOptionalRendererRoute(raw.rendererRoute, 'rendererRoute'),
    motion: nonEmptyString(raw.motion, 'motion'),
    checkpoints,
    activeFrameGapsMs: (() => {
      const gaps = array(raw.activeFrameGapsMs, 'activeFrameGapsMs')
      if (gaps.length === 0 && evidenceKind === 'full') {
        fail('activeFrameGapsMs', 'expected at least one active rendered frame gap')
      }
      return gaps.map((gap, index) => finiteNumber(gap, `activeFrameGapsMs[${index}]`))
    })(),
    idleCadenceGapsMs: (() => {
      const gaps = array(raw.idleCadenceGapsMs, 'idleCadenceGapsMs')
      if (gaps.length === 0 && evidenceKind === 'full') {
        fail('idleCadenceGapsMs', 'expected at least one idle cadence gap')
      }
      return gaps.map((gap, index) => finiteNumber(gap, `idleCadenceGapsMs[${index}]`))
    })(),
    longTasks,
    rendererResources: parseRendererResources(raw.rendererResources),
    pools: parsePools(raw.pools),
    dpr: finiteNumber(raw.dpr, 'dpr', Number.MIN_VALUE),
    tier: nonEmptyString(raw.tier, 'tier'),
    governor: raw.governor === null && evidenceKind === 'performance'
      ? null
      : parseGovernor(raw.governor),
    artworkCache: raw.artworkCache === null && evidenceKind === 'performance'
      ? null
      : parseArtworkCache(raw.artworkCache),
    activeCue,
    assetComplexity: parseAssetComplexity(raw.assetComplexity),
    firstCastLatencyMs: finiteNumber(raw.firstCastLatencyMs, 'firstCastLatencyMs'),
    battleChunks: parseBattleChunks(raw.battleChunks),
    limitations: stringArray(raw.limitations, 'limitations'),
  }
}

function parseAccessibilityNode(value: unknown, path: string): M23AccessibilityNode {
  const raw = record(value, path)
  const node: M23AccessibilityNode = {
    role: nonEmptyString(raw.role, `${path}.role`),
    name: nonEmptyString(raw.name, `${path}.name`),
  }
  if (raw.value !== undefined) {
    if (typeof raw.value !== 'string' && typeof raw.value !== 'number') {
      fail(`${path}.value`, 'expected a string or number')
    }
    node.value = raw.value
  }
  if (raw.description !== undefined) {
    node.description = nonEmptyString(raw.description, `${path}.description`)
  }
  if (raw.disabled !== undefined) {
    if (typeof raw.disabled !== 'boolean') fail(`${path}.disabled`, 'expected a boolean')
    node.disabled = raw.disabled
  }
  return node
}

export function parseM23AccessibilityEvidence(value: unknown): M23AccessibilityEvidence {
  const raw = record(value, 'accessibility')
  const checkpoints = array(raw.checkpoints, 'checkpoints').map((entry, index) => {
    const path = `checkpoints[${index}]`
    const rawCheckpoint = record(entry, path)
    const nodes = array(rawCheckpoint.nodes, `${path}.nodes`).map((node, nodeIndex) =>
      parseAccessibilityNode(node, `${path}.nodes[${nodeIndex}]`),
    )
    if (nodes.length === 0) fail(`${path}.nodes`, 'expected at least one semantic/AX node')
    return { label: checkpoint(rawCheckpoint.label, `${path}.label`), nodes }
  })
  assertCheckpointCoverage(checkpoints.map(({ label }) => label), 'checkpoints')

  return {
    schemaVersion: parseSchemaVersion(raw.schemaVersion),
    scenarioId: nonEmptyString(raw.scenarioId, 'scenarioId'),
    checkpoints,
    limitations: stringArray(raw.limitations, 'limitations'),
  }
}

const EVIDENCE_FILE_NAMES: readonly M23EvidenceFileName[] = [
  'screenshot.png',
  'metrics.json',
  'accessibility.json',
]

export function parseM23EvidencePath(path: string): M23EvidencePath {
  const segments = path.split('/')
  if (segments.length !== 5 || segments[0] !== 'test-runs' || segments[1] !== 'm23') {
    fail('path', 'expected test-runs/m23/<device>/<scenario>/<evidence-file>')
  }
  const device = nonEmptyString(segments[2], 'path device')
  const scenarioId = nonEmptyString(segments[3], 'path scenario')
  const unexpectedSegment = [device, scenarioId].find((segment) =>
    segment === '.' || segment === '..' || segment.includes('\\'),
  )
  if (unexpectedSegment !== undefined) fail('path', 'device and scenario must be safe path segments')
  const fileName = segments[4]
  if (!EVIDENCE_FILE_NAMES.includes(fileName as M23EvidenceFileName)) {
    fail('path', `expected one of ${EVIDENCE_FILE_NAMES.join(', ')}`)
  }
  return { device, scenarioId, fileName: fileName as M23EvidenceFileName }
}

export function validateM23EvidenceFileSet(paths: readonly string[]): M23EvidencePath[] {
  const parsed = paths.map(parseM23EvidencePath)
  if (parsed.length !== EVIDENCE_FILE_NAMES.length) {
    fail('paths', `expected exactly ${EVIDENCE_FILE_NAMES.length} evidence files`)
  }
  const first = parsed[0]
  if (first === undefined) fail('paths', 'expected evidence files')
  for (const evidencePath of parsed) {
    if (evidencePath.device !== first.device || evidencePath.scenarioId !== first.scenarioId) {
      fail('paths', 'all evidence files must share one device and scenario')
    }
  }
  for (const required of EVIDENCE_FILE_NAMES) {
    if (parsed.filter(({ fileName }) => fileName === required).length !== 1) {
      fail('paths', `expected exactly one ${required}`)
    }
  }
  return parsed
}
