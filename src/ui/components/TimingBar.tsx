import { useEffect, useRef } from 'react'
import { qualityFromPointer, QTE_ZONES } from '@/input/qte'
import type { QteQuality } from '@/game/battle/engine'

/**
 * 觸控 timing QTE：指針來回掃動，點擊停下 → 命中品質。
 * 指針位置用 requestAnimationFrame 直接寫 DOM style，不經 React state，
 * 預先養成 M3/M4 的效能紅線習慣（高頻值不過 React render）。
 */
export function TimingBar({ onResult }: { onResult: (q: QteQuality) => void }) {
  const pointerRef = useRef<HTMLDivElement>(null)
  const posRef = useRef(0) // 0..1
  const doneRef = useRef(false)

  useEffect(() => {
    doneRef.current = false
    let raf = 0
    let start = 0
    const period = 1100 // ms 來回一趟

    const tick = (t: number) => {
      if (!start) start = t
      const phase = ((t - start) % period) / period // 0..1
      // 三角波：0→1→0
      posRef.current = phase < 0.5 ? phase * 2 : 2 - phase * 2
      if (pointerRef.current) {
        pointerRef.current.style.left = `${posRef.current * 100}%`
      }
      if (!doneRef.current) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const stop = () => {
    if (doneRef.current) return
    doneRef.current = true
    onResult(qualityFromPointer(posRef.current))
  }

  // 由外而內畫命中帶（最寬先畫）
  const zones = [...QTE_ZONES].sort((a, b) => b.halfWidth - a.halfWidth)

  return (
    <div className="qte" onPointerDown={stop} role="button" tabIndex={0}>
      <div className="qte__hint">點擊任意處，停在正中可造成最大傷害！</div>
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
    </div>
  )
}
