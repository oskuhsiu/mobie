import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { Group, Vector3, PerspectiveCamera } from 'three'
import { StageLights, Pedestal, BlobShadow } from './sceneParts'
import { MobieVisual } from './MobieVisual'

// 依寬高比自動拉遠相機，確保單體Mobie在手機直向（aspect 很小）也完整入鏡、兩側不被切。
const CAP_LOOK_AT = new Vector3(0, 1.0, 0)
const CAP_VIEW_DIR = new Vector3(0, 1.7, 4.4).sub(CAP_LOOK_AT).normalize()
const CAP_WANT_HALF_W = 1.4
const CAP_WANT_HALF_H = 1.5
const CAP_MIN_DIST = 4.46

function CaptureCameraRig() {
  const { camera, size } = useThree()
  useEffect(() => {
    const cam = camera as PerspectiveCamera
    const aspect = size.width / Math.max(1, size.height)
    const tanHalf = Math.tan((cam.fov * Math.PI) / 180 / 2)
    const dist = Math.max(CAP_MIN_DIST, CAP_WANT_HALF_H / tanHalf, CAP_WANT_HALF_W / (tanHalf * aspect))
    cam.position.copy(CAP_LOOK_AT).addScaledVector(CAP_VIEW_DIR, dist)
    cam.lookAt(CAP_LOOK_AT)
    cam.updateProjectionMatrix()
  }, [camera, size.width, size.height])
  return null
}

interface CaptureStageProps {
  speciesId: number
  artworkUrl: string
  shiny?: boolean
  /** 收服成功 → 縮小淡沉「進球」 */
  vanish: boolean
}

/** 收服畫面用的單體 3D 舞台：野生Mobie（GLB/billboard）站在地台上，收服時縮沉消失。 */
export default function CaptureStage({ speciesId, artworkUrl, shiny, vanish }: CaptureStageProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 1.7, 4.4], fov: 42 }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <CaptureCameraRig />
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
      <MobieVisual speciesId={speciesId} artworkUrl={artworkUrl} shiny={shiny} />
    </group>
  )
}
