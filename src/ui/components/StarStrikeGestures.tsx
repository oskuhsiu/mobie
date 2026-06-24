// M22.d 星擊手勢 component（plan/22 §2.2, §5.2）。守效能紅線：蓄力寬度/節奏脈動全走 rAF/ref/DOM，
// 絕不進 React 頂層 state；每個 component 只在完成/逾時時 onDone 一次（doneRef 守）。
// **runStarStrike 簽名不動**：手勢只是「儀式」，不改星擊傷害；中斷/逾時皆安全放招（絕不卡死）。
// 不沿用攻擊連打（MashMeter）＝避免肌肉記憶重複（plan/22 §2.2 Q1 codex）。

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { holdCharge, beatSchedule, rhythmTaps } from '@/input/gestures'
import { INTENSITY_BY_MODE, type InteractMode } from '@/game/settings'

/** lite：長按蓄力環，環填滿即放；放開保留部分蓄力、逾時以目前蓄力放招（絕不卡死）。 */
export function HoldChargeRing({ mode, onCharged, timeoutMs = 5000 }: {
  mode: InteractMode
  onCharged: (charge: number) => void
  timeoutMs?: number
}) {
  const ringRef = useRef<HTMLDivElement>(null)
  const holdingRef = useRef(false)
  const accMsRef = useRef(0) // 已累積蓄力 ms（放開保留）
  const lastTsRef = useRef(0)
  const rafRef = useRef(0)
  const doneRef = useRef(false)
  const onChargedRef = useRef(onCharged)
  onChargedRef.current = onCharged

  const finish = (charge: number) => {
    if (doneRef.current) return
    doneRef.current = true
    cancelAnimationFrame(rafRef.current)
    onChargedRef.current(charge)
  }

  useEffect(() => {
    doneRef.current = false
    accMsRef.current = 0
    lastTsRef.current = 0
    const tick = (t: number) => {
      if (holdingRef.current) {
        if (!lastTsRef.current) lastTsRef.current = t
        accMsRef.current += t - lastTsRef.current
        lastTsRef.current = t
        const p = holdCharge(accMsRef.current, mode)
        if (ringRef.current) ringRef.current.style.background = `conic-gradient(#ffd6ff ${p * 360}deg, rgba(255,255,255,0.12) 0)`
        if (p >= 1) { finish(1); return }
      } else {
        lastTsRef.current = 0
      }
      if (!doneRef.current) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    const to = window.setTimeout(() => finish(holdCharge(accMsRef.current, mode)), timeoutMs)
    return () => { cancelAnimationFrame(rafRef.current); window.clearTimeout(to) }
  }, [mode, timeoutMs])

  const down = () => { holdingRef.current = true }
  const up = () => { holdingRef.current = false; lastTsRef.current = 0 }

  return (
    <div
      className="gesture-surface gesture-surface--star"
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      role="button"
      tabIndex={0}
    >
      <div className="star-charge">
        <div ref={ringRef} className="star-charge__ring" />
        <span className="star-charge__star">★</span>
      </div>
      <div className="gesture-hint gesture-hint--star">⭐ 長按蓄力直到滿！</div>
    </div>
  )
}

/** arcade：節奏點擊（太鼓式）。隨脈動點擊 N 拍，準確度只影響演出、不改傷害；逾時安全放招。 */
export function RhythmTap({ mode, onDone }: {
  mode: InteractMode
  onDone: (accuracy: number) => void
}) {
  const ringRef = useRef<HTMLDivElement>(null)
  const tapsRef = useRef<number[]>([])
  const beatsRef = useRef<number[]>([])
  const t0Ref = useRef(0)
  const rafRef = useRef(0)
  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    cancelAnimationFrame(rafRef.current)
    onDoneRef.current(rhythmTaps(tapsRef.current, beatsRef.current, mode))
  }

  useEffect(() => {
    doneRef.current = false
    tapsRef.current = []
    t0Ref.current = 0
    const leadIn = 700
    const tick = (t: number) => {
      if (!t0Ref.current) {
        t0Ref.current = t
        beatsRef.current = beatSchedule(t + leadIn, mode)
      }
      const beats = beatsRef.current
      const last = beats[beats.length - 1]
      // 脈動：取最近一拍的時間距，越近環越大（rAF 直寫 transform，不過 state）
      let nearest = Infinity
      for (const bt of beats) nearest = Math.min(nearest, Math.abs(bt - t))
      const pulse = Math.max(0, 1 - nearest / 280)
      if (ringRef.current) ringRef.current.style.transform = `scale(${1 + pulse * 0.4})`
      if (t > last + 320) { finish(); return } // 末拍判定窗過 → 結算放招
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [mode])

  const tap = (_e: ReactPointerEvent) => {
    if (doneRef.current) return
    // 用 performance.now() 與 rAF 時戳同源，確保節奏判定一致
    tapsRef.current.push(performance.now())
    if (ringRef.current) ringRef.current.style.boxShadow = '0 0 30px 10px rgba(255,122,224,0.9)'
  }

  return (
    <div className="gesture-surface gesture-surface--star" onPointerDown={tap} role="button" tabIndex={0}>
      <div className="star-charge">
        <div ref={ringRef} className="star-charge__ring star-charge__ring--beat" />
        <span className="star-charge__star">★</span>
      </div>
      <div className="gesture-hint gesture-hint--star">🥁 隨脈動點擊 {INTENSITY_BY_MODE.arcade.rhythmBeats} 下！</div>
    </div>
  )
}
