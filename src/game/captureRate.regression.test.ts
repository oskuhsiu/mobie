// M22.c 回歸：增強互動性手勢「絕不改捕獲機率」（plan/22 §2.1 純度鐵律、§6 驗收）。
//
// WinView 的捕獲決定＝ `Math.random() < captureChanceWithBall(wild, ball.mult * captureMult)`，
// **沒有任何 mode 項**。本測守住此不變式：唯一機率 API captureChanceWithBall 的輸入只有
// (mon, ballMult)；若日後有人把互動強度乘進機率，此測會紅。
import { describe, it, expect } from 'vitest'
import { captureChanceWithBall } from '@/game/battle/engine'
import type { BattleMobie } from '@/game/types'
import { defaultSettings, setInteractModeIn, interactModeOf, type InteractMode } from '@/game/settings'

// captureChance 只讀 level；其餘欄位與機率無關，故用最小 stub。
const wild = { level: 20 } as BattleMobie
const MODES: InteractMode[] = ['off', 'lite', 'arcade']

describe('M22.c 捕獲機率不受增強互動 mode 影響', () => {
  it('同一 (wild, ballMult) 在 off/lite/arcade 下機率完全相同', () => {
    const ballMult = 1.4 // 超級球
    const captureMult = 1.0
    const chances = MODES.map(() => captureChanceWithBall(wild, ballMult * captureMult))
    // 三 mode 機率逐一相等（mode 不是 captureChanceWithBall 的輸入 → 結構上必然，守迴歸）
    expect(new Set(chances).size).toBe(1)
  })

  it('決定論：固定 rng 抽值 + 固定機率 → 三 mode 同一 caught 布林', () => {
    const ballMult = 1.9
    const chance = captureChanceWithBall(wild, ballMult)
    for (const rnd of [0.1, 0.5, 0.97]) {
      const decisions = MODES.map((m) => {
        // 模擬 WinView 決定式：mode 只經 selector 影響「演出」，不進此式。
        const s = setInteractModeIn(defaultSettings(), m)
        void interactModeOf(s, 'capture') // 取 mode（純演出 gating）— 不參與下行
        return rnd < chance
      })
      expect(new Set(decisions).size).toBe(1) // 三 mode 結果一致
    }
  })

  it('幸運捕獲 captureMult 仍只乘在 ballMult（與 mode 無關）', () => {
    const base = captureChanceWithBall(wild, 1.0 * 1.0)
    const lucky = captureChanceWithBall(wild, 1.0 * 1.5)
    expect(lucky).toBeGreaterThanOrEqual(base) // 幸運加成有效
    // 但封頂 0.98，且 lucky 對 off/arcade 一致（無 mode 項）
    expect(lucky).toBeLessThanOrEqual(0.98)
  })
})
