// EXT.1.a 觸覺回饋（plan/EXT.1 §4.a）。純薄封裝 Vibration API：
// - feature-detect `navigator.vibrate`（iOS Safari 目前多半 no-op，Android/部分裝置有效）→ 不支援即靜默。
// - 總開關 `enabled` 由 settingsStore 同步（對應 prefs.haptics / hapticsEnabledOf）；off 時全程零呼叫。
// - 與 M4 體感、audio 同精神：display 層，**不碰 reducer/battle state**，所有呼叫安全包 try/catch、絕不丟例外。
//
// 語意化排程表（不直接傳魔術數字）：依「事件情緒強度」對應震動 pattern（ms；陣列＝震/停/震…交替）。

export type HapticKey = 'hit' | 'crit' | 'superEffective' | 'faint' | 'qteGood' | 'capture'

/** 語意化震動排程（plan/EXT.1 §4.a）。越強的事件越長/越多段。 */
export const HAPTIC: Record<HapticKey, number | number[]> = {
  hit: 12, // 命中：一下短震
  crit: [22, 40, 34], // 會心：雙擊長震（震-停-震）
  superEffective: [10, 28, 18], // 效果絕佳：輕快雙震
  faint: [44, 32, 64], // 倒下：沉重收尾
  qteGood: 8, // QTE 抓準：極短回饋
  capture: [16, 26, 16, 26, 48], // 捕獲揭曉：節慶式連震
}

// 總開關：由 settingsStore 在 settings 變動時呼叫 setHapticsEnabled 同步（預設 true）。
let enabled = true

/** 同步觸覺總開關（讀 hapticsEnabledOf 的結果）。off 時 vibrate/haptic 一律 no-op。 */
export function setHapticsEnabled(on: boolean): void {
  enabled = on
}

/** 裝置是否支援 Vibration API（SSR/node/iOS Safari 多半 false）。 */
export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

/** 低階：直接送出一段震動 pattern。回傳是否實際送出（關閉/不支援/丟例外＝false）。 */
export function vibrate(pattern: number | number[]): boolean {
  if (!enabled || !canVibrate()) return false
  try {
    return navigator.vibrate(pattern)
  } catch {
    return false // 部分瀏覽器在無使用者手勢時丟例外 → 靜默
  }
}

/** 高階：依語意 key 觸發對應震動（BattleScreen/Capture 各事件點呼叫）。 */
export function haptic(key: HapticKey): boolean {
  return vibrate(HAPTIC[key])
}
