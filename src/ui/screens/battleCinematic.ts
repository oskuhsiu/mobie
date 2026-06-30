// EXT.1 §6 演出協調器（cinematicCoordinator seam）。**純 display 協調器，不碰 reducer/battle state。**
//
// 定位（plan/EXT.1 §6、plan/EXT.2）：
// - BattleScreen 私有的「演出推進」協調層——hit-stop（頓格）與 EXT.2 星擊 cut-in（慢鏡/letterbox/運鏡）
//   共用同一個控制器，集中管理「暫停 / 慢放 / 全螢幕插入 / 安全退場」。
// - **不是** S1–S8 ext seam（那些碰 reducer）；命名「seam」僅指預留擴充點。
// - EXT.1 只實作 `pause/resume`（§4.c 的 hit-stop）；`cutIn` 已用 hooks 寫好，但 EXT.1 不接線 hooks＝等同 stub，
//   EXT.2 只需在 BattleScreen 接上 setCutIn/setLetterbox state + CSS keyframes 即生效（不重構）。
//
// 紅線：hit-stop ＝ presentation clock pause（暫停的是「演出推進」節奏，非 reducer 回合時間線）；**不改 nextState**。

import type { Side } from '@/game/battle/reducer'
import type { TypeName } from '@/game/types'

/** EXT.2 全螢幕 cut-in 規格：施放者頭像 + 招式名 + per-type 視覺。由 BattleScreen 星擊觸發點組好傳入。 */
export interface CutInSpec {
  /** 施放者大頭像（PokéAPI artwork，已是 runtime URL） */
  artworkUrl: string
  /** 施放者名（cut-in 副標） */
  casterName: string
  /** 招式名（resolvedMoveId 帶出；cut-in 主標） */
  moveName: string
  /** 招式屬性 → per-type 光影色（複用 typePalette） */
  type: TypeName
  /** 施放方（運鏡/站位用） */
  side: Side
}

/** cinematicCoordinator 對外契約（plan/EXT.1 §6）。 */
export interface CinematicCoordinator {
  /** hit-stop / 慢鏡：凍結演出推進 ms 毫秒（可被 resume 提前結束）。 */
  pause(ms: number): Promise<void>
  /** 安全退場：取消進行中的 pause、收起 letterbox/cut-in、時鐘回速。中斷/逾時必呼叫，演出絕不卡死。 */
  resume(): void
  /** EXT.2 全螢幕 cut-in 進場（letterbox in + 慢鏡 + cut-in 卡片 hold）。
   *  resolve 時保留 letterbox/慢鏡（讓緊接的命中演出仍在電影框內）；收尾由呼叫端 resume()。 */
  cutIn(spec: CutInSpec): Promise<void>
}

/** BattleScreen 注入的 display 副作用（低頻：每場星擊一次，走一般 React state 不違反效能紅線）。 */
export interface CinematicHooks {
  /** 顯示/收起全螢幕 cut-in 卡片（null＝收起）。 */
  setCutIn?: (spec: CutInSpec | null) => void
  /** 上下黑邊 letterbox 開關。 */
  setLetterbox?: (on: boolean) => void
  /** 演出時鐘倍率（1＝正常、<1＝慢鏡）；CSS 可據此放慢動畫。EXT.1 不使用。 */
  setTimeScale?: (scale: number) => void
}

/** cut-in 進場各段時長（ms）。慢鏡的儀式感靠這裡的節奏，而非真的時間膨脹整條 await 鏈。 */
const CUTIN_LETTERBOX_IN = 220
const CUTIN_HOLD = 900

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 建一個 cinematicCoordinator。`hooks` 缺省（EXT.1）時 cutIn 仍可呼叫但無視覺（等同 stub）；
 * EXT.2 在 BattleScreen 傳入 setCutIn/setLetterbox state 即點亮全套演出。
 */
export function createCinematicCoordinator(hooks: CinematicHooks = {}): CinematicCoordinator {
  // 進行中 pause 的提前結束器（resume 用來中斷凍結，保證不卡死）。
  let abortPause: (() => void) | null = null

  const clearStage = () => {
    hooks.setCutIn?.(null)
    hooks.setLetterbox?.(false)
    hooks.setTimeScale?.(1)
  }

  return {
    pause(ms) {
      return new Promise<void>((resolve) => {
        if (ms <= 0) { resolve(); return }
        const id = setTimeout(() => { abortPause = null; resolve() }, ms)
        abortPause = () => { clearTimeout(id); abortPause = null; resolve() }
      })
    },
    resume() {
      abortPause?.() // 提前結束任何進行中的凍結
      clearStage() // 收 letterbox/cut-in、時鐘回速
    },
    async cutIn(spec) {
      // 進場：letterbox 滑入 + 降速 + 顯示 cut-in 卡片 → hold（戲劇停頓）→ 收卡片但保留電影框。
      hooks.setTimeScale?.(0.45)
      hooks.setLetterbox?.(true)
      await wait(CUTIN_LETTERBOX_IN)
      hooks.setCutIn?.(spec)
      await wait(CUTIN_HOLD)
      hooks.setCutIn?.(null)
      // 不在此 resume：letterbox/慢鏡保留到呼叫端命中演出結束後再 resume()。
    },
  }
}
