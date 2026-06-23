import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { Vector3, PerspectiveCamera } from 'three'
import type { BattlePokemon } from '@/game/types'
import type { Side } from '@/game/battle/reducer'
import { StageLights, Pedestal, ArenaFloor, BlobShadow } from './sceneParts'
import { Combatant3D, makeAnim, LUNGE_DUR, SHAKE_DUR, ENTER_DUR, type MonAnim } from './Combatant3D'

// 站位：foe 在後（畫面上方）、player 在前（畫面下方），對齊 2D 版面語言。
// player z 往後一點（畫面上抬），留底部控制列 safe zone。
const PLAYER_BASE: [number, number, number] = [-1.15, 0, 0.2]
const FOE_BASE: [number, number, number] = [1.15, 0, -1.8]
const PLAYER_LUNGE: [number, number] = [0.95, -0.9]
const FOE_LUNGE: [number, number] = [-0.95, 0.9]

/** BattleScreen 透過此 handle 觸發 3D 演出（與 FxCanvas 同模式：imperative、不過 React state）。 */
export interface StageHandle {
  /** 撲擊（攻擊出手方往對手方向衝） */
  lunge: (side: Side) => void
  /** 受擊反應：抖動，strength 放大幅度（會心/效果絕佳更大） */
  hitReact: (side: Side, strength?: number) => void
  /** 倒下（傾倒淡沉） */
  faint: (side: Side) => void
  /** 換上/入場（從上落下 + 彈跳放大，並清除倒下狀態） */
  enter: (side: Side) => void
}

interface BattleStageProps {
  player: BattlePokemon
  foe: BattlePokemon
}

// 取景目標與「target→相機」方向（沿用原本的俯角構圖，只動距離）。
const LOOK_AT = new Vector3(0, 1.05, -0.55)
const VIEW_DIR = new Vector3(0, 2.95, 6.4).sub(LOOK_AT).normalize() // 原相機位置 - 目標
// 要保證入鏡的世界半寬/半高（角色站位 ±1.15、立繪上緣 ~2.3）：
const WANT_HALF_W = 2.0 // 水平：±2.0 才能完整含住兩隻角色身體（含頭）
const WANT_HALF_H = 2.5 // 垂直：含腳底~頭頂 + 邊距
const MIN_DIST = 7.0 // 寬螢幕（iPad）維持原始構圖距離，只在窄螢幕往後拉

/**
 * 依畫面寬高比自動擺相機距離，確保兩隻寶可夢在任何手機直向比例都完整入鏡。
 * fov 是「垂直」的 → 水平可視範圍 = 垂直 × aspect；手機直向 aspect 很小（~0.46），
 * 若距離固定，水平就塞不下角色 → 立繪被左右切掉（頭被裁）。故窄螢幕拉遠相機。
 */
function CameraRig() {
  const { camera, size } = useThree()
  useEffect(() => {
    const cam = camera as PerspectiveCamera
    const aspect = size.width / Math.max(1, size.height)
    const tanHalf = Math.tan((cam.fov * Math.PI) / 180 / 2)
    const distV = WANT_HALF_H / tanHalf
    const distH = WANT_HALF_W / (tanHalf * aspect)
    const dist = Math.max(MIN_DIST, distV, distH)
    cam.position.copy(LOOK_AT).addScaledVector(VIEW_DIR, dist)
    cam.lookAt(LOOK_AT)
    cam.updateProjectionMatrix()
  }, [camera, size.width, size.height])
  return null
}

const BattleStage = forwardRef<StageHandle, BattleStageProps>(function BattleStage({ player, foe }, ref) {
  const anim = useRef<Record<Side, MonAnim>>({ player: makeAnim(), foe: makeAnim() })

  useImperativeHandle(
    ref,
    () => ({
      lunge: (side) => {
        anim.current[side].lungeT = LUNGE_DUR
      },
      hitReact: (side, strength = 1) => {
        const a = anim.current[side]
        a.shakeT = SHAKE_DUR
        a.shakeMag = 0.16 * strength
      },
      faint: (side) => {
        anim.current[side].fainted = true
      },
      enter: (side) => {
        const a = anim.current[side]
        a.fainted = false
        a.faintT = 0
        a.enterT = ENTER_DUR
      },
    }),
    [],
  )

  return (
    <Canvas
      dpr={[1, 2]}
      frameloop="always"
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 2.95, 6.4], fov: 40 }}
      style={{ position: 'absolute', inset: 0, zIndex: 0 }}
    >
      <CameraRig />
      <StageLights />
      <ArenaFloor />
      <Pedestal position={FOE_BASE} color="#ff7a9c" />
      <Pedestal position={PLAYER_BASE} color="#5b8cff" />
      <group position={FOE_BASE}><BlobShadow /></group>
      <group position={PLAYER_BASE}><BlobShadow /></group>
      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={10} blur={2.6} far={4} resolution={256} color="#05060f" />

      <Combatant3D
        side="foe"
        mon={foe}
        anim={anim.current.foe}
        base={FOE_BASE}
        lungeVec={FOE_LUNGE}
        faceY={Math.PI}
        bobPhase={Math.PI}
      />
      <Combatant3D
        side="player"
        mon={player}
        anim={anim.current.player}
        base={PLAYER_BASE}
        lungeVec={PLAYER_LUNGE}
        faceY={0}
        bobPhase={0}
      />
    </Canvas>
  )
})

export default BattleStage
