import { useEffect, useRef } from 'react'
import type { WeatherEmitter, WeatherOverlay } from '@/scene/r3f/terrainVisual'

// EXT.3 天氣持續層（plan/EXT.3，圓桌 session-20260630-220524 定案）。
// 與 FxCanvas 同模式（canvas2D、imperative rAF、0..1 正規化、dpr），但職責相反：
//   FxCanvas＝事件型「一次性爆發」（閒置即停）；WeatherCanvas＝狀態型「持續發射」。
// 兩者刻意分檔，不混生命週期。WeatherCanvas 一樣 idle-stop：
//   density<=0 或（emitter='none' 且無 overlay）→ 自己 cancelAnimationFrame、不耗電（同等省電）。
// 配置走 props（terrain/juice 低頻、非高頻值 → 不違反效能紅線）；rAF 迴圈讀 ref，不隨 render 重建。

export interface WeatherCanvasProps {
  emitter: WeatherEmitter
  /** 粒子主色。 */
  color: string
  /** 可選極稀疏點綴色（electric/psychic 電弧點）。 */
  sparkAccent?: string
  /** 靜態 overlay（sunny god-ray）。 */
  overlay?: WeatherOverlay
  /** 0..1 粒子密度（juice：full=1 / reduced≈0.3 / off=0＝整層不掛）。 */
  density: number
  /** z 序：介於 R3F(0) 與 FxCanvas(5) 之間。 */
  zIndex?: number
}

interface WP {
  x: number; y: number; vx: number; vy: number
  size: number; rot: number; vr: number
  life: number; max: number; phase: number; accent: boolean
}

/** 各 emitter 在 full density 下的目標粒子數（×density 後取整）。 */
const BASE_COUNT: Record<WeatherEmitter, number> = {
  rain: 130, snow: 90, sand: 100, ember: 60, electric: 14, 'wind-petal': 44, mist: 16, none: 0,
}

const TWO_PI = Math.PI * 2
const rand = (a: number, b: number) => a + Math.random() * (b - a)

export function WeatherCanvas({ emitter, color, sparkAccent, overlay, density, zIndex = 2 }: WeatherCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cfg = useRef({ emitter, color, sparkAccent, overlay, density })
  cfg.current = { emitter, color, sparkAccent, overlay, density }
  // emitter 切換時清空粒子池（terrainShift 過場），讓新天氣重新長出。
  const prevEmitter = useRef(emitter)
  // 由主 effect 掛上、由 props 變更 effect 呼叫，喚醒可能已 idle-stop 的迴圈。
  const kickRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let w = 0, h = 0
    let pool: WP[] = []
    let raf = 0
    let running = false
    let godrayT = 0

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = rect.width; h = rect.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // 在 p（重複利用、不配置新物件）上以目前 emitter 重新撒一顆（出界回收用：永遠從「上游邊緣」進場）。
    const respawn = (p: WP, em: WeatherEmitter) => {
      p.accent = false
      switch (em) {
        case 'rain':
          p.x = rand(-0.05 * w, w); p.y = rand(-h, 0)
          p.vx = rand(0.6, 1.4); p.vy = rand(9, 15)
          p.size = rand(7, 14); p.life = p.max = 1; p.rot = 0; p.vr = 0; p.phase = 0
          break
        case 'snow':
          p.x = rand(0, w); p.y = rand(-h, 0)
          p.vx = 0; p.vy = rand(0.8, 2.2)
          p.size = rand(1.6, 3.6); p.life = p.max = 1; p.phase = rand(0, TWO_PI); p.rot = 0; p.vr = 0
          break
        case 'sand':
          p.x = rand(-0.1 * w, -2); p.y = rand(0, h)
          p.vx = rand(7, 13); p.vy = rand(-0.6, 0.8)
          p.size = rand(8, 22); p.life = p.max = 1; p.phase = rand(0, TWO_PI); p.rot = 0; p.vr = 0
          break
        case 'ember':
          p.x = rand(0, w); p.y = rand(h * 0.6, h + 10)
          p.vx = rand(-0.5, 0.5); p.vy = rand(-2.6, -1.1)
          p.size = rand(1.4, 3.4); p.max = rand(60, 120); p.life = p.max; p.phase = rand(0, TWO_PI); p.rot = 0; p.vr = 0
          break
        case 'electric':
          p.x = rand(0.1 * w, 0.9 * w); p.y = rand(0.1 * h, 0.7 * h)
          p.vx = 0; p.vy = 0
          p.size = rand(16, 40); p.max = rand(4, 12); p.life = p.max
          p.rot = rand(0, TWO_PI); p.vr = 0; p.phase = rand(0, TWO_PI)
          p.accent = !!cfg.current.sparkAccent && Math.random() < 0.5
          break
        case 'wind-petal':
          p.x = rand(-0.05 * w, w); p.y = rand(-h, 0)
          p.vx = rand(1.2, 2.8); p.vy = rand(1.2, 2.6)
          p.size = rand(4, 8); p.life = p.max = 1
          p.rot = rand(0, TWO_PI); p.vr = rand(-0.08, 0.08); p.phase = rand(0, TWO_PI)
          break
        case 'mist':
          p.x = rand(-0.1 * w, w); p.y = rand(0.15 * h, h)
          p.vx = rand(0.2, 0.7); p.vy = rand(-0.15, 0.15)
          p.size = rand(60, 130); p.life = p.max = 1; p.phase = rand(0, TWO_PI); p.rot = 0; p.vr = 0
          break
        default:
          p.x = p.y = -9999; p.vx = p.vy = 0; p.size = 0; p.life = p.max = 1; p.rot = p.vr = p.phase = 0
      }
    }

    // 新粒子：respawn 後把「主軸位置」散到整個畫面，避免開場螢幕空白（雨/雪要等 1 秒才鋪滿）。
    const mk = (em: WeatherEmitter): WP => {
      const p: WP = { x: 0, y: 0, vx: 0, vy: 0, size: 0, rot: 0, vr: 0, life: 1, max: 1, phase: 0, accent: false }
      respawn(p, em)
      if (em === 'rain' || em === 'snow' || em === 'wind-petal') p.y = rand(-0.2 * h, h)
      else if (em === 'sand') p.x = rand(0, w)
      else if (em === 'ember') { p.y = rand(0, h); p.life = rand(p.max * 0.3, p.max) }
      return p
    }

    const drawGodray = () => {
      godrayT += 0.006
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const beams = 4
      for (let i = 0; i < beams; i++) {
        const cx = w * (0.18 + 0.2 * i) + Math.sin(godrayT + i) * 14
        const grad = ctx.createLinearGradient(cx, 0, cx - h * 0.5, h)
        const a = (0.05 + 0.03 * Math.sin(godrayT * 1.3 + i)) * cfg.current.density
        grad.addColorStop(0, cfg.current.color)
        grad.addColorStop(1, 'transparent')
        ctx.globalAlpha = Math.max(0, a)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(cx - w * 0.06, 0)
        ctx.lineTo(cx + w * 0.06, 0)
        ctx.lineTo(cx - h * 0.5 + w * 0.06, h)
        ctx.lineTo(cx - h * 0.5 - w * 0.06, h)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
      ctx.globalAlpha = 1
    }

    const drawParticle = (p: WP, em: WeatherEmitter, col: string, acc: string) => {
      switch (em) {
        case 'rain':
          ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.4; ctx.lineCap = 'round'
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx, p.y - p.size); ctx.stroke()
          break
        case 'snow':
          ctx.fillStyle = col; ctx.globalAlpha = 0.85
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TWO_PI); ctx.fill()
          break
        case 'sand':
          ctx.strokeStyle = col; ctx.globalAlpha = 0.22; ctx.lineWidth = 1.6; ctx.lineCap = 'round'
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.size, p.y - p.vy * 0.5); ctx.stroke()
          break
        case 'ember': {
          const a = p.life / p.max
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.9
          ctx.fillStyle = col
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, TWO_PI); ctx.fill()
          ctx.restore()
          break
        }
        case 'electric': {
          const a = p.life / p.max
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.9
          ctx.strokeStyle = p.accent ? acc : col; ctx.lineWidth = 2; ctx.lineCap = 'round'
          // 短折線電弧（以 rot 為主軸，一段 zigzag）
          const dx = Math.cos(p.rot) * p.size, dy = Math.sin(p.rot) * p.size
          const mx = p.x + dx * 0.5 + Math.cos(p.rot + 1.6) * p.size * 0.3
          const my = p.y + dy * 0.5 + Math.sin(p.rot + 1.6) * p.size * 0.3
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mx, my); ctx.lineTo(p.x + dx, p.y + dy); ctx.stroke()
          ctx.restore()
          break
        }
        case 'wind-petal':
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot)
          ctx.globalAlpha = 0.85; ctx.fillStyle = col
          // 橢圓花瓣/葉（tumble 用 scaleY 模擬翻面）
          ctx.scale(1, 0.5 + 0.5 * Math.abs(Math.cos(p.phase)))
          ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, TWO_PI); ctx.fill()
          ctx.restore()
          break
        case 'mist':
          ctx.save(); ctx.globalAlpha = 0.06; ctx.fillStyle = col
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.85 + 0.15 * Math.sin(p.phase)), 0, TWO_PI); ctx.fill()
          ctx.restore()
          break
      }
      ctx.globalAlpha = 1
    }

    const tick = () => {
      const c = cfg.current
      const em = c.emitter
      const active = c.density > 0 && (em !== 'none' || !!c.overlay)
      ctx.clearRect(0, 0, w, h)
      if (!active) { running = false; return }

      if (prevEmitter.current !== em) { pool = []; prevEmitter.current = em }
      if (c.overlay === 'godray') drawGodray()

      const target = Math.round(BASE_COUNT[em] * Math.min(1, Math.max(0, c.density)))
      while (pool.length < target) pool.push(mk(em))
      if (pool.length > target) pool.length = target

      const acc = c.sparkAccent ?? c.color
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i]
        p.x += p.vx; p.y += p.vy; p.rot += p.vr
        if (em === 'snow') p.x += Math.sin((p.phase += 0.03)) * 0.6
        if (em === 'wind-petal') { p.phase += 0.06; p.x += Math.sin(p.phase) * 0.5 }
        if (em === 'ember' || em === 'electric') p.life -= 1
        const dead =
          p.life <= 0 ||
          p.y > h + p.size + 4 || p.y < -h - p.size ||
          p.x > w + p.size + 4 || p.x < -p.size - w
        if (dead) { respawn(p, em); continue }
        drawParticle(p, em, c.color, acc)
      }

      raf = requestAnimationFrame(tick)
    }

    const kick = () => {
      const c = cfg.current
      const active = c.density > 0 && (c.emitter !== 'none' || !!c.overlay)
      if (active && !running) { running = true; raf = requestAnimationFrame(tick) }
    }

    const ro = new ResizeObserver(() => { resize(); kick() })
    ro.observe(canvas)
    kickRef.current = kick
    kick()

    return () => { ro.disconnect(); cancelAnimationFrame(raf); running = false; kickRef.current = null }
  }, [])

  // props 變更（terrain 切換、juice 調整）→ 重新喚醒可能已 idle-stop 的迴圈。
  useEffect(() => { kickRef.current?.() }, [emitter, color, sparkAccent, overlay, density])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex }}
    />
  )
}
