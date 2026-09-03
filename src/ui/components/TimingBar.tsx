import { useEffect, useRef } from 'react'
import { qualityFromPointer, QTE_ZONES } from '@/input/qte'
import type { QteQuality } from '@/game/battle/engine'
import { usePausableScheduler } from '@/ui/battle/usePausableScheduler'

/**
 * 觸控 timing QTE：指針來回掃動，點擊停下 → 命中品質。
 * 指針位置用 requestAnimationFrame 直接寫 DOM style，不經 React state，
 * 預先養成 M3/M4 的效能紅線習慣（高頻值不過 React render）。
 */
export function TimingBar({
  onResult,
  hint = '點擊任意處，停在正中可造成最大傷害！',
  timeoutMs,
  randomOnTimeout = false,
  paused = false,
}: {
  onResult: (q: QteQuality) => void
  /** 提示語（攻擊/防禦模式不同） */
  hint?: string
  /** 逾時毫秒數；未提供則不自動結算。 */
  timeoutMs?: number
  /** 逾時時改用隨機停點，而不是目前指針位置。 */
  randomOnTimeout?: boolean
  paused?: boolean
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<HTMLDivElement>(null)
  const posRef = useRef(0) // 0..1
  const startRef = useRef<number | null>(null)
  const doneRef = useRef(false)
  const onResultRef = useRef(onResult)
  const scheduler = usePausableScheduler(paused)
  onResultRef.current = onResult

  useEffect(() => {
    doneRef.current = false
    startRef.current = null
    let timeout = 0
    if (timeoutMs && timeoutMs > 0) {
      timeout = scheduler.schedule(() => {
        if (doneRef.current) return
        doneRef.current = true
        const pointer = randomOnTimeout ? Math.random() : posRef.current
        onResultRef.current(qualityFromPointer(pointer))
      }, timeoutMs)
    }
    return () => {
      if (timeout) scheduler.cancel(timeout)
    }
  }, [randomOnTimeout, scheduler, timeoutMs])

  useEffect(() => {
    if (paused || doneRef.current) return
    let raf = 0
    const period = 1100
    const tick = () => {
      if (doneRef.current || scheduler.isPaused) return
      const t = scheduler.now()
      if (startRef.current === null) startRef.current = t
      const phase = ((t - startRef.current) % period) / period
      posRef.current = phase < 0.5 ? phase * 2 : 2 - phase * 2
      if (pointerRef.current) pointerRef.current.style.left = `${posRef.current * 100}%`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [paused, scheduler])

  useEffect(() => {
    surfaceRef.current?.focus()
  }, [])

  const stop = () => {
    if (doneRef.current || scheduler.isPaused) return
    doneRef.current = true
    onResultRef.current(qualityFromPointer(posRef.current))
  }

  // 由外而內畫命中帶（最寬先畫）
  const zones = [...QTE_ZONES].sort((a, b) => b.halfWidth - a.halfWidth)

  // 點擊範圍放大成戰鬥中心一整圈（半透明白 blur 光暈提示），點圈內任意處都算停指針。
  return (
    <div
      ref={surfaceRef}
      className="tap-field tap-field--timing"
      onPointerDown={stop}
      onKeyDown={(event) => {
        if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        stop()
      }}
      role="button"
      tabIndex={0}
      aria-label={hint}
      data-battle-input
    >
      <div className="tap-field__glow" aria-hidden />
      <div className="tap-field__inner qte">
        <div className="qte__hint">{hint}</div>
        <div className="qte__bar">
          {zones.map((z) => (
            <div
              key={z.quality}
              className="qte__zone"
              style={{
                left: `${(0.5 - z.halfWidth) * 100}%`,
                width: `${z.halfWidth * 2 * 100}%`,
                background: z.color,
                opacity: z.quality === 'perfect' ? 0.95 : z.quality === 'good' ? 0.55 : 0.28,
              }}
            />
          ))}
          <div className="qte__center" />
          <div ref={pointerRef} className="qte__pointer" style={{ left: '0%' }} />
        </div>
        {timeoutMs && timeoutMs > 0 && (
          <div className="qte__timeout" aria-hidden>
            <div
              className="qte__timeout-fill"
              style={{ animationDuration: `${timeoutMs}ms`, animationPlayState: paused ? 'paused' : 'running' }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
