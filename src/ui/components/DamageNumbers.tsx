import { forwardRef, useImperativeHandle, useRef } from 'react'

// EXT.1.b 浮動傷害數字（plan/EXT.1 §4.b）。比照 FxCanvas/TimingBar 的紅線：
// imperative handle + DOM 物件池複用，**每幀位置/動畫全走 CSS keyframe（GPU），不過 React 頂層 state**。
// 圖示優先（C3，幼兒不識字）：效果絕佳＝紅色 ↑↑、不太有效＝藍色 ↓；會心＝放大金色 + ！。
//
// 由 BattleScreen 在消費 `damageApplied`/intrusion 時於受擊方螢幕座標 spawn；juice:'off' 時根本不渲染本層
// （回退既有 FloatDamage＝M22 基線、DOM 零新增）。

export interface DamageSpawn {
  /** 正規化座標（0..1，相對戰鬥區）＝受擊方打點 */
  nx: number
  ny: number
  amount: number
  crit: boolean
  /** reducer 相剋倍率：>=2 絕佳 / 0<eff<1 不佳 / 0 無效 / 1 普通 */
  effectiveness: number
  missed: boolean
}

export interface DamageNumbersHandle {
  spawn: (o: DamageSpawn) => void
}

const POOL = 6 // 同時最多 6 個飄字（本遊戲傷害逐一演出，6 足夠且不殘留）

/** 依相剋/會心決定圖示與樣式 class（圖示優先）。 */
function effIcon(eff: number, missed: boolean, amount: number): string {
  if (missed || amount <= 0) return ''
  if (eff >= 2) return '↑↑'
  if (eff > 0 && eff < 1) return '↓'
  return ''
}

export const DamageNumbers = forwardRef<DamageNumbersHandle>((_props, ref) => {
  const poolRef = useRef<HTMLDivElement>(null)
  const idxRef = useRef(0)

  useImperativeHandle(ref, () => ({
    spawn: ({ nx, ny, amount, crit, effectiveness, missed }) => {
      const pool = poolRef.current
      if (!pool) return
      const node = pool.children[idxRef.current++ % POOL] as HTMLDivElement | undefined
      if (!node) return
      const valEl = node.querySelector('.dmg-num__val') as HTMLElement | null
      const effEl = node.querySelector('.dmg-num__eff') as HTMLElement | null

      // 文案：MISS / 沒效果 / -傷害
      const text = missed ? 'MISS' : amount <= 0 ? '沒效果' : `-${amount}`
      if (valEl) valEl.textContent = text
      if (effEl) effEl.textContent = effIcon(effectiveness, missed, amount)

      // 樣式變體（圖示/顏色/放大）
      node.className = 'dmg-num'
      if (crit) node.classList.add('dmg-num--crit')
      else if (!missed && amount > 0 && effectiveness >= 2) node.classList.add('dmg-num--super')
      else if (!missed && amount > 0 && effectiveness > 0 && effectiveness < 1) node.classList.add('dmg-num--weak')
      if (missed || amount <= 0) node.classList.add('dmg-num--null')

      node.style.left = `${nx * 100}%`
      node.style.top = `${ny * 100}%`
      // 重觸發 CSS 動畫（remove → 強制 reflow → add），不過 React state。
      node.classList.remove('is-on')
      void node.offsetWidth
      node.classList.add('is-on')
    },
  }), [])

  return (
    <div ref={poolRef} className="dmg-num-layer" aria-hidden>
      {Array.from({ length: POOL }).map((_, i) => (
        <div key={i} className="dmg-num">
          <span className="dmg-num__eff" />
          <span className="dmg-num__val" />
        </div>
      ))}
    </div>
  )
})
DamageNumbers.displayName = 'DamageNumbers'
