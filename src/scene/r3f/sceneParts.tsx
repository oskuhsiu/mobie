import { DoubleSide } from 'three'

// 共用場景元件（BattleStage / CaptureStage 共用）。
// 全程序化幾何 + 燈光，不依賴任何 HDRI/外部資產（offline + 不散布侵權資產）。

/** 競技舞台燈光：半球環境光 + 主方向光 + 冷色補光。刻意輕量以顧 iPad 幀率。 */
export function StageLights() {
  return (
    <>
      <hemisphereLight args={['#bcd0ff', '#1a1230', 0.9]} />
      <directionalLight position={[3.5, 7, 4]} intensity={1.15} color="#fff4e0" />
      <pointLight position={[-4, 3, -3]} intensity={28} color="#7aa2ff" distance={18} decay={2} />
    </>
  )
}

/** 發光地台（每隻寶可夢站一個）。 */
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

/** 競技場地板：大圓盤 + 遠處淡出，給場景一個落地基準。 */
export function ArenaFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.23, 0]} receiveShadow>
      <circleGeometry args={[14, 64]} />
      <meshStandardMaterial color="#0a0e22" roughness={1} metalness={0} />
    </mesh>
  )
}
