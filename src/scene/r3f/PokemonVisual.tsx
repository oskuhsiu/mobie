import { Component, Suspense, useMemo, type ReactNode } from 'react'
import { useLoader } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import { DoubleSide, TextureLoader } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { normalizeObject } from '@/scene/models/normalize'
import { useModelUrl } from '@/scene/models/useModelUrl'

interface PokemonVisualProps {
  speciesId: number
  artworkUrl: string
  shiny?: boolean
}

/** ①使用者 drop-in GLB（IndexedDB）→ ②billboard（PokéAPI artwork 貼圖平面，永遠面向相機）。 */
export function PokemonVisual({ speciesId, artworkUrl, shiny }: PokemonVisualProps) {
  const modelUrl = useModelUrl(speciesId)
  const billboard = <BillboardSprite url={artworkUrl} shiny={shiny} />

  // 還在查 IndexedDB：先不決定，避免閃一下 billboard 再換 GLB
  if (modelUrl === undefined) return null

  return (
    <VisualErrorBoundary key={modelUrl ?? 'billboard'} fallback={<Suspense fallback={null}>{billboard}</Suspense>}>
      <Suspense fallback={null}>{modelUrl ? <GlbModel url={modelUrl} /> : billboard}</Suspense>
    </VisualErrorBoundary>
  )
}

/** 自訂 GLB：載入後正規化（縮放到統一高度、腳底貼地、水平置中）。 */
function GlbModel({ url }: { url: string }) {
  const gltf = useLoader(GLTFLoader, url)
  // useLoader 會快取 gltf；clone 避免同模型在多處 primitive 衝突（含 skinned mesh）
  const object = useMemo(() => cloneSkinned(gltf.scene), [gltf])
  const norm = useMemo(() => normalizeObject(object), [object])
  return (
    <group position={norm.offset} scale={norm.scale}>
      <primitive object={object} />
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
        />
      </mesh>
    </Billboard>
  )
}

/** GLB 壞檔/載入失敗時退回 billboard，不讓整個 canvas 崩掉。 */
class VisualErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
