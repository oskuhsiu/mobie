import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import type { Side } from '@/game/battle/reducer'
import {
  projectBattleAnchor,
  type BattleAnchorKind,
  type BattleScreenPoint,
  type BattleViewport,
} from '@/presentation/battle/battleAnchors'
import type {
  BattleSceneDiagnostics,
  BattleSceneHandle,
  NextBattleSceneProps,
  NormalAttackCue,
} from '@/scene/battle/contracts'
import { StageLights, Pedestal, ArenaFloor, BlobShadow } from './sceneParts'
import {
  Combatant3D,
  makeAnim,
  LUNGE_DUR,
  SHAKE_DUR,
  ENTER_DUR,
  type CombatantRigHandle,
  type MonAnim,
} from './Combatant3D'
import {
  EMPTY_CAMERA_QUEUE,
  acquireCamera,
  cameraShot,
  hasCameraOwnership,
  releaseCamera,
  resetCamera,
  updateCamera,
  type CameraQueueState,
} from './battleCamera'

const PLAYER_BASE: [number, number, number] = [-1.15, 0, 0.2]
const FOE_BASE: [number, number, number] = [1.15, 0, -1.8]
const PLAYER_LUNGE: [number, number] = [0.95, -0.9]
const FOE_LUNGE: [number, number] = [-0.95, 0.9]
const LOOK_AT = new Vector3(0, 1.05, -0.55)
const VIEW_DIR = new Vector3(0, 2.95, 6.4).sub(LOOK_AT).normalize()
const WANT_HALF_W = 2
// Portrait artwork can be wider than its anchor rig; reserve enough world width to avoid edge clipping.
const NARROW_HALF_W = 3
const WANT_HALF_H = 2.5
const MIN_DIST = 7
// Narrow stages place both head anchors in the vertical gap between the foe plate and player HUD.
const NARROW_LOOK_AT_Y_OFFSET = 1.095
const IMPACT_HOLD_SECONDS = 0.28
const ANCHORS: BattleAnchorKind[] = ['root', 'center', 'head', 'ground', 'cast', 'impact']

interface SceneBridge {
  projectAnchor?: (side: Side, anchor: BattleAnchorKind, viewport: BattleViewport) => BattleScreenPoint | null
  publishDiagnostics?: () => void
}

function widePosition(aspect: number, camera: PerspectiveCamera, target: Vector3) {
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360)
  const halfWidth = aspect < 1 ? NARROW_HALF_W : WANT_HALF_W
  const dist = Math.max(MIN_DIST, WANT_HALF_H / tanHalf, halfWidth / (tanHalf * aspect))
  return target.clone().addScaledVector(VIEW_DIR, dist)
}

interface CameraDirectorProps {
  queueRef: { current: CameraQueueState }
  rigs: { current: Record<Side, CombatantRigHandle | null> }
  impactHoldRef: { current: number }
  recoverHoldRef: { current: number }
  reducedMotion: boolean
  onImpactHoldEnd: () => void
  onRecoverEnd: () => void
  onSettled: () => void
}

function CameraDirector({
  queueRef,
  rigs,
  impactHoldRef,
  recoverHoldRef,
  reducedMotion,
  onImpactHoldEnd,
  onRecoverEnd,
  onSettled,
}: CameraDirectorProps) {
  const { camera, size } = useThree()
  const lastSettledShot = useRef<string | null>(null)
  useFrame((_state, delta) => {
    if (impactHoldRef.current > 0) {
      impactHoldRef.current = Math.max(0, impactHoldRef.current - Math.min(delta, 0.05))
      if (impactHoldRef.current === 0) onImpactHoldEnd()
    }
    if (recoverHoldRef.current > 0) {
      recoverHoldRef.current = Math.max(0, recoverHoldRef.current - Math.min(delta, 0.05))
      if (recoverHoldRef.current === 0) onRecoverEnd()
    }
    const perspective = camera as PerspectiveCamera
    const active = queueRef.current.active
    const shot = cameraShot(queueRef.current, reducedMotion)
    const targetSide = shot === 'caster' ? active?.caster : shot === 'impact' ? active?.target : null
    const targetAnchor = targetSide
      ? rigs.current[targetSide]?.getAnchor(shot === 'impact' ? 'impact' : 'center')
      : null
    const aspect = size.width / Math.max(1, size.height)
    const wideTarget = LOOK_AT.clone()
    if (aspect < 1) wideTarget.y += NARROW_LOOK_AT_Y_OFFSET
    const focus = targetAnchor?.getWorldPosition(new Vector3()) ?? wideTarget
    const target = wideTarget.clone().lerp(focus, shot === 'caster' ? 0.08 : shot === 'impact' ? 0.18 : 0)
    const wide = widePosition(aspect, perspective, LOOK_AT)
    const desiredPosition = shot === 'wide'
      ? wide
      : wide
        .clone()
        .add(target.clone().sub(wideTarget))
        .addScaledVector(VIEW_DIR, shot === 'impact' ? -0.45 : 0)
    if (reducedMotion) {
      perspective.position.copy(wide)
      perspective.lookAt(wideTarget)
    } else {
      const blend = 1 - Math.exp(-Math.min(delta, 0.05) * 8)
      perspective.position.lerp(desiredPosition, blend)
      perspective.lookAt(target)
    }
    perspective.updateMatrixWorld()
    perspective.updateProjectionMatrix()
    const settledKey = `${shot}:${active?.cueId ?? ''}:${size.width}x${size.height}`
    if (perspective.position.distanceTo(desiredPosition) < 0.015 && lastSettledShot.current !== settledKey) {
      lastSettledShot.current = settledKey
      onSettled()
    }
  })
  return null
}

interface SceneBridgeProbeProps {
  bridge: { current: SceneBridge }
  rigs: { current: Record<Side, CombatantRigHandle | null> }
  queueRef: { current: CameraQueueState }
  motionPhaseRef: { current: BattleSceneDiagnostics['motionPhase'] }
  artworkModeRef: { current: BattleSceneDiagnostics['artworkMode'] }
  reducedMotion: boolean
  onSceneDiagnostics?: (diagnostics: BattleSceneDiagnostics) => void
}

function SceneBridgeProbe({
  bridge,
  rigs,
  queueRef,
  motionPhaseRef,
  artworkModeRef,
  reducedMotion,
  onSceneDiagnostics,
}: SceneBridgeProbeProps) {
  const { camera, size } = useThree()
  const scratch = useRef(new Vector3())
  const project = useCallback((side: Side, anchor: BattleAnchorKind, viewport: BattleViewport) => {
    const object = rigs.current[side]?.getAnchor(anchor)
    if (!object) return null
    object.updateWorldMatrix(true, false)
    const point = object.getWorldPosition(scratch.current).project(camera)
    return {
      x: (point.x + 1) * 0.5 * Math.max(0, viewport.width),
      y: (1 - point.y) * 0.5 * Math.max(0, viewport.height),
    }
  }, [camera, rigs])
  const publish = useCallback(() => {
    if (!onSceneDiagnostics) return
    const viewport = { width: size.width, height: size.height }
    const player = Object.fromEntries(
      ANCHORS.map((anchor) => [anchor, project('player', anchor, viewport)]),
    )
    const foe = Object.fromEntries(ANCHORS.map((anchor) => [anchor, project('foe', anchor, viewport)]))
    const complete = [...Object.values(player), ...Object.values(foe)].every(Boolean)
    onSceneDiagnostics({
      cameraShot: cameraShot(queueRef.current, reducedMotion),
      cameraOwner: queueRef.current.active?.owner ?? null,
      motionPhase: motionPhaseRef.current,
      artworkMode: { ...artworkModeRef.current },
      anchors: complete ? {
        player: player as Record<BattleAnchorKind, BattleScreenPoint>,
        foe: foe as Record<BattleAnchorKind, BattleScreenPoint>,
      } : null,
    })
  }, [
    artworkModeRef,
    motionPhaseRef,
    onSceneDiagnostics,
    project,
    queueRef,
    reducedMotion,
    size.height,
    size.width,
  ])
  useLayoutEffect(() => {
    bridge.current.projectAnchor = project
    bridge.current.publishDiagnostics = publish
    publish()
    return () => {
      bridge.current.projectAnchor = undefined
      bridge.current.publishDiagnostics = undefined
    }
  }, [bridge, project, publish])
  return null
}

function DiagnosticsProbe({
  onRenderedFrame,
  onRendererDiagnostics,
}: Pick<NextBattleSceneProps, 'onRenderedFrame' | 'onRendererDiagnostics'>) {
  const frame = useRef(0)
  useFrame(({ gl }) => {
    onRenderedFrame?.(performance.now())
    frame.current += 1
    if (!onRendererDiagnostics || frame.current % 60 !== 0) return
    onRendererDiagnostics({
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
      triangles: gl.info.render.triangles,
      drawCalls: gl.info.render.calls,
    })
  })
  return null
}

function RendererLifecycle({
  onReady,
  onFatal,
  devShaderFailure,
}: Pick<NextBattleSceneProps, 'onReady' | 'onFatal' | 'devShaderFailure'>) {
  const { gl } = useThree()
  const ready = useRef(false)
  const failed = useRef(false)
  const onReadyRef = useRef(onReady)
  const onFatalRef = useRef(onFatal)
  onReadyRef.current = onReady
  onFatalRef.current = onFatal
  useLayoutEffect(() => {
    const canvas = gl.domElement
    const previousShaderError = gl.debug.onShaderError
    const fail = () => {
      if (failed.current) return
      failed.current = true
      onFatalRef.current('shader-error')
    }
    const loseContext = (event: Event) => {
      event.preventDefault()
      if (failed.current) return
      failed.current = true
      onFatalRef.current('context-lost')
    }
    canvas.addEventListener('webglcontextlost', loseContext)
    gl.debug.checkShaderErrors = true
    gl.debug.onShaderError = fail
    if (devShaderFailure) fail()
    else if (!ready.current) {
      ready.current = true
      onReadyRef.current()
    }
    return () => {
      canvas.removeEventListener('webglcontextlost', loseContext)
      if (gl.debug.onShaderError === fail) gl.debug.onShaderError = previousShaderError
    }
  }, [devShaderFailure, gl])
  return null
}

const BattleStage = forwardRef<BattleSceneHandle, NextBattleSceneProps>(function BattleStage({
  snapshot,
  tier,
  onReady,
  onFatal,
  onRenderedFrame,
  onRendererDiagnostics,
  onSceneDiagnostics,
  devShaderFailure,
  paused,
  reducedMotion,
}, ref) {
  const { player, foe, palette } = snapshot
  const anim = useRef<Record<Side, MonAnim>>({ player: makeAnim(), foe: makeAnim() })
  const timeScaleRef = useRef(1)
  const rigs = useRef<Record<Side, CombatantRigHandle | null>>({ player: null, foe: null })
  const queueRef = useRef<CameraQueueState>(EMPTY_CAMERA_QUEUE)
  const impactHoldRef = useRef(0)
  const recoverHoldRef = useRef(0)
  const motionPhaseRef = useRef<BattleSceneDiagnostics['motionPhase']>('idle')
  const artworkModeRef = useRef<BattleSceneDiagnostics['artworkMode']>({ player: 'silhouette', foe: 'silhouette' })
  const bridge = useRef<SceneBridge>({})
  const publish = () => bridge.current.publishDiagnostics?.()
  const setArtworkMode = (side: Side, mode: 'artwork' | 'silhouette') => {
    if (artworkModeRef.current[side] === mode) return
    artworkModeRef.current = { ...artworkModeRef.current, [side]: mode }
    publish()
  }
  const runNormalAttack = (cue: NormalAttackCue) => {
    const ownership = { cueId: cue.cueId, owner: cue.owner, caster: cue.caster, target: cue.target }
    if (cue.phase === 'anticipate') {
      motionPhaseRef.current = cue.phase
      recoverHoldRef.current = 0
      queueRef.current = acquireCamera(queueRef.current, ownership, 'caster')
      anim.current[cue.caster].attackPhase = 'anticipate'
    } else if (cue.phase === 'contact') {
      motionPhaseRef.current = cue.phase
      queueRef.current = updateCamera(queueRef.current, cue.cueId, cue.owner, 'impact')
      impactHoldRef.current = IMPACT_HOLD_SECONDS
      anim.current[cue.caster].attackPhase = 'contact'
      if (cue.didHit) anim.current[cue.target].attackPhase = 'hit-react'
    } else if (cue.phase === 'hit-react') {
      motionPhaseRef.current = cue.phase
      anim.current[cue.target].attackPhase = 'hit-react'
      anim.current[cue.target].shakeT = reducedMotion ? 0 : SHAKE_DUR
      anim.current[cue.target].shakeMag = reducedMotion ? 0 : 0.16
    } else {
      const owned = hasCameraOwnership(queueRef.current, cue.cueId, cue.owner)
      queueRef.current = releaseCamera(queueRef.current, cue.cueId, cue.owner)
      if (!owned) {
        publish()
        return
      }
      motionPhaseRef.current = cue.phase
      impactHoldRef.current = 0
      recoverHoldRef.current = 0.2
      anim.current[cue.caster].attackPhase = 'recover'
      anim.current[cue.target].attackPhase = 'recover'
      anim.current[cue.caster].attackT = 0.2
      anim.current[cue.target].attackT = 0.2
    }
    publish()
  }
  useEffect(() => {
    publish()
  }, [reducedMotion])
  const finishRecover = () => {
    if (motionPhaseRef.current !== 'recover') return
    motionPhaseRef.current = 'idle'
    publish()
  }
  const finishImpactHold = () => {
    const active = queueRef.current.active
    if (!active || active.shot !== 'impact') return
    queueRef.current = releaseCamera(queueRef.current, active.cueId, active.owner)
    motionPhaseRef.current = 'recover'
    anim.current[active.caster].attackPhase = 'recover'
    anim.current[active.target].attackPhase = 'recover'
    anim.current[active.caster].attackT = 0.3
    anim.current[active.target].attackT = 0.3
    recoverHoldRef.current = 0.3
    publish()
  }
  useImperativeHandle(ref, () => ({
    normalAttack: runNormalAttack,
    lunge: (side) => { anim.current[side].lungeT = reducedMotion ? 0 : LUNGE_DUR },
    hitReact: (side, strength = 1) => {
      anim.current[side].shakeT = reducedMotion ? 0 : SHAKE_DUR
      anim.current[side].shakeMag = reducedMotion ? 0 : 0.16 * strength
    },
    faint: (side) => { anim.current[side].fainted = true },
    enter: (side) => {
      const state = anim.current[side]
      state.fainted = false
      state.faintT = 0
      state.enterT = ENTER_DUR
    },
    setTimeScale: (scale) => { timeScaleRef.current = scale },
    resetPresentation: () => {
      for (const side of ['player', 'foe'] as const) Object.assign(anim.current[side], makeAnim())
      timeScaleRef.current = 1
      queueRef.current = resetCamera()
      impactHoldRef.current = 0
      recoverHoldRef.current = 0
      motionPhaseRef.current = 'idle'
      publish()
    },
    projectAnchor: (side, anchor, viewport) => (
      bridge.current.projectAnchor?.(side, anchor, viewport)
      ?? projectBattleAnchor(side, anchor, viewport)
    ),
  }), [reducedMotion])
  return (
    <Canvas
      className="battle-next-canvas"
      dpr={[1, tier === 'high' ? 1.5 : 1]}
      frameloop={paused ? 'never' : 'always'}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 2.95, 6.4], fov: 40 }}
      style={{ position: 'absolute', inset: 0, zIndex: 0 }}
    >
      <RendererLifecycle onReady={onReady} onFatal={onFatal} devShaderFailure={devShaderFailure} />
      {palette?.fog && <fog attach="fog" args={[palette.fog.color, palette.fog.near, palette.fog.far]} />}
      {(onRenderedFrame || onRendererDiagnostics) && (
        <DiagnosticsProbe
          onRenderedFrame={onRenderedFrame}
          onRendererDiagnostics={onRendererDiagnostics}
        />
      )}
      <SceneBridgeProbe
        bridge={bridge}
        rigs={rigs}
        queueRef={queueRef}
        motionPhaseRef={motionPhaseRef}
        artworkModeRef={artworkModeRef}
        reducedMotion={reducedMotion}
        onSceneDiagnostics={onSceneDiagnostics}
      />
      <CameraDirector
        queueRef={queueRef}
        rigs={rigs}
        impactHoldRef={impactHoldRef}
        recoverHoldRef={recoverHoldRef}
        reducedMotion={reducedMotion}
        onImpactHoldEnd={finishImpactHold}
        onRecoverEnd={finishRecover}
        onSettled={publish}
      />
      <StageLights ambient={palette?.ambient} />
      <ArenaFloor tint={palette?.groundTint} />
      <Pedestal position={FOE_BASE} color="#ff7a9c" />
      <Pedestal position={PLAYER_BASE} color="#5b8cff" />
      <group position={FOE_BASE}><BlobShadow /></group>
      <group position={PLAYER_BASE}><BlobShadow /></group>
      <Combatant3D
        ref={(handle) => { rigs.current.foe = handle }}
        side="foe"
        mon={foe}
        anim={anim.current.foe}
        base={FOE_BASE}
        lungeVec={FOE_LUNGE}
        faceY={Math.PI}
        bobPhase={Math.PI}
        timeScaleRef={timeScaleRef}
        reducedMotion={reducedMotion}
        onArtworkModeChange={(mode) => setArtworkMode('foe', mode)}
      />
      <Combatant3D
        ref={(handle) => { rigs.current.player = handle }}
        side="player"
        mon={player}
        anim={anim.current.player}
        base={PLAYER_BASE}
        lungeVec={PLAYER_LUNGE}
        faceY={0}
        bobPhase={0}
        timeScaleRef={timeScaleRef}
        reducedMotion={reducedMotion}
        onArtworkModeChange={(mode) => setArtworkMode('player', mode)}
      />
    </Canvas>
  )
})

export default BattleStage
