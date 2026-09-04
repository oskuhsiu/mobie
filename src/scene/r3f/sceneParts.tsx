import { useMemo, useRef } from 'react'
import {
  CanvasTexture,
  Color,
  DoubleSide,
  type DirectionalLight,
  type HemisphereLight,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
  type Texture,
} from 'three'
import type { TerrainPalette } from './terrainVisual'
import { useTerrainTransition } from './terrainTransition'

// 共用場景元件（BattleStage / CaptureStage 共用）。
// 全程序化幾何 + 燈光，不依賴任何 HDRI/外部資產（offline + 不散布侵權資產）。

/**
 * 競技舞台燈光：半球環境光 + 主方向光 + 冷色補光。刻意輕量以顧 iPad 幀率。
 * EXT.3：`ambient`＝terrain palette 的天空色（半球上色），未給＝基線 `#bcd0ff`（neutral）。
 */
interface ColorOwner { color: Color }

export function useTerrainColorCrossfade<T extends ColorOwner>(
  ref: { current: T | null },
  targetColor: string,
) {
  const from = useRef(new Color(targetColor))
  const target = useRef(new Color(targetColor))

  useTerrainTransition(
    targetColor,
    () => {
      if (ref.current) from.current.copy(ref.current.color)
      target.current.set(targetColor)
    },
    (progress) => ref.current?.color.lerpColors(from.current, target.current, progress),
  )
}

export function StageLights({
  ambient = '#bcd0ff',
  palette,
  highDetail = true,
  intensity = 1,
}: {
  ambient?: string
  palette?: TerrainPalette
  highDetail?: boolean
  intensity?: number
}) {
  const hemisphere = useRef<HemisphereLight>(null)
  const key = useRef<DirectionalLight>(null)
  const rim = useRef<PointLight>(null)
  useTerrainColorCrossfade(hemisphere, palette?.ambient ?? ambient)
  useTerrainColorCrossfade(key, palette?.particleColor ?? '#fff4e0')
  useTerrainColorCrossfade(rim, palette?.featureTint ?? '#7aa2ff')
  const safeIntensity = Math.min(1, Math.max(0, intensity))

  return (
    <>
      <hemisphereLight ref={hemisphere} args={['#bcd0ff', '#1a1230', 0.78 + safeIntensity * 0.12]} />
      <directionalLight ref={key} position={[3.5, 7, 4]} intensity={0.95 + safeIntensity * 0.2} color="#fff4e0" />
      <pointLight
        ref={rim}
        position={[-4, 3, -3]}
        intensity={(highDetail ? 28 : 12) * safeIntensity}
        color="#7aa2ff"
        distance={18}
        decay={2}
      />
    </>
  )
}

/** 發光地台（每隻Mobie站一個）。 */
export function Pedestal({
  position,
  color = '#5b8cff',
}: {
  position: [number, number, number]
  color?: string
}) {
  return (
    <group position={position}>
      {/* 底座 */}
      <mesh receiveShadow position={[0, -0.11, 0]}>
        <cylinderGeometry args={[1.15, 1.32, 0.22, 48]} />
        <meshStandardMaterial color="#11152e" metalness={0.5} roughness={0.45} />
      </mesh>
      {/* 上緣發光環 */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.92, 1.12, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} side={DoubleSide} />
      </mesh>
      {/* 內圈微光台面 */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.92, 48]} />
        <meshStandardMaterial color="#1b2350" emissive={color} emissiveIntensity={0.18} roughness={0.8} />
      </mesh>
    </group>
  )
}

/**
 * 競技場地板：大圓盤 + 同心透視環（傾斜後成橢圓，撐起 3D 深度線索）。
 * EXT.3：`tint`＝terrain palette 地板色調，未給＝基線 `#0a0e22`（neutral）。
 */
export function ArenaFloor({
  tint = '#0a0e22',
  featureTint = '#3a4a8c',
}: {
  tint?: string
  featureTint?: string
}) {
  const floor = useRef<MeshStandardMaterial>(null)
  useTerrainColorCrossfade(floor, tint)

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.23, 0]}>
      <mesh receiveShadow>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial ref={floor} color="#0a0e22" roughness={1} metalness={0} />
      </mesh>
      {[3, 5.4, 8].map((r) => (
        <ArenaRing key={r} radius={r} color={featureTint} />
      ))}
    </group>
  )
}

function ArenaRing({ radius, color }: { radius: number; color: string }) {
  const material = useRef<MeshBasicMaterial>(null)
  useTerrainColorCrossfade(material, color)
  return (
    <mesh position={[0, 0, 0.01]}>
      <ringGeometry args={[radius - 0.04, radius, 96]} />
      <meshBasicMaterial ref={material} color="#3a4a8c" transparent opacity={0.16} side={DoubleSide} />
    </mesh>
  )
}

// 立繪「踩實」用的柔邊橢圓黑影：放在地台上、角色腳下（單例 texture，省重建）。
let _blobTex: CanvasTexture | null = null
function getBlobTexture(): Texture {
  if (_blobTex) return _blobTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(0,0,0,0.5)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.26)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  _blobTex = new CanvasTexture(c)
  return _blobTex
}

/** 角色腳下的柔邊接觸影，讓 2.5D 立繪「黏」在地台上。 */
export function BlobShadow({ position = [0, 0.03, 0], radius = 0.95 }: {
  position?: [number, number, number]
  radius?: number
}) {
  const tex = useMemo(() => getBlobTexture(), [])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position}>
      <planeGeometry args={[radius * 2, radius * 1.45]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} opacity={0.95} />
    </mesh>
  )
}
