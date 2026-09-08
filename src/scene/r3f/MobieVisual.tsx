import { useEffect, useMemo, useState } from 'react'
import { Billboard } from '@react-three/drei'
import { CanvasTexture, DoubleSide, type Texture } from 'three'
import {
  getArtworkTexture,
  loadArtworkTexture,
  releaseArtworkTexture,
  retainArtworkTexture,
} from './artworkResourceCache'

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
  return <BillboardSprite url={artworkUrl} name={name} shiny={shiny} onVisible={onModeChange} />
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
function BillboardSprite({ url, name, shiny, onVisible }: {
  url: string
  name: string
  shiny?: boolean
  onVisible?: MobieVisualProps['onModeChange']
}) {
  const [loaded, setLoaded] = useState<{ url: string; texture: Texture | null; failed: boolean }>({
    url: '',
    texture: null,
    failed: false,
  })
  useEffect(() => {
    let disposed = false
    setLoaded({ url, texture: null, failed: false })
    const cached = getArtworkTexture(url)
    if (cached) {
      setLoaded({ url, texture: cached, failed: false })
    } else {
      void loadArtworkTexture(url).then((texture) => {
        if (!disposed) setLoaded({ url, texture, failed: false })
      }).catch(() => {
        if (!disposed) setLoaded({ url, texture: null, failed: true })
      })
    }
    return () => { disposed = true }
  }, [url])

  const tex = loaded.url === url && !loaded.failed ? loaded.texture : null
  useEffect(() => {
    if (!tex) return
    retainArtworkTexture(url, tex)
    onVisible?.('artwork')
    return () => releaseArtworkTexture(url, tex)
  }, [onVisible, tex, url])

  if (!tex) return <ProceduralSilhouette name={name} shiny={shiny} onVisible={onVisible} />

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
