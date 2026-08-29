import { Component, Suspense, type ReactNode } from 'react'
import { useLoader } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import { DoubleSide, TextureLoader } from 'three'

interface MobieVisualProps {
  artworkUrl: string
  shiny?: boolean
}

/** Artwork-only combatant; Battle/Capture never read custom model storage or GLTF assets. */
export function MobieVisual({ artworkUrl, shiny }: MobieVisualProps) {
  const fallback = <ProceduralSilhouette shiny={shiny} />
  // 此元件自我保護，呼叫端（Combatant3D / CaptureStage）無須再外包邊界。
  return (
    <VisualBoundary key={artworkUrl} fallback={fallback}>
      <Suspense fallback={fallback}>
        <BillboardSprite url={artworkUrl} shiny={shiny} />
      </Suspense>
    </VisualBoundary>
  )
}

/** Stable no-asset fallback used while artwork loads or when decoding fails. */
function ProceduralSilhouette({ shiny }: { shiny?: boolean }) {
  const color = shiny ? '#f5d76e' : '#64748b'
  return (
    <group position={[0, 1.05, 0]}>
      <mesh position={[0, -0.2, 0]} scale={[0.78, 1.05, 0.4]}>
        <sphereGeometry args={[0.82, 18, 14]} />
        <meshBasicMaterial color={color} transparent opacity={0.88} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.75, 0]}>
        <sphereGeometry args={[0.55, 18, 14]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** billboard fallback：artwork 貼圖平面，只繞 Y 軸面向相機（保持直立站在地台上）。 */
function BillboardSprite({ url, shiny }: { url: string; shiny?: boolean }) {
  const tex = useLoader(TextureLoader, url)
  const img = tex.image as { width: number; height: number } | undefined
  const aspect = img && img.height ? img.width / img.height : 1
  const h = 2.3
  const w = h * aspect
  return (
    <Billboard lockX lockZ position={[0, h / 2, 0]}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial
          map={tex}
          transparent
          alphaTest={0.35}
          color={shiny ? '#fff0b8' : '#ffffff'}
          side={DoubleSide}
          toneMapped={false}
          fog={false}
        />
      </mesh>
    </Billboard>
  )
}

/** Artwork 載入失敗時退回 fallback，不讓整個 canvas 崩掉。 */
class VisualBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
