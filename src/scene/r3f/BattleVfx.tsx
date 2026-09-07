import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BufferGeometry,
  Color,
  BufferAttribute,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three'
import type { Side } from '@/game/battle/reducer'
import type { CombatantRigHandle } from './Combatant3D'
import {
  VFX_PARTICLE_CAPACITY,
  VfxRuntime,
  type VfxCue,
  type VfxLabControls,
  type VfxRuntimeDiagnostics,
} from './vfxRuntime'

export type { VfxCue } from './vfxRuntime'

export interface BattleVfxHandle {
  cue(cue: VfxCue): void
  reset(): void
  diagnostics(): BattleVfxDiagnostics
}

export interface BattleVfxDiagnostics extends VfxRuntimeDiagnostics {
  shaderMode: 'procedural' | 'fallback'
}

export interface BattleVfxProps {
  rigs: { current: Record<Side, CombatantRigHandle | null> }
  tier: 'balanced' | 'high'
  reducedMotion: boolean
  intensity: number
  timeScaleRef: { current: number }
  forceFallback?: boolean
  controlsRef?: { current: VfxLabControls }
  onDiagnostics?: (diagnostics: BattleVfxDiagnostics) => void
}

const HIDDEN = 10_000
const COLORS = [new Color('#ffd166'), new Color('#83f5ff'), new Color('#b8ff79')]
const SPAWN_ATTRIBUTES = [
  'particleActive',
  'recipeCode',
  'stageCode',
  'casterCode',
  'targetCode',
  'spawnTime',
  'lifetime',
  'angle',
  'radius',
  'variance',
  'size',
  'color',
] as const
const vertexShader = `
  #define MOBIE_VFX_SHADER 1
  attribute float particleActive;
  attribute float recipeCode;
  attribute float stageCode;
  attribute float casterCode;
  attribute float targetCode;
  attribute float spawnTime;
  attribute float lifetime;
  attribute float angle;
  attribute float radius;
  attribute float variance;
  attribute float size;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uTime;
  uniform float uIntensity;
  uniform vec2 uResolution;
  uniform float uReducedMotion;
  uniform vec3 uPlayerCast;
  uniform vec3 uPlayerGround;
  uniform vec3 uPlayerImpact;
  uniform vec3 uFoeCast;
  uniform vec3 uFoeGround;
  uniform vec3 uFoeImpact;
  void main() {
    float age = max(0.0, uTime - spawnTime);
    float progress = clamp(age / max(0.001, lifetime), 0.0, 1.0);
    vec3 casterCast = mix(uPlayerCast, uFoeCast, casterCode);
    vec3 casterGround = mix(uPlayerGround, uFoeGround, casterCode);
    vec3 targetImpact = mix(uPlayerImpact, uFoeImpact, targetCode);
    vec3 p = casterCast;
    if (recipeCode > 1.5) {
      p = mix(uPlayerImpact, uFoeImpact, casterCode);
      float lift = stageCode < 0.5 ? 0.25 : 0.15 + progress * 1.75;
      p.x += cos(angle + progress * 2.2) * radius * 0.72;
      p.z += sin(angle + progress * 2.2) * radius * 0.42;
      p.y += lift + sin(angle * 2.0) * 0.12;
    } else if (stageCode > 0.5 && stageCode < 1.5) {
      if (recipeCode < 0.5) {
        vec3 direction = normalize(targetImpact - casterCast + vec3(0.0001));
        p = casterCast + direction * (0.08 + progress * 0.48);
        p.x += cos(angle + progress * 8.0) * radius * 0.09;
        p.y += sin(progress * 3.14159265) * 0.16;
        p.z += sin(angle + progress * 8.0) * radius * 0.07;
      } else if (uReducedMotion > 0.5) {
        p = variance < 0.55 ? casterCast : targetImpact;
        p.x += cos(angle + progress * 8.0) * radius * 0.13;
        p.y += sin(angle * 2.0 + progress * 5.0) * 0.12;
        p.z += sin(angle + progress * 8.0) * radius * 0.1;
      } else {
        float travel = clamp(variance + age / 0.28, 0.0, 1.0);
        p = mix(casterCast, targetImpact, travel);
        p.y += sin(travel * 3.14159265) * 0.42;
        p.x += cos(angle + progress * 14.0) * radius * 0.16;
        p.z += sin(angle + progress * 14.0) * radius * 0.1;
      }
    } else {
      vec3 anchor = stageCode > 1.5 ? targetImpact : (recipeCode < 0.5 ? casterGround : casterCast);
      float expansion = stageCode > 1.5 ? 0.18 + progress * 0.85 : 0.22 + progress * 0.35;
      p = anchor;
      p.x += cos(angle) * radius * expansion;
      p.z += sin(angle) * radius * expansion * 0.65;
      p.y += stageCode > 1.5 ? sin(angle * 2.0) * expansion * 0.55 : 0.04;
    }
    vColor = recipeCode < 0.5
      ? vec3(1.0, 0.51, 0.18)
      : recipeCode < 1.5 ? vec3(0.22, 0.92, 1.0) : vec3(0.48, 1.0, 0.28);
    vAlpha = particleActive * max(0.0, 1.0 - progress);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float dpiScale = clamp(uResolution.y / 820.0, 0.75, 1.5);
    gl_PointSize = size * uIntensity * dpiScale * (7.0 / max(1.0, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
  }
`
const fragmentShader = `
  #define MOBIE_VFX_SHADER 1
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uTime;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float radius = length(p);
    float glow = 1.0 - smoothstep(0.04, 0.5, radius);
    float core = 1.0 - smoothstep(0.0, 0.18, radius);
    float pulse = 0.92 + 0.08 * sin(uTime * 16.0);
    gl_FragColor = vec4(vColor * (glow + core * 0.75) * pulse, glow * vAlpha);
  }
`

/** DEV verification: append `?devVfxShaderFailure=1` to exercise real compile fallback. */
function devFragmentShader(): string {
  if (!import.meta.env.DEV || typeof window === 'undefined') return fragmentShader
  if (new URLSearchParams(window.location.search).get('devVfxShaderFailure') !== '1') return fragmentShader
  return fragmentShader.replace('void main()', 'intentional_vfx_compile_failure\nvoid main()')
}

export const BattleVfx = forwardRef<BattleVfxHandle, BattleVfxProps>(function BattleVfx({
  rigs,
  tier,
  reducedMotion,
  intensity,
  timeScaleRef,
  forceFallback = false,
  controlsRef,
  onDiagnostics,
}, ref) {
  const { gl, size } = useThree()
  const runtime = useMemo(() => new VfxRuntime(), [])
  const pointsRef = useRef<Points>(null)
  const shaderMode = useRef<'procedural' | 'fallback'>('fallback')
  const shaderFailed = useRef(false)
  const prewarmReady = useRef(false)
  const uploadedRevision = useRef(-1)
  const effectiveOptions = () => {
    const controls = controlsRef?.current
    return {
      tier: controls?.tier ?? tier,
      intensity: Math.min(intensity, controls?.intensity ?? intensity),
      seed: controls?.seed ?? 0,
    }
  }

  const resources = useMemo(() => {
    const positions = new Float32Array(VFX_PARTICLE_CAPACITY * 3)
    positions.fill(HIDDEN)
    const colors = new Float32Array(VFX_PARTICLE_CAPACITY * 3)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    geometry.setAttribute('particleActive', new BufferAttribute(runtime.active, 1))
    geometry.setAttribute('recipeCode', new BufferAttribute(runtime.recipe, 1))
    geometry.setAttribute('stageCode', new BufferAttribute(runtime.stage, 1))
    geometry.setAttribute('casterCode', new BufferAttribute(runtime.caster, 1))
    geometry.setAttribute('targetCode', new BufferAttribute(runtime.target, 1))
    geometry.setAttribute('spawnTime', new BufferAttribute(runtime.spawnTime, 1))
    geometry.setAttribute('lifetime', new BufferAttribute(runtime.lifetime, 1))
    geometry.setAttribute('angle', new BufferAttribute(runtime.angle, 1))
    geometry.setAttribute('radius', new BufferAttribute(runtime.radius, 1))
    geometry.setAttribute('variance', new BufferAttribute(runtime.variance, 1))
    geometry.setAttribute('size', new BufferAttribute(runtime.size, 1))
    geometry.setDrawRange(0, VFX_PARTICLE_CAPACITY)
    const uniforms = {
      uTime: { value: 0 },
      uDelta: { value: 0 },
      uIntensity: { value: 1 },
      uResolution: { value: new Vector2(1, 1) },
      uReducedMotion: { value: 0 },
      uPlayerCast: { value: new Vector3() },
      uPlayerGround: { value: new Vector3() },
      uPlayerImpact: { value: new Vector3() },
      uFoeCast: { value: new Vector3() },
      uFoeGround: { value: new Vector3() },
      uFoeImpact: { value: new Vector3() },
    }
    const procedural = new ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader: devFragmentShader(),
      transparent: true,
      depthWrite: false,
      // Artwork is a billboard: keep its surface from hiding the impact glow.
      depthTest: false,
      vertexColors: true,
    })
    const fallback = new PointsMaterial({
      size: 0.11,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      depthTest: false,
      vertexColors: true,
    })
    const prewarmScene = new Scene()
    const prewarmCamera = new PerspectiveCamera(40, 1, 0.1, 10)
    prewarmCamera.position.z = 4
    const prewarmPoints = new Points<BufferGeometry, PointsMaterial | ShaderMaterial>(geometry, fallback)
    prewarmPoints.frustumCulled = false
    prewarmScene.add(prewarmPoints)
    const prewarmTarget = new WebGLRenderTarget(4, 4, { depthBuffer: false, stencilBuffer: false })
    return {
      positions,
      colors,
      geometry,
      uniforms,
      procedural,
      fallback,
      prewarmScene,
      prewarmCamera,
      prewarmPoints,
      prewarmTarget,
    }
  }, [])

  const scratch = useMemo(() => ({
    caster: new Vector3(),
    target: new Vector3(),
    point: new Vector3(),
  }), [])

  const publishDiagnostics = () => onDiagnostics?.({
    ...runtime.diagnostics(),
    shaderMode: shaderMode.current,
  })

  const syncSpawnData = (hideAll = false) => {
    for (let index = 0; index < VFX_PARTICLE_CAPACITY; index += 1) {
      const offset = index * 3
      const color = COLORS[runtime.recipe[index]] ?? COLORS[0]
      resources.colors[offset] = color.r
      resources.colors[offset + 1] = color.g
      resources.colors[offset + 2] = color.b
      if (hideAll) {
        resources.positions[offset] = HIDDEN
        resources.positions[offset + 1] = HIDDEN
        resources.positions[offset + 2] = HIDDEN
      }
    }
    for (const name of SPAWN_ATTRIBUTES) resources.geometry.attributes[name].needsUpdate = true
    if (hideAll) resources.geometry.attributes.position.needsUpdate = true
  }

  useImperativeHandle(ref, () => ({
    cue: (cue) => {
      runtime.cue(cue, effectiveOptions())
      syncSpawnData()
      uploadedRevision.current = runtime.spawnRevision
      publishDiagnostics()
    },
    reset: () => {
      runtime.reset()
      resources.uniforms.uTime.value = 0
      syncSpawnData(true)
      uploadedRevision.current = runtime.spawnRevision
      publishDiagnostics()
    },
    diagnostics: () => ({
      ...runtime.diagnostics(),
      shaderMode: shaderMode.current,
    }),
  }), [controlsRef, intensity, onDiagnostics, resources, runtime, tier])

  useLayoutEffect(() => {
    const points = pointsRef.current
    if (!points) return
    let mounted = true
    points.material = resources.fallback
    shaderMode.current = 'fallback'
    prewarmReady.current = false
    const previousShaderError = gl.debug.onShaderError
    const previousTarget = gl.getRenderTarget()
    const previousAutoClear = gl.autoClear
    let failed = false
    const scopedShaderError: NonNullable<typeof gl.debug.onShaderError> = (
      context,
      program,
      vertex,
      fragment,
    ) => {
      const isVfx = context.getShaderSource(vertex)?.includes('MOBIE_VFX_SHADER')
        || context.getShaderSource(fragment)?.includes('MOBIE_VFX_SHADER')
      if (isVfx) failed = true
      else previousShaderError?.(context, program, vertex, fragment)
    }
    gl.debug.onShaderError = scopedShaderError
    let compilation: Promise<unknown>
    try {
      gl.autoClear = true
      gl.setRenderTarget(resources.prewarmTarget)
      resources.prewarmPoints.material = resources.fallback
      gl.clear()
      gl.render(resources.prewarmScene, resources.prewarmCamera)
      resources.prewarmPoints.material = resources.procedural
      gl.clear()
      gl.render(resources.prewarmScene, resources.prewarmCamera)
      compilation = gl.compileAsync(resources.prewarmScene, resources.prewarmCamera)
    } catch {
      failed = true
      compilation = Promise.resolve()
    }
    gl.setRenderTarget(previousTarget)
    gl.autoClear = previousAutoClear

    const finish = (rejected: boolean) => {
      if (gl.debug.onShaderError === scopedShaderError) gl.debug.onShaderError = previousShaderError
      if (!mounted) return
      shaderFailed.current = failed || rejected
      if (shaderFailed.current) console.warn('[battle-vfx:shader-fallback] Using generic tracer after shader prewarm failed.')
      prewarmReady.current = !shaderFailed.current
      const controlsForceFallback = controlsRef?.current.forceFallback === true
      const useFallback = forceFallback || controlsForceFallback || shaderFailed.current
      points.material = useFallback ? resources.fallback : resources.procedural
      shaderMode.current = useFallback ? 'fallback' : 'procedural'
      publishDiagnostics()
    }
    void compilation.then(() => finish(false), () => finish(true))
    return () => {
      mounted = false
      if (gl.debug.onShaderError === scopedShaderError) gl.debug.onShaderError = previousShaderError
    }
  }, [controlsRef, forceFallback, gl, resources])

  useLayoutEffect(() => () => {
    runtime.dispose()
    resources.geometry.dispose()
    resources.procedural.dispose()
    resources.fallback.dispose()
    resources.prewarmTarget.dispose()
    if (import.meta.env.DEV) console.info('[battle-vfx:disposed]', JSON.stringify(runtime.diagnostics()))
    publishDiagnostics()
  }, [resources, runtime])

  useFrame((_state, rawDelta) => {
    const controls = controlsRef?.current
    const wantsFallback = forceFallback
      || controls?.forceFallback === true
      || shaderFailed.current
      || !prewarmReady.current
    const nextMaterial = wantsFallback ? resources.fallback : resources.procedural
    if (pointsRef.current && pointsRef.current.material !== nextMaterial) {
      pointsRef.current.material = nextMaterial
      shaderMode.current = wantsFallback ? 'fallback' : 'procedural'
      publishDiagnostics()
    }
    const effectiveReducedMotion = reducedMotion || controls?.reducedMotion === true
    const visualIntensity = Math.max(0, Math.min(1, Math.min(intensity, controls?.intensity ?? intensity)))
    const delta = runtime.step(rawDelta, controls?.frozen ? 0 : timeScaleRef.current)
    if (uploadedRevision.current !== runtime.spawnRevision) {
      syncSpawnData()
      uploadedRevision.current = runtime.spawnRevision
    }
    resources.uniforms.uDelta.value = delta
    resources.uniforms.uTime.value = runtime.elapsed
    resources.uniforms.uIntensity.value = visualIntensity
    resources.uniforms.uReducedMotion.value = effectiveReducedMotion ? 1 : 0
    resources.uniforms.uResolution.value.set(size.width, size.height)
    updateAnchor(rigs, 'player', 'cast', resources.uniforms.uPlayerCast.value)
    updateAnchor(rigs, 'player', 'ground', resources.uniforms.uPlayerGround.value)
    updateAnchor(rigs, 'player', 'impact', resources.uniforms.uPlayerImpact.value)
    updateAnchor(rigs, 'foe', 'cast', resources.uniforms.uFoeCast.value)
    updateAnchor(rigs, 'foe', 'ground', resources.uniforms.uFoeGround.value)
    updateAnchor(rigs, 'foe', 'impact', resources.uniforms.uFoeImpact.value)

    if (shaderMode.current !== 'fallback') return
    resources.fallback.opacity = 0.82 * visualIntensity

    for (let index = 0; index < VFX_PARTICLE_CAPACITY; index += 1) {
      const offset = index * 3
      if (runtime.active[index] === 0) {
        resources.positions[offset] = HIDDEN
        resources.positions[offset + 1] = HIDDEN
        resources.positions[offset + 2] = HIDDEN
        continue
      }
      placeParticle(runtime, index, rigs, effectiveReducedMotion, scratch.caster, scratch.target, scratch.point)
      resources.positions[offset] = scratch.point.x
      resources.positions[offset + 1] = scratch.point.y
      resources.positions[offset + 2] = scratch.point.z
    }
    resources.geometry.attributes.position.needsUpdate = true
  })

  return <points ref={pointsRef} geometry={resources.geometry} material={resources.fallback} frustumCulled={false} />
})

function updateAnchor(
  rigs: BattleVfxProps['rigs'],
  side: Side,
  anchor: 'cast' | 'ground' | 'impact',
  target: Vector3,
): void {
  const object = rigs.current[side]?.getAnchor(anchor)
  if (object) object.getWorldPosition(target)
  else target.set(HIDDEN, HIDDEN, HIDDEN)
}

function placeParticle(
  runtime: VfxRuntime,
  index: number,
  rigs: BattleVfxProps['rigs'],
  reducedMotion: boolean,
  caster: Vector3,
  target: Vector3,
  point: Vector3,
): void {
  const casterSide: Side = runtime.caster[index] === 0 ? 'player' : 'foe'
  const targetSide: Side = runtime.target[index] === 0 ? 'player' : 'foe'
  const recipe = runtime.recipe[index]
  const stage = runtime.stage[index]
  const progress = Math.min(1, runtime.age[index] / runtime.lifetime[index])
  const angle = runtime.angle[index]
  const radius = runtime.radius[index]
  const casterAnchor = rigs.current[casterSide]?.getAnchor(recipe === 2 ? 'impact' : recipe === 0 && stage === 0 ? 'ground' : 'cast')
  const targetAnchor = rigs.current[targetSide]?.getAnchor('impact')
  casterAnchor?.getWorldPosition(caster)
  targetAnchor?.getWorldPosition(target)
  if (!casterAnchor || !targetAnchor) {
    point.set(HIDDEN, HIDDEN, HIDDEN)
    return
  }

  if (recipe === 2) {
    const lift = stage === 0 ? 0.25 : 0.15 + progress * 1.75
    point.copy(caster)
    point.x += Math.cos(angle + progress * 2.2) * radius * 0.72
    point.z += Math.sin(angle + progress * 2.2) * radius * 0.42
    point.y += lift + Math.sin(angle * 2) * 0.12
    return
  }

  if (stage === 1) {
    if (recipe === 0) {
      point.copy(target).sub(caster).normalize().multiplyScalar(0.08 + progress * 0.48).add(caster)
      point.x += Math.cos(angle + progress * 8) * radius * 0.09
      point.y += Math.sin(progress * Math.PI) * 0.16
      point.z += Math.sin(angle + progress * 8) * radius * 0.07
    } else if (reducedMotion) {
      point.copy(runtime.variance[index] < 0.55 ? caster : target)
      point.x += Math.cos(angle + progress * 8) * radius * 0.13
      point.y += Math.sin(angle * 2 + progress * 5) * 0.12
      point.z += Math.sin(angle + progress * 8) * radius * 0.1
    } else {
      const travel = Math.min(1, runtime.variance[index] + runtime.age[index] / 0.28)
      point.copy(caster).lerp(target, travel)
      point.y += Math.sin(travel * Math.PI) * 0.42
      point.x += Math.cos(angle + progress * 14) * radius * 0.16
      point.z += Math.sin(angle + progress * 14) * radius * 0.1
    }
    return
  }

  const anchor = stage === 2 ? target : caster
  const expansion = stage === 2 ? 0.18 + progress * 0.85 : 0.22 + progress * 0.35
  point.copy(anchor)
  point.x += Math.cos(angle) * radius * expansion
  point.z += Math.sin(angle) * radius * expansion * 0.65
  point.y += stage === 2 ? Math.sin(angle * 2) * expansion * 0.55 : 0.04
}
