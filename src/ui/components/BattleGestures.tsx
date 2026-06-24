// M22.f 戰鬥手勢 component（防禦下滑護盾）。守效能紅線：拖曳座標全走 ref/DOM，不進 React 頂層 state；
// 只在完成/逾時時 onResult 一次（doneRef 守）。**仍輸出既有 QteQuality**——手勢只換輸入形式、不改減傷規則。
// 攻擊節奏變體（M22.g）直接複用 StarStrikeGestures 的 RhythmTap（accuracy→count），不另開 component。

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { swipeFromPointer, swipeShieldQuality, type Pt } from '@/input/gestures'
import type { InteractMode } from '@/game/settings'
import type { QteQuality } from '@/game/battle/engine'
import { normPt } from '@/ui/components/gestureUtil'

/** 下滑拉護盾：向下快滑抬起護盾 → 依速度給 QteQuality；逾時以 normal 安全結束（絕不卡死）。 */
export function ShieldSwipe({ mode, onResult, timeoutMs = 5000 }: {
  mode: InteractMode
  onResult: (q: QteQuality) => void
  timeoutMs?: number
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const shieldRef = useRef<HTMLDivElement>(null)
  const samplesRef = useRef<Pt[]>([])
  const draggingRef = useRef(false)
  const doneRef = useRef(false)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  const finish = (q: QteQuality) => {
    if (doneRef.current) return
    doneRef.current = true
    onResultRef.current(q)
  }

  useEffect(() => {
    doneRef.current = false
    const t = window.setTimeout(() => finish('normal'), timeoutMs)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutMs])

  const down = (e: ReactPointerEvent) => {
    if (doneRef.current || !surfaceRef.current) return
    draggingRef.current = true
    rectRef.current = surfaceRef.current.getBoundingClientRect()
    samplesRef.current = [normPt(rectRef.current, e)]
  }
  const move = (e: ReactPointerEvent) => {
    if (!draggingRef.current || doneRef.current || !rectRef.current) return
    const p = normPt(rectRef.current, e)
    samplesRef.current.push(p)
    // 護盾隨下滑上抬（rAF 級別低頻，直寫 DOM 不過 state）
    if (shieldRef.current) shieldRef.current.style.transform = `translateY(${Math.min(0, -(p.y - samplesRef.current[0].y) * 60)}px)`
  }
  const up = () => {
    if (!draggingRef.current || doneRef.current) return
    draggingRef.current = false
    finish(swipeShieldQuality(swipeFromPointer(samplesRef.current), mode))
  }

  return (
    <div
      ref={surfaceRef}
      className="gesture-surface gesture-surface--shield"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      role="button"
      tabIndex={0}
    >
      <div ref={shieldRef} className="shield-icon">🛡</div>
      <div className="gesture-hint">👇 向下快滑拉起護盾！</div>
    </div>
  )
}
