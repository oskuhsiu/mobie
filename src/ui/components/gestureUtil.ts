// M22 手勢 component 共用：把 PointerEvent 座標正規化到手勢面板的 0..1。
// rect 應於 pointerdown 快取一次再傳入，避免每次 move 觸發 layout（效能紅線）。
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Pt } from '@/input/gestures'

export function normPt(rect: DOMRect, e: ReactPointerEvent): Pt {
  return {
    x: (e.clientX - rect.left) / Math.max(1, rect.width),
    y: (e.clientY - rect.top) / Math.max(1, rect.height),
    t: e.timeStamp,
  }
}
