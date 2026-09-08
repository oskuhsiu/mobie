import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import { useLoader } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import { CanvasTexture, DoubleSide, TextureLoader } from 'three'
import { releaseArtworkTexture, retainArtworkTexture } from './artworkResourceCache'

interface MobieVisualProps {
  artworkUrl: string
  name?: string
  shiny?: boolean
  onModeChange?: (mode: 'artwork' | 'silhouette') => void
}

/** Artwork-only combatant; Battle/Capture never read custom model storage or GLTF assets. */
export function MobieVisual({ artworkUrl, name = '?', shiny, onModeChange }: MobieVisualProps) {
  const fallback = <ProceduralSilhouette name={name} shiny={shiny} onVisible={onModeChange} />
  if (!artworkUrl.trim()) return fallback
  // 此元件自我保護，呼叫端（Combatant3D / CaptureStage）無須再外包邊界。
  return (
    <VisualBoundary key={artworkUrl} fallback={fallback}>
      <Suspense fallback={fallback}>
        <BillboardSprite url={artworkUrl} shiny={shiny} onVisible={onModeChange} />
      </Suspense>
    </VisualBoundary>
  )
}

/** Stable no-asset fallback used while artwork loads or when decoding fails. */
function initialOf(name: string) {
  return [...name.trim()][0]?.toUpperCase() ?? '?'
}

function ProceduralSilhouette({ name, shiny, onVisible }: {
  name: string
  shiny?: boolean
  onVisible?: MobieVisualProps['onModeChange']
}) {
  const color = shiny ? '#f5d76e' : '#64748b'
  const initialTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const context = canvas.getContext('2d')
    if (context) {
      context.fillStyle = '#ffffff'
      context.font = '700 82px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(initialOf(name), 64, 68)
    }
    return new CanvasTexture(canvas)
  }, [name])
  useEffect(() => {
    onVisible?.('silhouette')
  }, [onVisible])
  useEffect(() => () => initialTexture.dispose(), [initialTexture])
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
      <sprite position={[0, 0.1, 0.44]} scale={[0.72, 0.72, 1]}>
        <spriteMaterial map={initialTexture} transparent depthWrite={false} toneMapped={false} />
      </sprite>
    </group>
  )
}

/** billboard fallback：artwork 貼圖平面，只繞 Y 軸面向相機（保持直立站在地台上）。 */
function BillboardSprite({ url, shiny, onVisible }: {
  url: string
  shiny?: boolean
  onVisible?: MobieVisualProps['onModeChange']
}) {
  const tex = useLoader(TextureLoader, url)
  const img = tex.image as { width: number; height: number } | undefined
  const aspect = img && img.height ? img.width / img.height : 1
  const h = 2.3
  const w = h * aspect
  useEffect(() => {
    retainArtworkTexture(url, tex)
    onVisible?.('artwork')
    return () => releaseArtworkTexture(url, tex)
  }, [onVisible, tex, url])
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
