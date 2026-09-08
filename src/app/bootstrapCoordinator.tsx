import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { useIncubator } from '@/store/incubatorStore'
import { useMeta } from '@/store/metaStore'
import { useRoster } from '@/store/rosterStore'

/** The only readiness states exposed to the application UI. */
export type BootstrapStatus = 'loading' | 'ready' | 'partial-error'
export type BootstrapStage = 'roster' | 'meta' | 'incubator'

export interface BootstrapSnapshot {
  status: BootstrapStatus
  attempt: number
  error: string | null
  failedStages: BootstrapStage[]
}

export interface BootstrapControls {
  snapshot: BootstrapSnapshot
  retry: () => Promise<BootstrapSnapshot>
}

interface BootstrapError {
  stage: BootstrapStage
  cause: unknown
}

interface BootstrapFixture {
  delayMs?: number
  failStage?: BootstrapStage | null
}

export interface BootstrapDiagnostics {
  attempt: number
  promiseSerial: number
  stageCalls: Record<BootstrapStage, number>
  snapshot: BootstrapSnapshot
  fixture?: BootstrapFixture
}

interface BootstrapDevController {
  snapshot: () => BootstrapSnapshot
  diagnostics: () => BootstrapDiagnostics
  retry: () => Promise<BootstrapSnapshot>
}

declare global {
  interface Window {
    /** DEV-only fixture read before bootstrap starts, used by the Chrome journey. */
    __MOBIE_BOOTSTRAP_TEST__?: BootstrapFixture
    /** DEV-only inspection/retry seam; never used by product UI. */
    __MOBIE_BOOTSTRAP__?: BootstrapDevController
  }
}

const INITIAL_SNAPSHOT: BootstrapSnapshot = {
  status: 'loading',
  attempt: 0,
  error: null,
  failedStages: [],
}

// The coordinator lives at module scope so StrictMode effects and React remounts
// observe one in-flight attempt and one completed snapshot.
let currentSnapshot = INITIAL_SNAPSHOT
let cachedPromise: Promise<BootstrapSnapshot> | null = null
let attempt = 0
let promiseSerial = 0
let lastFixture: BootstrapFixture | undefined
const stageCalls: Record<BootstrapStage, number> = { roster: 0, meta: 0, incubator: 0 }
const stagePromises: Partial<Record<BootstrapStage, Promise<void>>> = {}
const listeners = new Set<() => void>()

function publish(snapshot: BootstrapSnapshot): void {
  currentSnapshot = snapshot
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): BootstrapSnapshot {
  return currentSnapshot
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  return String(cause)
}

function readFixture(): BootstrapFixture {
  if (!import.meta.env.DEV || typeof window === 'undefined') return {}
  const configured = window.__MOBIE_BOOTSTRAP_TEST__
  const query = new URLSearchParams(window.location.search)
  const queryDelay = Number(query.get('m24BootstrapDelay'))
  const queryStage = query.get('m24BootstrapFail')
  const configuredOwnsFixture = Boolean(configured && (Object.hasOwn(configured, 'failStage') || Object.hasOwn(configured, 'delayMs')))
  const queryFailStage: BootstrapStage | undefined = queryStage === 'roster' || queryStage === 'meta' || queryStage === 'incubator'
    ? queryStage
    : undefined
  const failStage: BootstrapStage | undefined = configuredOwnsFixture
    ? configured?.failStage ?? undefined
    : queryFailStage
  const delayMs = configuredOwnsFixture && Number.isFinite(configured?.delayMs)
    ? Math.max(0, Math.min(10_000, configured!.delayMs!))
    : Number.isFinite(queryDelay) ? Math.max(0, Math.min(10_000, queryDelay)) : 0
  return { delayMs, ...(failStage ? { failStage } : {}) }
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

async function runStage<T>(stage: BootstrapStage, task: () => T | Promise<T>, fixture: BootstrapFixture): Promise<T> {
  stageCalls[stage] += 1
  await wait(fixture.delayMs ?? 0)
  if (fixture.failStage === stage) throw new Error(`模擬 ${stage} 資料載入失敗`)
  return task()
}

function prepareStage(stage: BootstrapStage): void {
  // Keep the previous snapshot in memory for recovery, but make the stage's
  // data UI observe the coordinator gate until this stage completes.
  if (stage === 'roster') useRoster.setState({ loaded: false })
  else if (stage === 'meta') useMeta.setState({ loaded: false })
  else useIncubator.setState({ loaded: false })
}

function ensureStage(
  stage: BootstrapStage,
  task: () => void | Promise<void>,
  fixture: BootstrapFixture,
): Promise<void> {
  const cached = stagePromises[stage]
  if (cached) return cached
  prepareStage(stage)
  const promise = runStage(stage, task, fixture).then(() => undefined)
  const recoverable = promise.catch((cause: unknown) => {
    delete stagePromises[stage]
    throw cause
  })
  stagePromises[stage] = recoverable
  return recoverable
}

function stageLabel(stage: BootstrapStage): string {
  if (stage === 'roster') return 'Mobie 資料'
  if (stage === 'meta') return '圖鑑與成就'
  return '孵化所'
}

async function loadAttempt(attemptNumber: number): Promise<BootstrapSnapshot> {
  const fixture = readFixture()
  lastFixture = fixture
  const errors: BootstrapError[] = []

  // Incubator has no dependency on roster and starts with the roster request.
  const incubatorPromise = ensureStage('incubator', () => useIncubator.getState().loadStrict(), fixture)
    .catch((cause: unknown) => { errors.push({ stage: 'incubator', cause }); return undefined })

  let rosterReady = Boolean(stagePromises.roster)
  try {
    await ensureStage('roster', () => useRoster.getState().loadStrict(), fixture)
    rosterReady = true
  } catch (cause) {
    errors.push({ stage: 'roster', cause })
  }

  // Meta is intentionally sequenced after roster. It hydrates registered
  // species from the canonical roster and must never see the initial seed.
  if (rosterReady) {
    try {
      await ensureStage('meta', () => useMeta.getState().loadStrict(useRoster.getState().roster), fixture)
    } catch (cause) {
      errors.push({ stage: 'meta', cause })
    }
  }

  await incubatorPromise

  if (errors.length === 0) {
    const ready: BootstrapSnapshot = { status: 'ready', attempt: attemptNumber, error: null, failedStages: [] }
    publish(ready)
    return ready
  }

  const failedStages = [...new Set(errors.map(({ stage }) => stage))]
  const details = failedStages.map((stage) => {
    const error = errors.find((entry) => entry.stage === stage)
    return `${stageLabel(stage)}：${messageOf(error?.cause)}`
  })
  const partial: BootstrapSnapshot = {
    status: 'partial-error',
    attempt: attemptNumber,
    error: `資料暫時無法完成載入。${details.join('；')}`,
    failedStages,
  }
  publish(partial)
  return partial
}

function beginBootstrap(): Promise<BootstrapSnapshot> {
  if (cachedPromise) return cachedPromise
  attempt += 1
  promiseSerial += 1
  const attemptNumber = attempt
  publish({ status: 'loading', attempt: attemptNumber, error: null, failedStages: [] })
  const promise = loadAttempt(attemptNumber).catch((cause: unknown) => {
    // Keep an unexpected coordinator error recoverable as a partial error too.
    const partial: BootstrapSnapshot = {
      status: 'partial-error',
      attempt: attemptNumber,
      error: `資料暫時無法完成載入。${messageOf(cause)}`,
      failedStages: [],
    }
    publish(partial)
    return partial
  })
  cachedPromise = promise
  return promise
}

/** Start the cached first attempt. A partial error waits for explicit Retry. */
export function ensureBootstrap(): Promise<BootstrapSnapshot> {
  if (cachedPromise) return cachedPromise
  if (currentSnapshot.status === 'partial-error' || currentSnapshot.status === 'ready') {
    return Promise.resolve(currentSnapshot)
  }
  return beginBootstrap()
}

/** Retry only after a visible partial-error state; while loading it is idempotent. */
export function retryBootstrap(): Promise<BootstrapSnapshot> {
  if (currentSnapshot.status === 'loading' && cachedPromise) return cachedPromise
  if (currentSnapshot.status !== 'partial-error') return ensureBootstrap()
  cachedPromise = null
  return beginBootstrap()
}

export function bootstrapDiagnostics(): BootstrapDiagnostics {
  return {
    attempt,
    promiseSerial,
    stageCalls: { ...stageCalls },
    snapshot: currentSnapshot,
    ...(lastFixture ? { fixture: { ...lastFixture } } : {}),
  }
}

const isolatedControls: BootstrapControls = {
  snapshot: { status: 'ready', attempt: 0, error: null, failedStages: [] },
  retry: async () => isolatedControls.snapshot,
}

const BootstrapContext = createContext<BootstrapControls>(isolatedControls)

/** Supplies the real coordinator to the product tree; isolated screen tests stay ready by default. */
export function BootstrapProvider({ snapshot, children }: { snapshot: BootstrapSnapshot; children: ReactNode }) {
  return <BootstrapContext.Provider value={{ snapshot, retry: retryBootstrap }}>{children}</BootstrapContext.Provider>
}

export function useBootstrap(): BootstrapControls {
  return useContext(BootstrapContext)
}

/** Subscribe to the coordinator without putting readiness in a second state machine. */
export function useBootstrapCoordinator(): BootstrapControls {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { snapshot, retry: retryBootstrap }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__MOBIE_BOOTSTRAP__ = {
    snapshot: () => currentSnapshot,
    diagnostics: bootstrapDiagnostics,
    retry: retryBootstrap,
  }
}
