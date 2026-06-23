import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { Group } from 'three'
import { StageLights, Pedestal, BlobShadow } from './sceneParts'
import { PokemonVisual } from './PokemonVisual'

interface CaptureStageProps {
  speciesId: number
  artworkUrl: string
  shiny?: boolean
  /** 收服成功 → 縮小淡沉「進球」 */
  vanish: boolean
}

/** 收服畫面用的單體 3D 舞台：野生寶可夢（GLB/billboard）站在地台上，收服時縮沉消失。 */
export default function CaptureStage({ speciesId, artworkUrl, shiny, vanish }: CaptureStageProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 1.7, 4.4], fov: 42 }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <StageLights />
      <Pedestal position={[0, 0, 0]} color="#9b7aff" />
      <BlobShadow />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.4} scale={6} blur={2.4} far={3} resolution={256} color="#05060f" />
      <CaptureMon speciesId={speciesId} artworkUrl={artworkUrl} shiny={shiny} vanish={vanish} />
    </Canvas>
  )
}

function CaptureMon({ speciesId, artworkUrl, shiny, vanish }: CaptureStageProps) {
  const group = useRef<Group>(null)
  const v = useRef(0) // vanish 進度 0..1（平滑趨近）

  useFrame((state, rawDelta) => {
    const g = group.current
    if (!g) return
    const delta = Math.min(rawDelta, 0.05)
    v.current += ((vanish ? 1 : 0) - v.current) * Math.min(1, delta * 6)
    const p = v.current
    const bob = Math.sin(state.clock.elapsedTime * 1.6) * 0.05 * (1 - p)
    g.position.set(0, bob - p * 0.5, 0)
    g.scale.setScalar(Math.max(0.001, 1 - p))
  })

  return (
    <group ref={group}>
      <PokemonVisual speciesId={speciesId} artworkUrl={artworkUrl} shiny={shiny} />
    </group>
  )
}
