import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import type { BattleMobie } from '@/game/types'
import type { Side } from '@/game/battle/reducer'
import { MobieVisual } from './MobieVisual'

// 一隻在場寶可夢的動畫狀態：全部由 BattleStage 以 imperative 方式寫入、
// 在 useFrame 內整合套到 Object3D —— 完全不過 React 頂層 state（效能紅線）。
export interface MonAnim {
  /** lunge（撲擊）剩餘秒數 */
  lungeT: number
  /** 受擊抖動剩餘秒數 + 幅度 */
  shakeT: number
  shakeMag: number
  /** 入場（換上）剩餘秒數 */
  enterT: number
  /** 是否倒下（觸發傾倒淡沉）+ 進度 0..1 */
  fainted: boolean
  faintT: number
}

export function makeAnim(): MonAnim {
  return { lungeT: 0, shakeT: 0, shakeMag: 0, enterT: 0, fainted: false, faintT: 0 }
}

// 動畫時長（秒）。BattleStage 的 StageHandle 以同名常數 seed 對應的剩餘秒數，
// useFrame 內以 `剩餘/DUR` 正規化進度——seed 必須等於 DUR，故共用同一來源。
export const LUNGE_DUR = 0.42
export const SHAKE_DUR = 0.34
export const ENTER_DUR = 0.5
const FAINT_DUR = 0.6

const easeOutBack = (p: number) => {
  const c = 1.7
  const x = p - 1
  return 1 + (c + 1) * x * x * x + c * x * x
}

interface Combatant3DProps {
  side: Side
  mon: BattleMobie
  anim: MonAnim
  base: [number, number, number]
  /** 朝對手的 lunge 位移向量（x,z），由 BattleStage 依站位給 */
  lungeVec: [number, number]
  /** GLB 預設朝向：player 面相機(0)、foe 背對(π) */
  faceY: number
  /** idle 浮動相位，避免雙方同步 */
  bobPhase: number
}

/** 場上一隻寶可夢：造型（GLB/billboard）+ 撲擊/受擊/倒下/入場動畫。 */
export function Combatant3D({ side, mon, anim, base, lungeVec, faceY, bobPhase }: Combatant3DProps) {
  const group = useRef<Group>(null)

  useFrame((state, rawDelta) => {
    const g = group.current
    if (!g) return
    const delta = Math.min(rawDelta, 0.05) // 防卡頓跳幀
    const t = state.clock.elapsedTime
    let x = base[0]
    let y = base[1]
    let z = base[2]
    let rotX = 0
    let scale = 1

    if (anim.fainted) {
      anim.faintT = Math.min(1, anim.faintT + delta / FAINT_DUR)
      const p = anim.faintT
      rotX = (side === 'foe' ? -1 : 1) * p * 1.25 // 往後仰倒
      y -= p * 0.55
      scale = 1 - p * 0.5
    } else {
      anim.faintT = 0
      y += Math.sin(t * 1.6 + bobPhase) * 0.05 // idle 浮動

      if (anim.lungeT > 0) {
        anim.lungeT = Math.max(0, anim.lungeT - delta)
        const curve = Math.sin((1 - anim.lungeT / LUNGE_DUR) * Math.PI) // 0→1→0
        x += lungeVec[0] * curve
        z += lungeVec[1] * curve
      }

      if (anim.enterT > 0) {
        anim.enterT = Math.max(0, anim.enterT - delta)
        const p = 1 - anim.enterT / ENTER_DUR // 0→1
        scale = easeOutBack(Math.max(0, p))
        y += (1 - p) * 0.9 // 從上方落下
      }
    }

    if (anim.shakeT > 0) {
      anim.shakeT = Math.max(0, anim.shakeT - delta)
      const k = anim.shakeT / SHAKE_DUR
      x += Math.sin(anim.shakeT * 70) * anim.shakeMag * k
    }

    g.position.set(x, y, z)
    g.rotation.set(rotX, faceY, 0)
    g.scale.setScalar(scale)
  })

  // MobieVisual 自我保護（內含造型載入失敗的邊界），此處無須再外包。
  return (
    <group ref={group} position={base}>
      <MobieVisual speciesId={mon.speciesId} artworkUrl={mon.artworkUrl} shiny={mon.shiny} />
    </group>
  )
}
