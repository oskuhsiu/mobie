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
import type { BattleVfxDiagnostics as BattleVfxDiagnosticsContract } from '@/scene/battle/contracts'
import type { CombatantRigHandle } from './Combatant3D'
import {
  VFX_PARTICLE_CAPACITY,
  VfxRuntime,
  type VfxCue,
  type VfxLabControls,
} from './vfxRuntime'

export type { VfxCue } from './vfxRuntime'

export interface BattleVfxHandle {
  cue(cue: VfxCue): void
  reset(): void
  diagnostics(): BattleVfxDiagnostics
}

export type BattleVfxDiagnostics = BattleVfxDiagnosticsContract

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
const IMMUNE_COLOR = new Color('#cccccc')
const ELEMENT_COLORS = ['#ddd5c7', '#ff783e', '#5bbcff', '#ffe356', '#83d75d', '#a6ecff', '#f59f75', '#c68cef', '#d5ae6a', '#b9dcff', '#f690cb', '#b9d767', '#c0ac85', '#ad9be2', '#987eff', '#a798aa', '#a9c9d1', '#ffc0ec'].map(value => new Color(value))
const SPAWN_ATTRIBUTES = [
  'presentation',
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
  attribute vec4 presentation;
  varying vec3 vMotif;
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
    if (presentation.x > 0.5) {
      float motion = uReducedMotion > 0.5 ? 0.2 : 1.0;
      vec3 targetGround = mix(uPlayerGround, uFoeGround, targetCode);
      if (stageCode < 0.5) {
        p = casterCast + vec3(cos(angle), sin(angle), 0.0) * radius * 0.18;
      } else if (presentation.w == 1.0 && stageCode > 1.5) {
        p = targetImpact + vec3(cos(angle), sin(angle), 0.0) * 0.38;
      } else if (presentation.x > 3.5 && presentation.x < 4.5 || presentation.z > 3.5) {
        p = targetGround + vec3(cos(angle), 0.08, sin(angle)) * (0.25 + progress * motion) * radius;
      } else if (presentation.x > 4.5 || presentation.z > 0.5) {
        p = targetImpact + vec3(cos(angle) * radius * 0.4, (progress - 0.5) * motion * (presentation.z > 2.5 ? -1.0 : 1.0), sin(angle) * radius * 0.2);
      } else if (stageCode > 1.5) {
        p = targetImpact + vec3(cos(angle), sin(angle), sin(angle * 2.0) * 0.3) * radius * (0.3 + progress * motion * 1.6);
      } else if (presentation.x < 1.5) {
        if (presentation.w == 2.0) {
          p = targetGround + vec3(cos(angle), 0.04, sin(angle)) * radius * (0.12 + progress * 0.5 * motion);
        } else {
          p = mix(casterCast, targetImpact, 0.08 + progress * 0.22 * motion);
          p.y += sin(angle) * radius * 0.12;
        }
      } else if (uReducedMotion > 0.5) {
        p = variance < 0.5 ? casterCast : targetImpact;
        p.y += sin(angle) * radius * 0.12;
        if (presentation.w == 2.0) p += vec3(cos(angle), 0.0, sin(angle)) * radius * progress * 0.1;
      } else if (presentation.x > 2.5) {
        p = mix(casterCast, targetImpact, radius * (presentation.w == 2.0 ? 1.22 : 1.0));
        p.y += sin(angle) * (presentation.w == 2.0 ? 0.04 + progress * 0.2 : 0.04);
      } else {
        float travel = clamp(variance + age / 0.28, 0.0, presentation.w == 2.0 ? 1.22 : 1.0);
        p = mix(casterCast, targetImpact, travel);
        p.y += sin(min(travel, 1.0) * 3.14159265) * 0.42;
      }
    }
    // Interleave element silhouettes with effect glyphs; keep effect motion on every particle.
    vMotif = presentation.x > 0.5 ? vec3(presentation.y + 1.0, presentation.z * step(0.5, radius), (presentation.w == 1.0 ? 1.0 : 0.0) * step(1.5, stageCode)) : vec3(0.0);
    vColor = recipeCode < 0.5
      ? vec3(1.0, 0.51, 0.18)
      : recipeCode < 1.5 ? vec3(0.22, 0.92, 1.0) : vec3(0.48, 1.0, 0.28);
    if (presentation.x > 0.5) vColor = color;
    if (vMotif.z > 0.5) vColor = vec3(0.8);
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
  varying vec3 vMotif;
  varying float vAlpha;
  uniform float uTime;
  uniform float uReducedMotion;
  float line(float d, float width) { return 1.0 - smoothstep(width, width + 0.035, d); }
  float motif(vec2 p, float kind) {
    float r = length(p);
    float a = atan(p.y, p.x);
    if (kind < 1.5) return line(abs(p.x) + abs(p.y), 0.27); // normal: diamond
    if (kind < 2.5) return line(abs(p.x) - p.y * 0.48, 0.18) * step(-0.3, p.y) * step(p.y, 0.35); // flame wedge
    if (kind < 3.5) return line(length(p - vec2(0.0, 0.08)) + max(0.0, -p.y) * 0.5, 0.24); // drop
    if (kind < 4.5) return line(abs(p.x + sign(p.y) * 0.09 - p.y * 0.35), 0.045) * step(abs(p.y), 0.36); // bolt
    if (kind < 5.5) return line(length(p * vec2(1.5, 0.8)), 0.28) * step(-0.03, p.x + p.y); // leaf
    if (kind < 6.5) return line(abs(sin(a * 3.0)) * r, 0.025) * step(r, 0.36); // snowflake
    if (kind < 7.5) return line(abs(p.x + p.y * 0.6), 0.06) * step(abs(p.y), 0.32); // slash
    if (kind < 8.5) return max(line(length(p - vec2(-0.13, -0.1)), 0.12), line(length(p - vec2(0.14, 0.14)), 0.1)); // bubbles
    if (kind < 9.5) return line(abs(p.y + 0.12 * sin(p.x * 20.0)), 0.04) * step(abs(p.x), 0.38); // fissure
    if (kind < 10.5) return line(abs(length(p + vec2(0.12, 0.0)) - 0.28), 0.035) * step(0.0, p.x); // wing
    if (kind < 11.5) return line(abs(r - 0.18 - a * 0.025), 0.025); // spiral
    if (kind < 12.5) return line(min(length(p - vec2(0.14, 0.0)), length(p + vec2(0.14, 0.0))), 0.14); // paired wings
    if (kind < 13.5) return line(max(abs(p.x) * 0.9 + abs(p.y) * 0.4, abs(p.y)), 0.25); // rock facet
    if (kind < 14.5) return line(r, 0.28) * smoothstep(0.18, 0.25, length(p - vec2(0.13, 0.08))); // crescent
    if (kind < 15.5) return line(abs(abs(p.x) - 0.12 + p.y * 0.25), 0.04) * step(abs(p.y), 0.32); // twin fangs
    if (kind < 16.5) return line(abs(p.x) + abs(p.y) * 0.55, 0.24) * step(0.12, r); // hollow shard
    if (kind < 17.5) return line(abs(max(abs(p.x), abs(p.y)) - 0.24), 0.035); // steel frame
    return line(r, 0.2 + 0.1 * cos(a * 5.0)); // fairy star
  }
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float radius = length(p);
    float glow = 1.0 - smoothstep(0.04, 0.5, radius);
    float core = 1.0 - smoothstep(0.0, 0.18, radius);
    if (vMotif.x > 0.5) {
      glow = motif(p, vMotif.x);
      if (vMotif.y > 0.5 && vMotif.y < 1.5) glow = max(line(abs(p.x), 0.06) * step(abs(p.y), 0.3), line(abs(p.y), 0.06) * step(abs(p.x), 0.3));
      else if (vMotif.y > 1.5 && vMotif.y < 3.5) {
        vec2 arrow = p * vec2(1.0, vMotif.y < 2.5 ? 1.0 : -1.0);
        glow = max(line(abs(arrow.x), 0.045) * step(abs(arrow.y), 0.3), line(abs(arrow.y + 0.2 - abs(arrow.x)), 0.045) * step(abs(arrow.x), 0.22));
      } else if (vMotif.y > 3.5) glow = line(abs(radius - 0.3), 0.03);
      if (vMotif.z > 0.5) glow = line(abs(radius - 0.32), 0.04);
      core = glow * 0.3;
    }
    float pulse = uReducedMotion > 0.5 ? 1.0 : 0.92 + 0.08 * sin(uTime * 16.0);
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
  const diagnosticFrame = useRef(0)
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
    geometry.setAttribute('presentation', new BufferAttribute(runtime.presentation, 4))
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
      const color = runtime.presentation[index * 4] > 0
        ? runtime.presentation[index * 4 + 3] === 1 && runtime.stage[index] === 2 ? IMMUNE_COLOR : ELEMENT_COLORS[runtime.presentation[index * 4 + 1]] ?? ELEMENT_COLORS[0]
        : COLORS[runtime.recipe[index]] ?? COLORS[0]
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
    diagnosticFrame.current += 1
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

    if (shaderMode.current !== 'fallback') {
      if (diagnosticFrame.current % 60 === 0) publishDiagnostics()
      return
    }
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
    if (diagnosticFrame.current % 60 === 0) publishDiagnostics()
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

  const offset = index * 4
  const delivery = runtime.presentation[offset]
  if (delivery > 0) {
    const effect = runtime.presentation[offset + 2]
    const motion = reducedMotion ? 0.2 : 1
    updateAnchor(rigs, casterSide, 'cast', caster)
    if (stage === 0) {
      point.copy(caster)
      point.x += Math.cos(angle) * radius * 0.18
      point.y += Math.sin(angle) * radius * 0.18
    } else if (runtime.presentation[offset + 3] === 1 && stage === 2) {
      point.copy(target)
      point.x += Math.cos(angle) * 0.38
      point.y += Math.sin(angle) * 0.38
    } else if (delivery === 4 || effect === 4) {
      updateAnchor(rigs, targetSide, 'ground', target)
      point.copy(target)
      point.x += Math.cos(angle) * (0.25 + progress * motion) * radius
      point.y += 0.08 * (0.25 + progress * motion) * radius
      point.z += Math.sin(angle) * (0.25 + progress * motion) * radius
    } else if (delivery === 5 || effect > 0) {
      point.copy(target)
      point.x += Math.cos(angle) * radius * 0.4
      point.y += (progress - 0.5) * motion * (effect === 3 ? -1 : 1)
      point.z += Math.sin(angle) * radius * 0.2
    } else if (stage === 2) {
      const expansion = radius * (0.3 + progress * motion * 1.6)
      point.copy(target)
      point.x += Math.cos(angle) * expansion
      point.y += Math.sin(angle) * expansion
      point.z += Math.sin(angle * 2) * 0.3 * expansion
    } else if (delivery === 1) {
      if (runtime.presentation[offset + 3] === 2) {
        updateAnchor(rigs, targetSide, 'ground', target)
        const spread = radius * (0.12 + progress * 0.5 * motion)
        point.copy(target)
        point.x += Math.cos(angle) * spread
        point.y += 0.04 * spread
        point.z += Math.sin(angle) * spread
      } else {
        point.copy(caster).lerp(target, 0.08 + progress * 0.22 * motion)
        point.y += Math.sin(angle) * radius * 0.12
      }
    } else if (reducedMotion) {
      point.copy(runtime.variance[index] < 0.5 ? caster : target)
      point.y += Math.sin(angle) * radius * 0.12
      if (runtime.presentation[offset + 3] === 2) {
        point.x += Math.cos(angle) * radius * progress * 0.1
        point.z += Math.sin(angle) * radius * progress * 0.1
      }
    } else if (delivery === 3) {
      point.copy(caster).lerp(target, radius * (runtime.presentation[offset + 3] === 2 ? 1.22 : 1))
      point.y += Math.sin(angle) * (runtime.presentation[offset + 3] === 2 ? 0.04 + progress * 0.2 : 0.04)
    } else {
      const travel = Math.min(runtime.presentation[offset + 3] === 2 ? 1.22 : 1, runtime.variance[index] + runtime.age[index] / 0.28)
      point.copy(caster).lerp(target, travel)
      point.y += Math.sin(Math.min(travel, 1) * Math.PI) * 0.42
    }
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
