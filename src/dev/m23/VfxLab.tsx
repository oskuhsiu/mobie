import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react'
import { getMove } from '@/game/data/moves'
import { useBattleStore } from '@/store/battleStore'
import type { BattleVfxDiagnostics, BattleVfxHandle } from '@/scene/r3f/BattleVfx'
import type { VfxCue, VfxLabControls, VfxRecipe } from '@/scene/r3f/vfxRuntime'

export type { VfxLabControls } from '@/scene/r3f/vfxRuntime'

export interface VfxLabProps {
  vfxRef: RefObject<BattleVfxHandle | null>
  controlsRef: MutableRefObject<VfxLabControls>
}

interface RendererSample {
  label: 'baseline' | 'first' | 'warm' | 'final'
  cast: number
  at: number
  geometries: number
  textures: number
  programs: number
  triangles: number
  drawCalls: number
  frameTiming: FrameTiming | null
  runtime: BattleVfxDiagnostics | null
}

interface FrameTiming {
  frameCount: number
  maxFrameMs: number
  meanFrameMs: number
}

interface ActiveFrameWindow {
  active: boolean
  lastAt: number
  frameCount: number
  totalFrameMs: number
  maxFrameMs: number
}

const RECIPES: readonly VfxRecipe[] = ['physical', 'electric', 'status']
const PHASES: readonly VfxCue['phase'][] = ['anticipate', 'cast', 'impact', 'recover']

function waitMs(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve(true)
    }, ms)
    const abort = () => {
      window.clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function runtimeDiagnostics(handle: BattleVfxHandle | null): BattleVfxDiagnostics | null {
  return handle?.diagnostics() ?? null
}

function downloadJson(fileName: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([
    `${JSON.stringify(value, null, 2)}\n`,
  ], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

const panelStyle = {
  position: 'absolute',
  top: 12,
  right: 12,
  width: 310,
  maxHeight: 'calc(100vh - 24px)',
  overflow: 'auto',
  padding: 12,
  border: '1px solid rgba(152, 205, 255, 0.65)',
  borderRadius: 10,
  color: '#eaf6ff',
  background: 'rgba(7, 15, 28, 0.92)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
  font: '12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
  pointerEvents: 'auto',
  userSelect: 'text',
} as const

const rowStyle = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  gap: 8,
  alignItems: 'center',
  marginTop: 7,
} as const

/** DEV-only controls and telemetry. Mount as a child of the existing R3F Canvas. */
export default function VfxLab({ vfxRef, controlsRef }: VfxLabProps) {
  const { gl } = useThree()
  const initial = controlsRef.current
  const [recipe, setRecipe] = useState<VfxRecipe>('physical')
  const [phase, setPhase] = useState<VfxCue['phase']>('impact')
  const [frozen, setFrozen] = useState(initial.frozen)
  const [seed, setSeed] = useState(initial.seed)
  const [tier, setTier] = useState<'auto' | 'balanced' | 'high'>(initial.tier ?? 'auto')
  const [motion, setMotion] = useState<'system' | 'full' | 'reduced'>(
    initial.reducedMotion === null ? 'system' : initial.reducedMotion ? 'reduced' : 'full',
  )
  const [intensity, setIntensity] = useState(initial.intensity ?? 1)
  const [autoIntensity, setAutoIntensity] = useState(initial.intensity === null)
  const [forceFallback, setForceFallback] = useState(initial.forceFallback)
  const [osReducedMotion, setOsReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [running, setRunning] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [completedCasts, setCompletedCasts] = useState(0)
  const [fixtureStatus, setFixtureStatus] = useState('')
  const [runtimeErrors, setRuntimeErrors] = useState(0)
  const [runTarget, setRunTarget] = useState(100)
  const [samples, setSamples] = useState<RendererSample[]>([])
  const [liveSample, setLiveSample] = useState<RendererSample | null>(null)
  const samplesRef = useRef<RendererSample[]>([])
  const runningRef = useRef(false)
  const castSerial = useRef(0)
  const runAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const frameWindowRef = useRef<ActiveFrameWindow>({
    active: false,
    lastAt: 0,
    frameCount: 0,
    totalFrameMs: 0,
    maxFrameMs: 0,
  })
  const lastFrameTimingRef = useRef<FrameTiming | null>(null)

  useFrame(() => {
    const window = frameWindowRef.current
    if (!window.active) return
    const now = performance.now()
    const gap = now - window.lastAt
    window.lastAt = now
    window.frameCount += 1
    window.totalFrameMs += gap
    window.maxFrameMs = Math.max(window.maxFrameMs, gap)
  })

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setOsReducedMotion(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const recordError = () => setRuntimeErrors((count) => count + 1)
    window.addEventListener('error', recordError)
    window.addEventListener('unhandledrejection', recordError)
    return () => {
      mountedRef.current = false
      runAbortRef.current?.abort()
      window.removeEventListener('error', recordError)
      window.removeEventListener('unhandledrejection', recordError)
    }
  }, [])

  useLayoutEffect(() => {
    controlsRef.current = {
      frozen,
      seed,
      tier: tier === 'auto' ? null : tier,
      reducedMotion: osReducedMotion ? true : motion === 'system' ? null : motion === 'reduced',
      intensity: autoIntensity ? null : intensity,
      forceFallback,
    }
  }, [autoIntensity, controlsRef, forceFallback, frozen, intensity, motion, osReducedMotion, seed, tier])

  const sample = useCallback((
    label: RendererSample['label'],
    cast: number,
    frameTiming = lastFrameTimingRef.current,
  ): RendererSample => ({
    label,
    cast,
    at: performance.now(),
    geometries: gl.info.memory.geometries,
    textures: gl.info.memory.textures,
    programs: gl.info.programs?.length ?? 0,
    triangles: gl.info.render.triangles,
    drawCalls: gl.info.render.calls,
    frameTiming,
    runtime: runtimeDiagnostics(vfxRef.current),
  }), [gl, vfxRef])

  const cue = useCallback(async (
    selectedRecipe: VfxRecipe = recipe,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    const handle = vfxRef.current
    if (!handle || signal?.aborted) return false
    frameWindowRef.current = {
      active: true,
      lastAt: performance.now(),
      frameCount: 0,
      totalFrameMs: 0,
      maxFrameMs: 0,
    }
    const serial = ++castSerial.current
    const cueBase = {
      cueId: `vfx-lab:${seed}:${serial}`,
      owner: 'vfx-lab',
      caster: 'player' as const,
      target: selectedRecipe === 'status' ? 'player' as const : 'foe' as const,
      recipe: selectedRecipe,
      didHit: true,
    }
    const reduced = osReducedMotion || motion === 'reduced'
    const waits = [160, reduced ? 120 : 280, 640, 140]
    let completed = true
    for (let index = 0; index < PHASES.length; index += 1) {
      if (signal?.aborted || vfxRef.current !== handle) {
        completed = false
        break
      }
      handle.cue({ ...cueBase, phase: PHASES[index] })
      if (!await waitMs(waits[index], signal)) {
        completed = false
        break
      }
    }
    const frameWindow = frameWindowRef.current
    frameWindow.active = false
    lastFrameTimingRef.current = {
      frameCount: frameWindow.frameCount,
      maxFrameMs: frameWindow.maxFrameMs,
      meanFrameMs: frameWindow.frameCount > 0
        ? frameWindow.totalFrameMs / frameWindow.frameCount
        : 0,
    }
    if (completed && mountedRef.current) setCompletedCasts((value) => value + 1)
    return completed
  }, [motion, osReducedMotion, recipe, seed, vfxRef])

  const runCasts = useCallback(async (
    count = 100,
    selectedRecipe: VfxRecipe = recipe,
  ): Promise<readonly RendererSample[]> => {
    if (runningRef.current) return samplesRef.current
    const boundedCount = Math.max(1, Math.min(100, Math.floor(count)))
    const abort = new AbortController()
    runAbortRef.current = abort
    runningRef.current = true
    setRunning(true)
    setRunTarget(boundedCount)
    setCompletedCasts(0)
    const nextSamples: RendererSample[] = [sample('baseline', 0, null)]
    let completed = 0
    try {
      for (let index = 1; index <= boundedCount; index += 1) {
        if (!await cue(selectedRecipe, abort.signal)) break
        completed = index
        if (index === 1) nextSamples.push(sample('first', index, lastFrameTimingRef.current))
        if (index === 2) nextSamples.push(sample('warm', index, lastFrameTimingRef.current))
      }
      if (completed === boundedCount && await waitMs(32, abort.signal)) {
        nextSamples.push(sample('final', boundedCount))
      }
      samplesRef.current = nextSamples
      if (mountedRef.current) setSamples(nextSamples)
      return nextSamples
    } finally {
      runningRef.current = false
      if (runAbortRef.current === abort) runAbortRef.current = null
      if (mountedRef.current) setRunning(false)
    }
  }, [cue, recipe, sample])

  const reset = useCallback(() => {
    vfxRef.current?.reset()
    castSerial.current = 0
    samplesRef.current = []
    lastFrameTimingRef.current = null
    setSamples([])
    setLiveSample(null)
    setCompletedCasts(0)
  }, [vfxRef])

  const stopRun = useCallback(() => {
    runAbortRef.current?.abort()
  }, [])

  const emitPhaseAndFreeze = useCallback(() => {
    const handle = vfxRef.current
    if (!handle) return
    const nextControls = { ...controlsRef.current, frozen: true }
    controlsRef.current = nextControls
    setFrozen(true)
    const serial = ++castSerial.current
    handle.cue({
      cueId: `vfx-lab-phase:${seed}:${serial}`,
      owner: 'vfx-lab',
      caster: 'player',
      target: recipe === 'status' ? 'player' : 'foe',
      recipe,
      phase,
      didHit: true,
    })
    setLiveSample(sample('final', completedCasts))
  }, [completedCasts, controlsRef, phase, recipe, sample, seed, vfxRef])

  const refreshDiagnostics = useCallback(() => {
    setLiveSample(sample('final', completedCasts))
  }, [completedCasts, sample])

  const exportPreset = useCallback(() => downloadJson(
    `mobie-vfx-${recipe}-${seed}.json`,
    {
      schemaVersion: 1,
      recipe,
      requestedMotion: motion,
      osReducedMotion,
      controls: controlsRef.current,
      samples: samplesRef.current,
      runtime: runtimeDiagnostics(vfxRef.current),
    },
  ), [controlsRef, motion, osReducedMotion, recipe, seed, vfxRef])

  const prepareFixture = useCallback((kind: VfxRecipe) => {
    const driver = window.__MOBIE_M23_BASELINE__
    if (!driver) {
      setFixtureStatus('Open the M23 baseline scenario first')
      return
    }
    const fixture = kind === 'status' ? 'status-buff' : 'normal-hit-chain-ready'
    driver.prepareTransactionCase(fixture)
    if (kind === 'electric') {
      const current = useBattleStore.getState()
      if (!current.battle) {
        setFixtureStatus('No active battle')
        return
      }
      const battle = structuredClone(current.battle)
      const activeIndex = battle.player.activeIndex
      const electric = getMove(1030)
      battle.player.members = battle.player.members.map((member, index) => index === activeIndex
        ? { ...member, move: electric, moves: [electric, ...member.moves.filter((move) => move.id !== electric.id)] }
        : member)
      useBattleStore.setState({ battle, phase: 'playerChoice' })
    }
    setFixtureStatus(`${kind} fixture ready`)
  }, [])

  const openLegacyComparison = useCallback(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('graphics', 'compatibility')
    window.open(url, 'mobie-vfx-legacy', 'noopener')
  }, [])

  if (!import.meta.env.DEV) return null

  const diagnostics = runtimeDiagnostics(vfxRef.current)
  const latest = liveSample ?? samples.at(-1)
  return (
    <Html fullscreen style={{ pointerEvents: 'none' }}>
      <section
        aria-label="M23 VFX Lab"
        data-vfx-lab="ready"
        data-vfx-running={running}
        data-vfx-casts={completedCasts}
        data-vfx-runtime-errors={runtimeErrors}
        data-vfx-panel-open={panelOpen}
        data-vfx-runtime={vfxRef.current ? 'ready' : 'missing'}
        data-vfx-diagnostics={JSON.stringify(diagnostics)}
        style={panelStyle}
      >
        <details
          data-vfx-panel-details
          open={panelOpen}
          onToggle={(event) => setPanelOpen(event.currentTarget.open)}
        >
          <summary data-vfx-action="toggle-panel" style={{ cursor: 'pointer' }}>
            <strong>VFX Lab</strong>
            <span style={{ float: 'right' }}>{running ? `${completedCasts}/${runTarget}` : 'DEV'}</span>
          </summary>

        <label style={rowStyle}>
          <span>Recipe</span>
          <select data-vfx-control="recipe" value={recipe} onChange={(event) => setRecipe(event.target.value as VfxRecipe)}>
            {RECIPES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label style={rowStyle}>
          <span>Phase</span>
          <select data-vfx-control="phase" value={phase} onChange={(event) => setPhase(event.target.value as VfxCue['phase'])}>
            {PHASES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label style={rowStyle}>
          <span>Tier</span>
          <select data-vfx-control="tier" value={tier} onChange={(event) => setTier(event.target.value as typeof tier)}>
            <option value="auto">Auto</option>
            <option value="balanced">Balanced</option>
            <option value="high">High</option>
          </select>
        </label>
        <label style={rowStyle}>
          <span>Motion</span>
          <select data-vfx-control="motion" value={motion} onChange={(event) => setMotion(event.target.value as typeof motion)}>
            <option value="system">System</option>
            <option value="reduced">Reduced</option>
            <option value="full" disabled={osReducedMotion}>Full</option>
          </select>
        </label>
        {osReducedMotion && (
          <div role="status" style={{ marginTop: 5, color: '#ffd27d' }}>OS reduced-motion ceiling active</div>
        )}
        <label style={rowStyle}>
          <span>Seed</span>
          <input
            type="number"
            data-vfx-control="seed"
            value={seed}
            onChange={(event) => setSeed(Number.parseInt(event.target.value, 10) || 0)}
          />
        </label>
        <label style={rowStyle}>
          <span>Intensity</span>
          <input
            type="range"
            data-vfx-control="intensity"
            min="0"
            max="1"
            step="0.05"
            value={intensity}
            disabled={autoIntensity}
            onChange={(event) => setIntensity(Number(event.target.value))}
          />
        </label>
        <label style={{ ...rowStyle, gridTemplateColumns: '1fr auto' }}>
          <span>Use app intensity</span>
          <input data-vfx-control="auto-intensity" type="checkbox" checked={autoIntensity} onChange={(event) => setAutoIntensity(event.target.checked)} />
        </label>
        <label style={{ ...rowStyle, gridTemplateColumns: '1fr auto' }}>
          <span>Freeze runtime</span>
          <input data-vfx-control="freeze" type="checkbox" checked={frozen} onChange={(event) => setFrozen(event.target.checked)} />
        </label>
        <label style={{ ...rowStyle, gridTemplateColumns: '1fr auto' }}>
          <span>Force fallback</span>
          <input data-vfx-control="force-fallback" type="checkbox" checked={forceFallback} onChange={(event) => setForceFallback(event.target.checked)} />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 10 }}>
          <button type="button" data-vfx-action="single-cue" disabled={running} onClick={() => void cue()}>Single cue</button>
          <button type="button" data-vfx-action="run-100" disabled={running} onClick={() => void runCasts(100)}>Run 100 casts</button>
          <button type="button" data-vfx-action="stop-run" disabled={!running} onClick={stopRun}>Stop run</button>
          <button type="button" data-vfx-action="emit-phase-freeze" disabled={running} onClick={emitPhaseAndFreeze}>Emit phase + freeze</button>
          <button type="button" data-vfx-action="refresh" onClick={refreshDiagnostics}>Refresh metrics</button>
          <button type="button" data-vfx-action="reset" disabled={running} onClick={reset}>Reset</button>
          <button type="button" data-vfx-action="export-preset" onClick={exportPreset}>Export preset</button>
          <button type="button" disabled={running} onClick={() => window.dispatchEvent(new Event('mobie:m23-unmount-battle'))}>Unmount battle</button>
        </div>

        <div style={{ marginTop: 10 }}>Real battle fixtures</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, marginTop: 5 }}>
          {RECIPES.map((value) => (
            <button
              key={value}
              type="button"
              data-vfx-fixture={value}
              disabled={running}
              onClick={() => prepareFixture(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div role="status" data-vfx-fixture-status style={{ minHeight: 16, marginTop: 5 }}>{fixtureStatus}</div>
        <button
          type="button"
          data-vfx-action="open-legacy"
          style={{ width: '100%', marginTop: 5 }}
          onClick={openLegacyComparison}
        >
          Open legacy comparison
        </button>

        <pre id="vfx-lab-output" style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {JSON.stringify({
            running,
            completedCasts,
            recipe,
            osReducedMotion,
            controls: controlsRef.current,
            fixtureStatus,
            runtimeErrors,
            runtimeErrorScope: 'window error + unhandledrejection; console and shader errors require CDP',
            renderer: latest ? {
              geometries: latest.geometries,
              textures: latest.textures,
              programs: latest.programs,
              triangles: latest.triangles,
              drawCalls: latest.drawCalls,
            } : null,
            runtime: diagnostics,
            samples,
          }, null, 2)}
        </pre>
        </details>
      </section>
    </Html>
  )
}
