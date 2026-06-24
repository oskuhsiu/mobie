import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import jsQR from 'jsqr'
import { parseCardCode, type CardCodeReason } from '@/game/cardCode'
import { getCard } from '@/game/cardLibrary'
import { getSpecies } from '@/game/data/species'
import { useRoster } from '@/store/rosterStore'
import { audio } from '@/audio/audioEngine'
import type { Card, Species } from '@/game/types'

type CamStatus = 'starting' | 'scanning' | 'denied' | 'unsupported'

type ScanResult =
  | { kind: 'success'; card: Card; species: Species; added: boolean }
  | { kind: 'error'; message: string }

const REASON_TEXT: Record<CardCodeReason, string> = {
  format: 'QR 內容格式不符（需 MZ1:卡號:校驗）',
  version: '卡片版本不支援',
  crc: '校驗失敗，可能掃歪或反光，請再試一次',
}

const MAX_DIM = 640 // 解碼前縮圖上限，顧 iPad 幀率
const DECODE_INTERVAL_MS = 80 // 解碼節流 ~12fps（相機預覽仍全速）

/** 掃實體卡 QR → 解析校驗 → 反查卡庫 → 加入我的Mobie。相機不可用時可手動輸入卡碼。 */
export function CardScannerModal({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const decodeRef = useRef(true) // 命中或顯示結果時暫停解碼（高頻 gate 走 ref）
  const [status, setStatus] = useState<CamStatus>('starting')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [manual, setManual] = useState('')

  // 處理一段解出的原始字串（相機或手動共用）
  const handleRaw = useCallback(async (raw: string) => {
    const parsed = parseCardCode(raw)
    if (!parsed.valid) {
      setResult({ kind: 'error', message: parsed.reason ? REASON_TEXT[parsed.reason] : '無法辨識' })
      audio.play('select')
      return
    }
    const card = await getCard(parsed.cardId)
    if (!card) {
      setResult({ kind: 'error', message: `查無此卡（${parsed.cardId}）。可到「卡庫」匯入或新增。` })
      audio.play('select')
      return
    }
    const unit = await useRoster.getState().captureUnit(card)
    setResult({ kind: 'success', card, species: getSpecies(card.speciesId), added: unit !== null })
    audio.play(unit ? 'capture' : 'select')
  }, [])

  // 相機掃描迴圈：抓幀 → 縮圖 → jsQR。全程走 ref/rAF，不過 React 頂層 state。
  // 解碼節流到 ~12fps（getImageData+jsQR 是重活）；context 與畫布尺寸只在需要時取/改。
  useEffect(() => {
    let alive = true
    let lastDecode = 0
    let ctx: CanvasRenderingContext2D | null = null
    const tick = (now: number) => {
      if (!alive) return
      rafRef.current = requestAnimationFrame(tick)
      if (!decodeRef.current || now - lastDecode < DECODE_INTERVAL_MS) return
      lastDecode = now
      const v = videoRef.current
      const c = canvasRef.current
      if (!v || !c || v.readyState < 2 || !v.videoWidth) return
      const scale = Math.min(1, MAX_DIM / Math.max(v.videoWidth, v.videoHeight))
      const w = Math.round(v.videoWidth * scale)
      const h = Math.round(v.videoHeight * scale)
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
      ctx ??= c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(v, 0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
      if (code && code.data) {
        decodeRef.current = false
        void handleRaw(code.data)
      }
    }
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => undefined)
        }
        setStatus('scanning')
        rafRef.current = requestAnimationFrame(tick)
      } catch {
        if (alive) setStatus('denied')
      }
    })()
    return () => {
      alive = false
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [handleRaw])

  const rescan = () => {
    setResult(null)
    decodeRef.current = true
  }

  const submitManual = () => {
    if (!manual.trim()) return
    decodeRef.current = false
    void handleRaw(manual.trim())
  }

  // 相機是否可能在運作（決定顯示大相機框或縮成提示＋手動輸入）
  const camLive = status === 'starting' || status === 'scanning'

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-card__head">
          <div>
            <div className="h-title" style={{ fontSize: 24 }}>📷 掃卡</div>
            <div className="h-sub">把實體卡的 QR 對準相機；掃到就加入「我的Mobie」。</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        {/* 掃描結果（相機框內覆蓋 / 無相機時 inline，兩種模式共用） */}
        {(() => {
          const resultEl = result && (
            <motion.div
              className={`scan-result scan-result--${result.kind} ${camLive ? '' : 'scan-result--inline'}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {result.kind === 'success' ? (
                <>
                  <img className="scan-result__art" src={result.species.artworkUrl} alt={result.species.nameZh} />
                  <div className="scan-result__title">{result.species.nameZh} Lv.{result.card.level}</div>
                  <div className="scan-result__sub">{result.added ? '已加入我的Mobie！' : '你已經擁有這張卡了'}</div>
                </>
              ) : (
                <>
                  <div className="scan-result__title scan-result__title--err">⚠ 掃描失敗</div>
                  <div className="scan-result__sub">{result.message}</div>
                </>
              )}
              <button className="btn btn--sm" onClick={rescan}>再掃一張</button>
            </motion.div>
          )
          return camLive ? (
            <div className="scan-view">
              <video ref={videoRef} className="scan-view__video" playsInline muted />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {status === 'scanning' && !result && <div className="scan-view__reticle" />}
              {status === 'starting' && <div className="scan-view__msg">啟動相機中…</div>}
              {resultEl}
            </div>
          ) : (
            // 相機被拒/不支援：不留大黑框，提示＋手動輸入收成同一焦點
            <div className="scan-nocam">
              <div className="scan-nocam__icon">⌨️</div>
              <div className="scan-nocam__msg">
                {status === 'denied' ? '相機無法使用（權限被拒或無相機）。' : '此瀏覽器不支援相機。'}
                <br />請在下方手動輸入卡碼。
              </div>
              {resultEl}
            </div>
          )
        })()}

        {/* 手動輸入（相機不可用時為主要操作，永遠可用） */}
        <div className={`scan-manual ${camLive ? '' : 'scan-manual--primary'}`}>
          <input
            className="model-search"
            placeholder="手動輸入卡碼：MZ1:卡號:校驗"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitManual() }}
          />
          <button className="btn btn--sm" onClick={submitManual} disabled={!manual.trim()}>確認</button>
        </div>
      </motion.div>
    </motion.div>
  )
}
