import { useMemo } from 'react'
import { CanvasTexture, DoubleSide, type Texture } from 'three'

// 共用場景元件（BattleStage / CaptureStage 共用）。
// 全程序化幾何 + 燈光，不依賴任何 HDRI/外部資產（offline + 不散布侵權資產）。

/**
 * 競技舞台燈光：半球環境光 + 主方向光 + 冷色補光。刻意輕量以顧 iPad 幀率。
 * EXT.3：`ambient`＝terrain palette 的天空色（半球上色），未給＝基線 `#bcd0ff`（neutral）。
 */
export function StageLights({ ambient = '#bcd0ff' }: { ambient?: string }) {
  return (
    <>
      <hemisphereLight args={[ambient, '#1a1230', 0.9]} />
      <directionalLight position={[3.5, 7, 4]} intensity={1.15} color="#fff4e0" />
      <pointLight position={[-4, 3, -3]} intensity={28} color="#7aa2ff" distance={18} decay={2} />
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
export function ArenaFloor({ tint = '#0a0e22' }: { tint?: string }) {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.23, 0]}>
      <mesh receiveShadow>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial color={tint} roughness={1} metalness={0} />
      </mesh>
      {[3, 5.4, 8].map((r) => (
        <mesh key={r} position={[0, 0, 0.01]}>
          <ringGeometry args={[r - 0.04, r, 96]} />
          <meshBasicMaterial color="#3a4a8c" transparent opacity={0.16} side={DoubleSide} />
        </mesh>
      ))}
    </group>
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
