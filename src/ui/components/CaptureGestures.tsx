// M22.c 捕獲手勢 component（plan/22 §2.1, §5.2）。守效能紅線：高頻值（拖曳座標/圈數）全走
// ref/DOM style，絕不進 React 頂層 state；每個 component 只在完成/逾時時 onDone 一次（doneRef 守）。
// **不改捕獲機率**：手勢只決定演出與推進時機，caught 由 WinView 掛載時預先決定。

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { swipeFromPointer, swipeThrowValid, angleTo, wrapAngle, type Pt } from '@/input/gestures'
import type { InteractMode } from '@/game/settings'
import { normPt } from '@/ui/components/gestureUtil'

/** 甩動丟球：向上快甩即丟出；逾時自動以基準速度丟（絕不卡死）。 */
export function SwipeThrow({ mode, onThrow, timeoutMs = 6000 }: {
  mode: InteractMode
  onThrow: (speed: number) => void
  timeoutMs?: number
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const samplesRef = useRef<Pt[]>([])
  const draggingRef = useRef(false)
  const doneRef = useRef(false)
  const onThrowRef = useRef(onThrow)
  onThrowRef.current = onThrow

  const finish = (speed: number) => {
    if (doneRef.current) return
    doneRef.current = true
    onThrowRef.current(speed)
  }

  useEffect(() => {
    doneRef.current = false
    const t = window.setTimeout(() => finish(0), timeoutMs)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutMs])

  const down = (e: ReactPointerEvent) => {
    if (doneRef.current || !surfaceRef.current) return
    draggingRef.current = true
    rectRef.current = surfaceRef.current.getBoundingClientRect()
    samplesRef.current = [normPt(rectRef.current, e)]
    if (dotRef.current) dotRef.current.style.opacity = '1'
  }
  const move = (e: ReactPointerEvent) => {
    if (!draggingRef.current || doneRef.current || !rectRef.current) return
    const p = normPt(rectRef.current, e)
    samplesRef.current.push(p)
    if (dotRef.current) {
      dotRef.current.style.left = `${p.x * 100}%`
      dotRef.current.style.top = `${p.y * 100}%`
    }
  }
  const up = () => {
    if (!draggingRef.current || doneRef.current) return
    draggingRef.current = false
    const r = swipeFromPointer(samplesRef.current)
    if (swipeThrowValid(r, mode)) finish(r.speed)
    else {
      // 不是有效甩動：重置讓孩子再試（逾時仍會自動丟，不卡死）
      samplesRef.current = []
      if (dotRef.current) dotRef.current.style.opacity = '0'
    }
  }

  return (
    <div
      ref={surfaceRef}
      className="gesture-surface"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      role="button"
      tabIndex={0}
    >
      <div className="gesture-hint">👆 向上甩動丟出寶貝球！</div>
      <div ref={dotRef} className="gesture-dot" style={{ opacity: 0 }} />
    </div>
  )
}

/** 畫圈封印：繞中心持續畫圈累積進度，滿（或逾時）即結束。回傳進度供 WinView 決定演出。 */
export function CircleSeal({ targetRad, onSealed, label = '✦ 畫圈封印！', timeoutMs = 4500 }: {
  targetRad: number
  onSealed: (progress: number) => void
  label?: string
  timeoutMs?: number
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const lastAngleRef = useRef(0)
  const accRef = useRef(0)
  const doneRef = useRef(false)
  const onSealedRef = useRef(onSealed)
  onSealedRef.current = onSealed
  const center = { x: 0.5, y: 0.5 }

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    onSealedRef.current(Math.min(1, accRef.current / targetRad))
  }

  useEffect(() => {
    doneRef.current = false
    accRef.current = 0
    const t = window.setTimeout(finish, timeoutMs)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutMs, targetRad])

  const paint = () => {
    const p = Math.min(1, accRef.current / targetRad)
    if (ringRef.current) ringRef.current.style.background = `conic-gradient(#7ad6ff ${p * 360}deg, rgba(255,255,255,0.10) 0)`
    if (p >= 1) finish()
  }
  const down = (e: ReactPointerEvent) => {
    if (doneRef.current || !surfaceRef.current) return
    draggingRef.current = true
    rectRef.current = surfaceRef.current.getBoundingClientRect()
    lastAngleRef.current = angleTo(center, normPt(rectRef.current, e))
  }
  const move = (e: ReactPointerEvent) => {
    if (!draggingRef.current || doneRef.current || !rectRef.current) return
    const a = angleTo(center, normPt(rectRef.current, e))
    accRef.current += Math.abs(wrapAngle(a - lastAngleRef.current))
    lastAngleRef.current = a
    paint()
  }
  const up = () => {
    draggingRef.current = false
  }

  return (
    <div
      ref={surfaceRef}
      className="gesture-surface gesture-surface--seal"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      role="button"
      tabIndex={0}
    >
      <div ref={ringRef} className="gesture-seal-ring" />
      <div className="gesture-hint gesture-hint--seal">{label}</div>
    </div>
  )
}
