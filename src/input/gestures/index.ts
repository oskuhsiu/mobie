// M22 純手勢層（plan/22 §5.1）。比照 input/qte.ts 的純函式契約：
// **輸入指針/座標序列、輸出單一純量或結構**，戰鬥邏輯只認純量。所有函式無副作用、可單測。
//
// 與 M4 體感同源：日後 MediaPipe 餵同樣的 pointer/progress 序列，手勢層即「觸控前身」，零改寫沿用。
// 高頻 component（SwipeThrow/CircleSeal/HoldChargeRing/RhythmTap）走 ref/rAF/DOM，只在完成時呼叫一次。

import { INTENSITY_BY_MODE, type InteractMode } from '@/game/settings'

/** 取樣點：x/y 已由 component 正規化到 0..1（相對手勢面板）；t 為毫秒時戳。 */
export interface Pt {
  x: number
  y: number
  t: number
}

/** off 不該跑手勢；萬一傳入，退回 lite 強度（安全、不崩）。 */
function intensity(mode: InteractMode) {
  return INTENSITY_BY_MODE[mode === 'off' ? 'lite' : mode]
}

// ── 捕獲：甩動丟球 ───────────────────────────────────────────────────────────
export type SwipeDir = 'up' | 'down' | 'left' | 'right'
export interface SwipeResult {
  dx: number
  dy: number
  /** 位移長度（正規化單位） */
  dist: number
  /** 速度＝dist / dt（正規化單位 per ms） */
  speed: number
  dir: SwipeDir
  /** 單位方向向量（無位移時為 0 向量） */
  throwVector: { x: number; y: number }
}

/** 由指針取樣序列首→尾算出甩動方向/速度/投擲向量。少於 2 點＝靜止。 */
export function swipeFromPointer(samples: Pt[]): SwipeResult {
  const none: SwipeResult = { dx: 0, dy: 0, dist: 0, speed: 0, dir: 'up', throwVector: { x: 0, y: 0 } }
  if (samples.length < 2) return none
  const a = samples[0]
  const b = samples[samples.length - 1]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.hypot(dx, dy)
  const dt = Math.max(1, b.t - a.t)
  const speed = dist / dt
  // 螢幕 y 向下增長：dy<0＝向上甩（朝野生Mobie）
  const dir: SwipeDir = Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : dx < 0 ? 'left' : 'right'
  const throwVector = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 0, y: 0 }
  return { dx, dy, dist, speed, dir, throwVector }
}

/** 是否構成一次有效甩動（速度過閾 + 位移夠長）；強度由 mode 派生。 */
export function swipeThrowValid(r: SwipeResult, mode: InteractMode): boolean {
  return r.speed >= intensity(mode).swipeMinSpeed && r.dist >= 0.04
}

// ── 捕獲：畫圈封印 ───────────────────────────────────────────────────────────
/** 點對中心的極角（rad）。 */
export function angleTo(center: { x: number; y: number }, p: { x: number; y: number }): number {
  return Math.atan2(p.y - center.y, p.x - center.x)
}

/** 把角度正規化到 (-π, π]，供累加相鄰幀角差時跨 ±π 不爆衝。 */
export function wrapAngle(a: number): number {
  let x = a
  while (x <= -Math.PI) x += 2 * Math.PI
  while (x > Math.PI) x -= 2 * Math.PI
  return x
}

/** 取樣序列繞 center（預設質心）累積的總掃掠弧度（絕對值，不分順逆時針）。 */
export function sweptAngle(samples: Pt[], center?: { x: number; y: number }): number {
  if (samples.length < 2) return 0
  const c =
    center ?? {
      x: samples.reduce((s, p) => s + p.x, 0) / samples.length,
      y: samples.reduce((s, p) => s + p.y, 0) / samples.length,
    }
  let total = 0
  let prev = angleTo(c, samples[0])
  for (let i = 1; i < samples.length; i++) {
    const cur = angleTo(c, samples[i])
    total += Math.abs(wrapAngle(cur - prev))
    prev = cur
  }
  return total
}

/** 畫圈累進 0..1＝掃掠弧度 / 目標弧度（夾上限）。 */
export function circleProgress(samples: Pt[], targetRad: number, center?: { x: number; y: number }): number {
  if (targetRad <= 0) return 1
  return Math.min(1, sweptAngle(samples, center) / targetRad)
}

// ── 星擊：長按蓄力 ───────────────────────────────────────────────────────────
/** 長按蓄力環 0..1＝按住時間 / 該 mode 填滿所需時間（夾 [0,1]）。 */
export function holdCharge(durationMs: number, mode: InteractMode): number {
  const full = intensity(mode).holdChargeMs
  if (full <= 0) return 1
  return Math.max(0, Math.min(1, durationMs / full))
}

// ── 星擊：節奏點擊（太鼓式） ─────────────────────────────────────────────────
/** 等距節拍時間表：第 i 拍在 startMs + i·interval（共 rhythmBeats 拍）。 */
export function beatSchedule(startMs: number, mode: InteractMode): number[] {
  const { rhythmBeats, rhythmIntervalMs } = intensity(mode)
  return Array.from({ length: rhythmBeats }, (_, i) => startMs + i * rhythmIntervalMs)
}

/**
 * 把每個 tap 配對到最近的拍（每個 tap 至多用一次），回傳各拍的 |offset|（ms）。
 * 窗外或缺 tap 的拍記 windowMs（＝該拍 0 分）。純匹配，可測。
 */
export function matchTapsToBeats(tapTimes: number[], beatTimes: number[], windowMs: number): number[] {
  const used = new Array(tapTimes.length).fill(false)
  return beatTimes.map((bt) => {
    let best = windowMs
    let bestIdx = -1
    for (let i = 0; i < tapTimes.length; i++) {
      if (used[i]) continue
      const off = Math.abs(tapTimes[i] - bt)
      if (off < best) {
        best = off
        bestIdx = i
      }
    }
    if (bestIdx >= 0) used[bestIdx] = true
    return best
  })
}

/** 各拍 accuracy＝clamp(1 − offset/window)，平均成 0..1。空 → 0。 */
export function rhythmAccuracy(offsetsMs: number[], windowMs: number): number {
  if (offsetsMs.length === 0 || windowMs <= 0) return 0
  const sum = offsetsMs.reduce((s, o) => s + Math.max(0, 1 - Math.min(o, windowMs) / windowMs), 0)
  return sum / offsetsMs.length
}

/** 節奏判定：把 tap 時戳對 beat 時間表打分，回 0..1 準確度（純 FX 強度用，不進 reducer）。 */
export function rhythmTaps(tapTimes: number[], beatTimes: number[], mode: InteractMode): number {
  const { rhythmWindowMs } = intensity(mode)
  return rhythmAccuracy(matchTapsToBeats(tapTimes, beatTimes, rhythmWindowMs), rhythmWindowMs)
}
