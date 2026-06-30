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
  /** 演出時鐘倍率（1＝正常、<1＝慢鏡、0＝硬定格）。BattleScreen 接到 R3F 舞台 timeScale。 */
  setTimeScale?: (scale: number) => void
  /** 拍1 蓄力開始：BattleScreen 觸發 FxCanvas 吸入粒子 + Tone 上升 sweep。 */
  onCharge?: (spec: CutInSpec) => void
  /** 拍2 蓋章瞬間：BattleScreen 播印章 tick 音。 */
  onStamp?: (spec: CutInSpec) => void
  /** 拍3 衝擊：BattleScreen 觸發白閃 + 全屏衝擊波 + screenshake×1.5 + sub-bass boom。 */
  onImpact?: (spec: CutInSpec) => void
}

// 三拍時長（ms）。儀式感靠「慢鏡時鐘 + 這裡的節奏」，FxCanvas/Tone 走 real-time 與之脫鉤。
const CUTIN_CHARGE_MS = 720    // 拍1 蓄力：慢鏡 + 粒子吸入 + sweep
const CUTIN_STAMP_FREEZE_MS = 120 // 拍2 蓋章後硬定格

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
      // 三拍弧（plan/EXT.2 圓桌共識）。慢鏡只動 R3F 舞台（setTimeScale），卡片是銳利 DOM、FxCanvas/Tone real-time。
      // 拍1 蓄力：舞台降到慢鏡 + letterbox 進 + 四邊吸入粒子 + 上升 sweep（卡片還沒出）。
      hooks.setTimeScale?.(0.15)
      hooks.setLetterbox?.(true)
      hooks.onCharge?.(spec)
      await wait(CUTIN_CHARGE_MS)
      // 拍2 蓋章：卡片像印章硬砸中心 + 舞台硬定格(0) + 印章 tick → 80~120ms freeze。
      hooks.setCutIn?.(spec)
      hooks.setTimeScale?.(0)
      hooks.onStamp?.(spec)
      await wait(CUTIN_STAMP_FREEZE_MS)
      // 拍3 衝擊：卡片過曝退場 + 舞台 snap 回正常 + 白閃/全屏衝擊波/震動/boom。
      hooks.setCutIn?.(null)
      hooks.setTimeScale?.(1)
      hooks.onImpact?.(spec)
      // 不在此 resume：letterbox 保留到呼叫端「命中傷害」演完後再 resume() 收黑邊。
    },
  }
}
