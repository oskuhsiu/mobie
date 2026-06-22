import type { QteQuality } from '@/game/battle/engine'

/**
 * QTE timing 的共用契約：把「指針停下的位置」轉成命中品質。
 * M1 由觸控 timing bar 產生 pointer；M4 由 MediaPipe（握拳停輪盤）產生同樣的 pointer，
 * 兩者共用此函數，戰鬥邏輯只認識 QteQuality。
 *
 * pointer ∈ [0,1]，0.5 為正中。
 */
export function qualityFromPointer(pointer: number): QteQuality {
  const d = Math.abs(pointer - 0.5) * 2 // 距中心 0..1
  if (d < 0.08) return 'perfect'
  if (d < 0.30) return 'good'
  if (d < 0.85) return 'normal'
  return 'weak'
}

export interface QteZone {
  quality: QteQuality
  label: string
  /** 在 0..1 軸上的半寬（距中心） */
  halfWidth: number
  color: string
}

/** 由中心向外的命中帶，給 UI 畫 timing bar 用 */
export const QTE_ZONES: QteZone[] = [
  { quality: 'perfect', label: 'PERFECT', halfWidth: 0.08, color: '#ffd23f' },
  { quality: 'good', label: 'GOOD', halfWidth: 0.30, color: '#4ade80' },
  { quality: 'normal', label: 'OK', halfWidth: 0.85, color: '#60a5fa' },
]
