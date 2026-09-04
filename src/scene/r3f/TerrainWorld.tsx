import { useRef } from 'react'
import type { Vector3Tuple } from 'three'
import type { MeshBasicMaterial, MeshStandardMaterial } from 'three'
import type {
  ResolvedTerrainWorld,
  TerrainArchetype,
} from './terrainVisual'
import { useTerrainColorCrossfade } from './sceneParts'

type PrimitiveKind = 'boulder' | 'column' | 'crystal' | 'orb' | 'pool' | 'ring' | 'spire'

interface PrimitiveSpec {
  kind: PrimitiveKind
  position: Vector3Tuple
  scale: Vector3Tuple
  rotation?: [number, number, number]
  horizon?: boolean
}

const PI_2 = Math.PI / 2

/** Ordered in balanced-tier pairs first, then high-tier edge detail. */
const WORLD_PRIMITIVES: Record<TerrainArchetype, readonly PrimitiveSpec[]> = {
  arena: [],
  meadow: [
    { kind: 'spire', position: [-3.7, 0.15, -3.9], scale: [0.28, 1.15, 0.28] },
    { kind: 'spire', position: [3.8, 0.15, -4.5], scale: [0.34, 1.4, 0.34] },
    { kind: 'orb', position: [-4.6, 0.15, -5.2], scale: [1.35, 0.45, 0.8], horizon: true },
    { kind: 'orb', position: [4.8, 0.05, -5.4], scale: [1.5, 0.55, 0.9], horizon: true },
    { kind: 'spire', position: [-5.1, 0.05, -4.5], scale: [0.2, 0.85, 0.2] },
    { kind: 'spire', position: [5.2, 0.05, -4.2], scale: [0.22, 0.95, 0.22] },
    { kind: 'orb', position: [-2.9, -0.05, -6], scale: [1.25, 0.35, 0.75], horizon: true },
    { kind: 'orb', position: [2.6, -0.05, -6.2], scale: [1.3, 0.38, 0.7], horizon: true },
  ],
  wetlands: [
    { kind: 'pool', position: [-3.7, -0.18, -3.5], scale: [1.45, 1.45, 1] },
    { kind: 'pool', position: [3.9, -0.18, -4.2], scale: [1.7, 1.7, 1] },
    { kind: 'column', position: [-4.5, 0.25, -4.5], scale: [0.12, 1.05, 0.12] },
    { kind: 'column', position: [4.8, 0.25, -4.9], scale: [0.14, 1.25, 0.14] },
    { kind: 'column', position: [-5, 0.1, -5.3], scale: [0.1, 0.82, 0.1] },
    { kind: 'column', position: [5.3, 0.1, -5.6], scale: [0.1, 0.9, 0.1] },
    { kind: 'boulder', position: [-3.1, -0.02, -5.8], scale: [1.4, 0.35, 0.8], horizon: true },
    { kind: 'boulder', position: [2.8, -0.02, -6.1], scale: [1.5, 0.4, 0.85], horizon: true },
  ],
  volcanic: [
    { kind: 'spire', position: [-3.9, 0.45, -4.4], scale: [0.85, 2.3, 0.85] },
    { kind: 'spire', position: [4.2, 0.35, -4.8], scale: [1, 2.65, 1] },
    { kind: 'boulder', position: [-5, 0.1, -5.4], scale: [1.55, 0.9, 1.1], horizon: true },
    { kind: 'boulder', position: [5.1, 0.05, -5.8], scale: [1.65, 1, 1.2], horizon: true },
    { kind: 'spire', position: [-2.8, 0.05, -6], scale: [0.55, 1.55, 0.55] },
    { kind: 'spire', position: [2.8, 0.05, -6.2], scale: [0.6, 1.7, 0.6] },
    { kind: 'boulder', position: [-3.2, -0.08, -3.1], scale: [0.65, 0.35, 0.5] },
    { kind: 'boulder', position: [3.4, -0.08, -3.3], scale: [0.72, 0.4, 0.55] },
  ],
  cavern: [
    { kind: 'spire', position: [-4, 0.35, -4.5], scale: [0.65, 2.25, 0.65] },
    { kind: 'spire', position: [4.1, 0.3, -4.9], scale: [0.72, 2.5, 0.72] },
    { kind: 'crystal', position: [-4.8, 0.45, -5.4], scale: [0.6, 1.55, 0.6] },
    { kind: 'crystal', position: [4.9, 0.4, -5.7], scale: [0.7, 1.8, 0.7] },
    { kind: 'boulder', position: [-2.9, -0.03, -6], scale: [1.45, 0.7, 1], horizon: true },
    { kind: 'boulder', position: [2.8, -0.03, -6.1], scale: [1.55, 0.75, 1], horizon: true },
    { kind: 'crystal', position: [-3.15, 0, -3.3], scale: [0.28, 0.72, 0.28] },
    { kind: 'crystal', position: [3.25, 0, -3.45], scale: [0.3, 0.8, 0.3] },
  ],
  storm: [
    { kind: 'column', position: [-4.1, 0.8, -4.8], scale: [0.26, 2.8, 0.26] },
    { kind: 'column', position: [4.2, 0.75, -5], scale: [0.3, 3.05, 0.3] },
    { kind: 'ring', position: [-4.1, 2.15, -4.8], scale: [0.8, 0.8, 0.8] },
    { kind: 'ring', position: [4.2, 2.2, -5], scale: [0.9, 0.9, 0.9] },
    { kind: 'crystal', position: [-5, 0.25, -5.8], scale: [0.55, 1.3, 0.55], horizon: true },
    { kind: 'crystal', position: [5.1, 0.2, -6], scale: [0.6, 1.45, 0.6], horizon: true },
    { kind: 'ring', position: [-2.9, 0.05, -6.2], scale: [1.1, 1.1, 1.1], rotation: [PI_2, 0, 0] },
    { kind: 'ring', position: [2.8, 0.05, -6.25], scale: [1.2, 1.2, 1.2], rotation: [PI_2, 0, 0] },
  ],
  spectral: [
    { kind: 'column', position: [-4.1, 0.65, -4.8], scale: [0.55, 2.25, 0.35], rotation: [0, 0, -0.12] },
    { kind: 'column', position: [4.3, 0.6, -5.1], scale: [0.6, 2.45, 0.38], rotation: [0, 0, 0.14] },
    { kind: 'ring', position: [-4, 1.9, -4.7], scale: [1.05, 1.05, 1.05] },
    { kind: 'ring', position: [4.2, 1.95, -5], scale: [1.15, 1.15, 1.15] },
    { kind: 'orb', position: [-5.1, 0.8, -5.8], scale: [0.32, 0.32, 0.32] },
    { kind: 'orb', position: [5.2, 0.9, -5.9], scale: [0.36, 0.36, 0.36] },
    { kind: 'column', position: [-2.9, 0.1, -6.2], scale: [0.38, 1.4, 0.28], rotation: [0, 0, -0.08], horizon: true },
    { kind: 'column', position: [2.8, 0.08, -6.3], scale: [0.4, 1.5, 0.3], rotation: [0, 0, 0.1], horizon: true },
  ],
  sanctuary: [
    { kind: 'column', position: [-4.2, 0.75, -5], scale: [0.42, 2.8, 0.42] },
    { kind: 'column', position: [4.3, 0.72, -5.1], scale: [0.46, 3, 0.46] },
    { kind: 'ring', position: [0, 2.75, -6.5], scale: [2.25, 2.25, 2.25] },
    { kind: 'crystal', position: [-5.1, 0.35, -5.8], scale: [0.65, 1.45, 0.65], horizon: true },
    { kind: 'crystal', position: [5.2, 0.32, -6], scale: [0.7, 1.55, 0.7], horizon: true },
    { kind: 'column', position: [-2.9, 0.05, -6.2], scale: [0.3, 1.35, 0.3], horizon: true },
    { kind: 'column', position: [2.9, 0.05, -6.25], scale: [0.32, 1.45, 0.32], horizon: true },
    { kind: 'ring', position: [0, -0.12, -2.6], scale: [2.8, 2.8, 2.8], rotation: [PI_2, 0, 0] },
  ],
}

function WorldPrimitive({ spec, color, horizonColor, opacity }: {
  spec: PrimitiveSpec
  color: string
  horizonColor: string
  opacity: number
}) {
  const materialColor = spec.horizon ? horizonColor : color
  const rotation = spec.rotation ?? (spec.kind === 'pool' ? [-PI_2, 0, 0] as const : undefined)
  return (
    <mesh position={spec.position} scale={spec.scale} rotation={rotation} receiveShadow>
      {spec.kind === 'boulder' && <dodecahedronGeometry args={[1, 0]} />}
      {spec.kind === 'column' && <cylinderGeometry args={[0.6, 0.75, 2, 8]} />}
      {spec.kind === 'crystal' && <octahedronGeometry args={[1, 0]} />}
      {spec.kind === 'orb' && <sphereGeometry args={[1, 12, 8]} />}
      {spec.kind === 'pool' && <circleGeometry args={[1, 32]} />}
      {spec.kind === 'ring' && <torusGeometry args={[1, 0.08, 8, 32]} />}
      {spec.kind === 'spire' && <coneGeometry args={[0.8, 2, 7]} />}
      {spec.kind === 'pool' || spec.kind === 'ring' ? (
        <WorldBasicMaterial color={materialColor} opacity={opacity * 0.72} />
      ) : (
        <WorldStandardMaterial
          color={materialColor}
          metalness={spec.kind === 'crystal' ? 0.28 : 0.04}
        />
      )}
    </mesh>
  )
}

function WorldBasicMaterial({ color, opacity }: { color: string; opacity: number }) {
  const material = useRef<MeshBasicMaterial>(null)
  useTerrainColorCrossfade(material, color)
  return <meshBasicMaterial ref={material} color="#526aa8" transparent opacity={opacity} />
}

function WorldStandardMaterial({ color, metalness }: {
  color: string
  metalness: number
}) {
  const material = useRef<MeshStandardMaterial>(null)
  useTerrainColorCrossfade(material, color)
  return (
    <meshStandardMaterial
      ref={material}
      color="#526aa8"
      roughness={0.82}
      metalness={metalness}
    />
  )
}

export function TerrainWorld({ world, highDetail, intensity }: {
  world: ResolvedTerrainWorld
  highDetail: boolean
  intensity: number
}) {
  if (intensity <= 0) return null
  const opacity = 0.42 + Math.min(1, intensity) * 0.4
  const specs = WORLD_PRIMITIVES[world.primary.archetype]
  const detailLimit = intensity < 0.75 ? 4 : highDetail ? specs.length : 6
  const visible = specs.slice(0, detailLimit)

  return (
    <group name={`terrain-world:${world.primaryId}`}>
      {visible.map((spec, index) => (
        <WorldPrimitive
          key={`${spec.kind}:${index}`}
          spec={spec}
          color={world.primary.featureTint}
          horizonColor={world.primary.horizonTint}
          opacity={opacity}
        />
      ))}
      {world.secondaryAccent && (
        <mesh position={[0, -0.19, -0.8]} rotation={[-PI_2, 0, 0]}>
          <torusGeometry args={[3.35, 0.035, 8, highDetail ? 72 : 40]} />
          <WorldBasicMaterial
            color={world.secondaryAccent.color}
            opacity={0.22 * Math.min(1, intensity)}
          />
        </mesh>
      )}
    </group>
  )
}
