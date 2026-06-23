import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// imperative canvas2D 粒子層：完全不過 React state（效能紅線）。
// 自有 rAF 迴圈，閒置時停掉；座標用 0..1 正規化，由呼叫端依版面給位置。

export interface FxBurstOpts {
  nx: number
  ny: number
  color: string
  count?: number
  power?: number
  /** hit=四散撞擊 / spark=會心金星 / puff=倒下灰煙 */
  kind?: 'hit' | 'spark' | 'puff'
}
export interface FxRingOpts { nx: number; ny: number; color: string }
export interface FxHandle {
  burst: (o: FxBurstOpts) => void
  ring: (o: FxRingOpts) => void
  flash: (color: string, alpha?: number) => void
}

interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; g: number }
interface Ring { x: number; y: number; r: number; max: number; color: string; life: number }

export const FxCanvas = forwardRef<FxHandle>((_props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({
    ctx: null as CanvasRenderingContext2D | null,
    w: 0, h: 0,
    particles: [] as P[],
    rings: [] as Ring[],
    flash: { color: '#fff', a: 0 },
    raf: 0,
    running: false,
  })

  // 尺寸（含 devicePixelRatio）
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const s = stateRef.current
    s.ctx = ctx
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      s.w = rect.width; s.h = rect.height
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => { ro.disconnect(); cancelAnimationFrame(s.raf) }
  }, [])

  const tick = () => {
    const s = stateRef.current
    const ctx = s.ctx
    if (!ctx) return
    ctx.clearRect(0, 0, s.w, s.h)

    // 螢幕閃光
    if (s.flash.a > 0) {
      ctx.globalAlpha = s.flash.a
      ctx.fillStyle = s.flash.color
      ctx.fillRect(0, 0, s.w, s.h)
      ctx.globalAlpha = 1
      s.flash.a = Math.max(0, s.flash.a - 0.06)
    }

    // 擴張環（原地壓縮，閒置時不配置新陣列）
    let rj = 0
    for (let i = 0; i < s.rings.length; i++) {
      const r = s.rings[i]
      r.life -= 0.045
      if (r.life <= 0) continue
      r.r += (r.max - r.r) * 0.18
      ctx.globalAlpha = r.life * 0.8
      ctx.strokeStyle = r.color
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
      ctx.stroke()
      s.rings[rj++] = r
    }
    s.rings.length = rj
    ctx.globalAlpha = 1

    // 粒子（原地壓縮）
    let pj = 0
    for (let i = 0; i < s.particles.length; i++) {
      const p = s.particles[i]
      p.life -= 1
      if (p.life <= 0) continue
      p.x += p.vx
      p.y += p.vy
      p.vy += p.g
      p.vx *= 0.98
      const a = p.life / p.max
      ctx.globalAlpha = a
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2)
      ctx.fill()
      s.particles[pj++] = p
    }
    s.particles.length = pj
    ctx.globalAlpha = 1

    if (s.particles.length || s.rings.length || s.flash.a > 0) {
      s.raf = requestAnimationFrame(tick)
    } else {
      s.running = false
    }
  }

  const ensureRunning = () => {
    const s = stateRef.current
    if (!s.running) { s.running = true; s.raf = requestAnimationFrame(tick) }
  }

  useImperativeHandle(ref, () => ({
    burst: ({ nx, ny, color, count = 16, power = 1, kind = 'hit' }) => {
      const s = stateRef.current
      const x = nx * s.w, y = ny * s.h
      const n = kind === 'puff' ? Math.round(count * 0.8) : count
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5
        const sp = (kind === 'puff' ? 0.6 : 2.2) * power * (0.5 + Math.random())
        s.particles.push({
          x, y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - (kind === 'puff' ? 1.2 : 0),
          life: kind === 'spark' ? 38 : 30,
          max: kind === 'spark' ? 38 : 30,
          size: kind === 'spark' ? 3.5 : kind === 'puff' ? 5 : 3,
          color,
          g: kind === 'puff' ? -0.02 : 0.12,
        })
      }
      ensureRunning()
    },
    ring: ({ nx, ny, color }) => {
      const s = stateRef.current
      s.rings.push({ x: nx * s.w, y: ny * s.h, r: 6, max: Math.min(s.w, s.h) * 0.2, color, life: 1 })
      ensureRunning()
    },
    flash: (color, alpha = 0.5) => {
      const s = stateRef.current
      s.flash = { color, a: alpha }
      ensureRunning()
    },
  }), [])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}
    />
  )
})
FxCanvas.displayName = 'FxCanvas'
