// M22.d 星擊手勢 component（plan/22 §2.2, §5.2）。守效能紅線：蓄力寬度/節奏脈動全走 rAF/ref/DOM，
// 絕不進 React 頂層 state；每個 component 只在完成/逾時時 onDone 一次（doneRef 守）。
// **runStarStrike 簽名不動**：手勢只是「儀式」，不改星擊傷害；中斷/逾時皆安全放招（絕不卡死）。
// 不沿用攻擊連打（MashMeter）＝避免肌肉記憶重複（plan/22 §2.2 Q1 codex）。

import { useEffect, useRef } from 'react'
import { holdCharge, beatSchedule, rhythmTaps } from '@/input/gestures'
import { INTENSITY_BY_MODE, type InteractMode } from '@/game/settings'
import { usePausableScheduler } from '@/ui/battle/usePausableScheduler'

/** lite：長按蓄力環，環填滿即放；放開保留部分蓄力、逾時以目前蓄力放招（絕不卡死）。 */
export function HoldChargeRing({ mode, onCharged, timeoutMs = 5000, paused = false }: {
  mode: InteractMode
  onCharged: (charge: number) => void
  timeoutMs?: number
  paused?: boolean
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const holdingRef = useRef(false)
  const keyHeldRef = useRef(false)
  const accMsRef = useRef(0) // 已累積蓄力 ms（放開保留）
  const lastTsRef = useRef(0)
  const rafRef = useRef(0)
  const doneRef = useRef(false)
  const onChargedRef = useRef(onCharged)
  const scheduler = usePausableScheduler(paused)
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
    const to = scheduler.schedule(() => finish(holdCharge(accMsRef.current, mode)), timeoutMs)
    return () => scheduler.cancel(to)
    // finish only reads refs; resetting this input is keyed by mode/timeout, not visibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scheduler, timeoutMs])

  useEffect(() => {
    if (paused || doneRef.current) return
    const tick = () => {
      if (doneRef.current || scheduler.isPaused) return
      const t = scheduler.now()
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
    return () => cancelAnimationFrame(rafRef.current)
    // finish only reads refs; pausing must not reset accumulated charge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, paused, scheduler])

  useEffect(() => {
    surfaceRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!paused) return
    keyHeldRef.current = false
    holdingRef.current = false
    lastTsRef.current = 0
  }, [paused])

  const down = () => {
    if (!doneRef.current && !scheduler.isPaused) holdingRef.current = true
  }
  const up = () => { holdingRef.current = false; lastTsRef.current = 0 }

  return (
    <div
      ref={surfaceRef}
      className="gesture-surface gesture-surface--star"
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      onKeyDown={(event) => {
        if (event.repeat || keyHeldRef.current || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        keyHeldRef.current = true
        down()
      }}
      onKeyUp={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        keyHeldRef.current = false
        up()
      }}
      onBlur={() => {
        keyHeldRef.current = false
        up()
      }}
      role="button"
      tabIndex={0}
      aria-label="星擊蓄力，按住 Enter 或空白鍵蓄力，放開暫停"
      data-battle-input
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
export function RhythmTap({ mode, onDone, paused = false }: {
  mode: InteractMode
  onDone: (accuracy: number) => void
  paused?: boolean
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const tapsRef = useRef<number[]>([])
  const keyHeldRef = useRef(false)
  const beatsRef = useRef<number[]>([])
  const t0Ref = useRef(0)
  const rafRef = useRef(0)
  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone)
  const scheduler = usePausableScheduler(paused)
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
  }, [mode, scheduler])

  useEffect(() => {
    if (paused || doneRef.current) return
    const leadIn = 700
    const tick = () => {
      if (doneRef.current || scheduler.isPaused) return
      const t = scheduler.now()
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
    // finish only reads refs; pausing must preserve taps and beat time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, paused, scheduler])

  useEffect(() => {
    surfaceRef.current?.focus()
  }, [])

  useEffect(() => {
    if (paused) keyHeldRef.current = false
  }, [paused])

  const tap = () => {
    if (doneRef.current || scheduler.isPaused) return
    // 用 performance.now() 與 rAF 時戳同源，確保節奏判定一致
    tapsRef.current.push(scheduler.now())
    if (ringRef.current) ringRef.current.style.boxShadow = '0 0 30px 10px rgba(255,122,224,0.9)'
  }

  return (
    <div
      ref={surfaceRef}
      className="gesture-surface gesture-surface--star"
      onPointerDown={tap}
      onKeyDown={(event) => {
        if (event.repeat || keyHeldRef.current || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        keyHeldRef.current = true
        tap()
      }}
      onKeyUp={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        keyHeldRef.current = false
      }}
      onBlur={() => { keyHeldRef.current = false }}
      role="button"
      tabIndex={0}
      data-battle-input
    >
      <div className="star-charge">
        <div ref={ringRef} className="star-charge__ring star-charge__ring--beat" />
        <span className="star-charge__star">★</span>
      </div>
      <div className="gesture-hint gesture-hint--star">🥁 隨脈動點擊 {INTENSITY_BY_MODE.arcade.rhythmBeats} 下！</div>
    </div>
  )
}
