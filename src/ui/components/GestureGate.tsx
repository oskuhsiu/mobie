// M22.h/i/j 通用「手勢 gate」：在既有動作（出戰／孵化／開始遠征）前疊一段純演出手勢——
// 來回撥動/摩擦累積進度條，滿（或逾時）即 onComplete 推進原動作。**純演出**：不影響任何結果、永不卡死。
// 守效能紅線：累積路徑長走 ref、進度條直寫 DOM，不進 React 頂層 state；完成只觸發一次（doneRef 守）。

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { motion } from 'framer-motion'
import { type Pt } from '@/input/gestures'
import { normPt } from '@/ui/components/gestureUtil'
import { audio } from '@/audio/audioEngine'

export function GestureGate({ title, icon, hint, targetUnits = 3.2, onComplete, onCancel, timeoutMs = 6000 }: {
  title: string
  icon: string
  hint: string
  /** 累積到此折線總長（正規化單位）即完成；越大越久。預設 3.2≈來回數趟。 */
  targetUnits?: number
  onComplete: () => void
  onCancel: () => void
  timeoutMs?: number
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLDivElement>(null)
  const accRef = useRef(0)
  const lastRef = useRef<Pt | null>(null)
  const doneRef = useRef(false)
  const cbRef = useRef(onComplete)
  cbRef.current = onComplete

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    audio.play('super')
    cbRef.current()
  }

  useEffect(() => {
    doneRef.current = false
    accRef.current = 0
    const t = window.setTimeout(finish, timeoutMs) // 逾時自動推進（絕不卡死）
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutMs])

  const paint = () => {
    const p = Math.min(1, accRef.current / Math.max(0.001, targetUnits))
    if (barRef.current) barRef.current.style.width = `${p * 100}%`
    if (iconRef.current) iconRef.current.style.transform = `scale(${1 + p * 0.5}) rotate(${p * 360}deg)`
    if (p >= 1) finish()
  }
  const down = (e: ReactPointerEvent) => {
    if (doneRef.current || !surfaceRef.current) return
    rectRef.current = surfaceRef.current.getBoundingClientRect()
    lastRef.current = normPt(rectRef.current, e)
  }
  const move = (e: ReactPointerEvent) => {
    if (doneRef.current || !rectRef.current || !lastRef.current) return
    const p = normPt(rectRef.current, e)
    accRef.current += Math.hypot(p.x - lastRef.current.x, p.y - lastRef.current.y)
    lastRef.current = p
    paint()
  }
  const up = () => { lastRef.current = null }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="modal-card gesture-gate" initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()}>
        <div className="h-title" style={{ fontSize: 22, textAlign: 'center' }}>{title}</div>
        <div
          ref={surfaceRef}
          className="gesture-surface gesture-surface--gate"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          role="button"
          tabIndex={0}
        >
          <div ref={iconRef} className="gesture-gate__icon">{icon}</div>
          <div className="gesture-hint">{hint}</div>
        </div>
        <div className="gesture-gate__track"><div ref={barRef} className="gesture-gate__fill" /></div>
        <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'center' }} onClick={onCancel}>取消</button>
      </motion.div>
    </motion.div>
  )
}
