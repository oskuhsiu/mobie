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
  shape?: FxShape
}
export interface FxRingOpts { nx: number; ny: number; color: string }
export type FxShape = 'dot' | 'streak' | 'shard'
export const FX_TRAVEL_SPEED = 0.055
export interface FxTravelOpts {
  from: { nx: number; ny: number }
  to: { nx: number; ny: number }
  color: string
  accent?: string
  shape?: FxShape
  count?: number
  power?: number
  onArrive?: 'none' | 'burst' | 'burst-ring'
}
export interface FxHandle {
  burst: (o: FxBurstOpts) => void
  ring: (o: FxRingOpts) => void
  flash: (color: string, alpha?: number) => void
  travel: (o: FxTravelOpts) => void
}

interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; g: number; shape: FxShape; rot: number }
interface Ring { x: number; y: number; r: number; max: number; color: string; life: number }
interface Travel {
  x0: number; y0: number; x1: number; y1: number
  color: string; accent: string; shape: FxShape
  t: number; speed: number; count: number; power: number
  onArrive: 'none' | 'burst' | 'burst-ring'
}

export const FxCanvas = forwardRef<FxHandle>((_props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({
    ctx: null as CanvasRenderingContext2D | null,
    w: 0, h: 0,
    particles: [] as P[],
    rings: [] as Ring[],
    travels: [] as Travel[],
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

    // 飛行彈道（特殊招）：單一 item 自畫 core + trail，抵達後由 enum 觸發撞擊。
    let tj = 0
    for (let i = 0; i < s.travels.length; i++) {
      const tr = s.travels[i]
      tr.t += tr.speed
      const done = tr.t >= 1
      const t = Math.min(1, tr.t)
      const x = tr.x0 + (tr.x1 - tr.x0) * t
      const yLine = tr.y0 + (tr.y1 - tr.y0) * t
      const arc = Math.sin(t * Math.PI) * Math.min(s.w, s.h) * 0.12
      const y = yLine - arc
      const px = tr.x0 + (tr.x1 - tr.x0) * Math.max(0, t - 0.12)
      const py = tr.y0 + (tr.y1 - tr.y0) * Math.max(0, t - 0.12) - Math.sin(Math.max(0, t - 0.12) * Math.PI) * Math.min(s.w, s.h) * 0.12

      ctx.globalAlpha = 0.42 + t * 0.4
      ctx.strokeStyle = tr.accent
      ctx.lineWidth = 5 * tr.power
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.globalAlpha = 1
      drawShape(ctx, x, y, 7 * tr.power, tr.color, tr.shape, t * Math.PI * 3)

      if (done) {
        if (tr.onArrive !== 'none') addBurst(s, tr.x1, tr.y1, tr.color, tr.count, tr.power, 'hit', tr.shape)
        if (tr.onArrive === 'burst-ring') s.rings.push({ x: tr.x1, y: tr.y1, r: 6, max: Math.min(s.w, s.h) * 0.16, color: tr.accent, life: 1 })
      } else {
        s.travels[tj++] = tr
      }
    }
    s.travels.length = tj
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
      drawShape(ctx, p.x, p.y, p.size * (0.4 + a * 0.6), p.color, p.shape, p.rot + p.life * 0.08)
      s.particles[pj++] = p
    }
    s.particles.length = pj
    ctx.globalAlpha = 1

    if (s.particles.length || s.rings.length || s.travels.length || s.flash.a > 0) {
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
    burst: ({ nx, ny, color, count = 16, power = 1, kind = 'hit', shape = 'dot' }) => {
      const s = stateRef.current
      const x = nx * s.w, y = ny * s.h
      addBurst(s, x, y, color, count, power, kind, shape)
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
    travel: ({ from, to, color, accent = color, shape = 'dot', count = 18, power = 1, onArrive = 'burst' }) => {
      const s = stateRef.current
      s.travels.push({
        x0: from.nx * s.w, y0: from.ny * s.h,
        x1: to.nx * s.w, y1: to.ny * s.h,
        color, accent, shape, count, power, onArrive,
        t: 0,
        speed: FX_TRAVEL_SPEED,
      })
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

function addBurst(
  s: { particles: P[] },
  x: number,
  y: number,
  color: string,
  count: number,
  power: number,
  kind: NonNullable<FxBurstOpts['kind']>,
  shape: FxShape,
) {
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
      shape,
      rot: Math.random() * Math.PI * 2,
    })
  }
}

function drawShape(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, shape: FxShape, rot: number) {
  ctx.fillStyle = color
  ctx.strokeStyle = color
  if (shape === 'dot') {
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  if (shape === 'streak') {
    ctx.lineWidth = Math.max(2, size * 0.55)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-size * 1.8, 0)
    ctx.lineTo(size * 1.8, 0)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.moveTo(0, -size * 1.35)
    ctx.lineTo(size * 1.1, size * 0.65)
    ctx.lineTo(0, size * 0.25)
    ctx.lineTo(-size * 1.1, size * 0.65)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}
