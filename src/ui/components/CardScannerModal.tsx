import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { motion } from 'framer-motion'
import jsQR from 'jsqr'
import '@/ui/styles/cardScanner.css'
import { parseCardCode, type CardCodeReason } from '@/game/cardCode'
import { cameraFailureOf, type CameraFailure } from '@/game/scanner'
import { getCard } from '@/game/cardLibrary'
import { getSpecies } from '@/game/data/species'
import { useRoster } from '@/store/rosterStore'
import { audio } from '@/audio/audioEngine'
import type { Card, OwnedUnit, Species } from '@/game/types'
import { ModalSurface } from '@/ui/shell/ModalSurface'

type CameraStatus = 'starting' | 'permission' | 'scanning' | CameraFailure | 'manual'
type ScanResult =
  | { kind: 'success'; card: Card; species: Species }
  | { kind: 'duplicate'; card: Card; species: Species }
  | { kind: 'invalid'; message: string }
type ScannerState = CameraStatus | ScanResult['kind']

const REASON_TEXT: Record<CardCodeReason, string> = {
  format: 'QR 內容格式不符（需 MZ1:卡號:校驗）',
  version: '卡片版本不支援，請使用這個遊戲產生的 QR。',
  crc: '校驗失敗，可能掃歪或反光，請再試一次。',
}

const MAX_DIM = 640 // 解碼前縮圖上限，顧 iPad 幀率
const DECODE_INTERVAL_MS = 80 // 解碼節流 ~12fps（相機預覽仍全速）

const CAMERA_COPY: Record<Exclude<CameraStatus, 'scanning'>, {
  eyebrow: string
  heading: string
  reason: string
  next: string
}> = {
  starting: {
    eyebrow: 'Scanner / Ready',
    heading: '準備掃卡',
    reason: '相機尚未啟動；目前不會要求相機權限。',
    next: '選擇「開啟相機」後，瀏覽器才會顯示權限提示。',
  },
  permission: {
    eyebrow: 'Scanner / Permission',
    heading: '等待相機權限',
    reason: '正在等待瀏覽器回覆相機權限。',
    next: '請在瀏覽器提示中允許相機；也可以改用下方手動輸入。',
  },
  denied: {
    eyebrow: 'Scanner / Manual fallback',
    heading: '相機權限被拒絕',
    reason: '瀏覽器沒有允許這次相機請求，掃卡不會重複提示權限。',
    next: '到瀏覽器的網站權限設定允許相機，或改用手動輸入卡碼。',
  },
  unsupported: {
    eyebrow: 'Scanner / Manual fallback',
    heading: '此裝置不支援相機',
    reason: '找不到可用的相機 API 或鏡頭裝置。',
    next: '改用手動輸入完整卡碼，仍可完成加入流程。',
  },
  manual: {
    eyebrow: 'Scanner / Manual',
    heading: '手動輸入卡碼',
    reason: '手動模式不需要相機權限，卡碼會使用同一套校驗。',
    next: '貼上完整的 MZ1:卡號:校驗，再按「確認卡碼」。',
  },
}

function scannerErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) return `卡片資料暫時無法讀取：${cause.message}`
  return '卡片資料暫時無法讀取，請回到卡庫確認後再試。'
}

/** 掃實體卡 QR → 解析校驗 → 反查卡庫 → 加入我的 Mobie。相機不可用時可手動輸入卡碼。 */
export function CardScannerModal({ onClose, onBackToLibrary, backLabel = '回到卡庫' }: {
  onClose: () => void
  onBackToLibrary?: () => void
  backLabel?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const manualRef = useRef<HTMLInputElement>(null)
  const statePanelRef = useRef<HTMLElement>(null)
  const rafRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const trackCleanupRef = useRef<Array<() => void>>([])
  const sessionRef = useRef(0)
  const resultTokenRef = useRef(0)
  const aliveRef = useRef(false)
  const processingRef = useRef(false)
  const cameraStartingRef = useRef(false)
  const cameraBlockedRef = useRef(false)
  const decodeRef = useRef(false)
  const [status, setStatus] = useState<CameraStatus>('starting')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [manual, setManual] = useState('')
  const [processing, setProcessing] = useState(false)

  const clearTrackListeners = useCallback(() => {
    trackCleanupRef.current.forEach((cleanup) => cleanup())
    trackCleanupRef.current = []
  }, [])

  const stopCamera = useCallback(() => {
    // Bump the token before stopping tracks so a late getUserMedia resolution or
    // decode callback cannot publish into a remounted route.
    sessionRef.current += 1
    decodeRef.current = false
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    clearTrackListeners()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }
  }, [clearTrackListeners])

  const handleRaw = useCallback(async (raw: string) => {
    if (!aliveRef.current || processingRef.current) return
    processingRef.current = true
    setProcessing(true)
    const token = ++resultTokenRef.current
    // A QR hit is one transaction. Stop the preview before any asynchronous
    // card lookup so repeated frames cannot enqueue another capture.
    stopCamera()
    try {
      const parsed = parseCardCode(raw)
      if (!parsed.valid) {
        if (!aliveRef.current || token !== resultTokenRef.current) return
        setResult({ kind: 'invalid', message: parsed.reason ? REASON_TEXT[parsed.reason] : '無法辨識這段卡碼。' })
        audio.play('select')
        return
      }

      let card: Card | null
      try {
        card = await getCard(parsed.cardId)
      } catch (cause) {
        if (aliveRef.current && token === resultTokenRef.current) {
          setResult({ kind: 'invalid', message: scannerErrorMessage(cause) })
          audio.play('select')
        }
        return
      }
      if (!card) {
        if (!aliveRef.current || token !== resultTokenRef.current) return
        setResult({ kind: 'invalid', message: `查無此卡（${parsed.cardId}）。請回到卡庫建立或匯入後再掃。` })
        audio.play('select')
        return
      }
      // Check the route/lifecycle fence again immediately before the canonical
      // roster mutation. A result arriving after close/back cannot write.
      if (!aliveRef.current || token !== resultTokenRef.current) return
      let unit: OwnedUnit | null
      try {
        unit = await useRoster.getState().captureUnit(card)
      } catch (cause) {
        if (aliveRef.current && token === resultTokenRef.current) {
          setResult({ kind: 'invalid', message: scannerErrorMessage(cause) })
          audio.play('select')
        }
        return
      }
      if (!aliveRef.current || token !== resultTokenRef.current) return
      const species = getSpecies(card.speciesId)
      if (unit) {
        setResult({ kind: 'success', card, species })
        audio.play('capture')
      } else {
        setResult({ kind: 'duplicate', card, species })
        audio.play('select')
      }
    } finally {
      if (aliveRef.current && token === resultTokenRef.current) {
        processingRef.current = false
        setProcessing(false)
      }
    }
  }, [stopCamera])

  const startDecodeLoop = useCallback((token: number) => {
    let lastDecode = 0
    let ctx: CanvasRenderingContext2D | null = null
    const tick = (now: number) => {
      if (!aliveRef.current || sessionRef.current !== token || !decodeRef.current) return
      rafRef.current = requestAnimationFrame(tick)
      if (now - lastDecode < DECODE_INTERVAL_MS) return
      lastDecode = now
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return
      const scale = Math.min(1, MAX_DIM / Math.max(video.videoWidth, video.videoHeight))
      const width = Math.round(video.videoWidth * scale)
      const height = Math.round(video.videoHeight * scale)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ctx ??= canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(video, 0, 0, width, height)
      const image = ctx.getImageData(0, 0, width, height)
      const code = jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' })
      if (code?.data) {
        decodeRef.current = false
        void handleRaw(code.data)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [handleRaw])

  const startCamera = useCallback(async () => {
    if (!aliveRef.current || processingRef.current || cameraStartingRef.current || cameraBlockedRef.current) return
    cameraStartingRef.current = true
    resultTokenRef.current += 1
    setResult(null)
    setStatus('permission')
    const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!devices || typeof devices.getUserMedia !== 'function') {
      cameraBlockedRef.current = true
      cameraStartingRef.current = false
      setStatus('unsupported')
      return
    }

    const token = sessionRef.current + 1
    sessionRef.current = token
    try {
      const stream = await devices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      if (!aliveRef.current || sessionRef.current !== token) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (!video) {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        cameraBlockedRef.current = true
        setStatus('unsupported')
        return
      }
      video.srcObject = stream
      // Do not block the capability state on media playback readiness. Safari
      // can leave `play()` pending until the first frame; the decode loop is
      // already guarded by readyState and will begin when frames arrive.
      void video.play().catch(() => undefined)
      if (!aliveRef.current || sessionRef.current !== token) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const onEnded = () => {
        if (!aliveRef.current || sessionRef.current !== token) return
        cameraBlockedRef.current = true
        stopCamera()
        setStatus('unsupported')
      }
      stream.getTracks().forEach((track) => {
        track.addEventListener('ended', onEnded)
        trackCleanupRef.current.push(() => track.removeEventListener('ended', onEnded))
      })
      decodeRef.current = true
      setStatus('scanning')
      startDecodeLoop(token)
    } catch (cause) {
      if (!aliveRef.current || sessionRef.current !== token) return
      cameraBlockedRef.current = true
      stopCamera()
      setStatus(cameraFailureOf(cause))
    } finally {
      cameraStartingRef.current = false
    }
  }, [startDecodeLoop, stopCamera])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      resultTokenRef.current += 1
      stopCamera()
    }
  }, [stopCamera])

  const enterManual = useCallback(() => {
    if (processingRef.current) return
    resultTokenRef.current += 1
    setResult(null)
    stopCamera()
    setStatus('manual')
    requestAnimationFrame(() => manualRef.current?.focus())
  }, [stopCamera])

  const rescan = useCallback(() => {
    if (processingRef.current) return
    resultTokenRef.current += 1
    setResult(null)
    setStatus(cameraBlockedRef.current ? 'manual' : 'starting')
    if (cameraBlockedRef.current) requestAnimationFrame(() => manualRef.current?.focus())
  }, [])

  const submitManual = useCallback(() => {
    const raw = manual.trim()
    if (!raw || processingRef.current) return
    void handleRaw(raw)
  }, [handleRaw, manual])

  const flowState: ScannerState = result?.kind ?? status
  useEffect(() => {
    if (flowState === 'scanning') return
    const focus = () => {
      if (flowState === 'manual') manualRef.current?.focus()
      else statePanelRef.current?.focus()
    }
    const frame = requestAnimationFrame(focus)
    const timer = window.setTimeout(focus, 180)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [flowState])

  const statePanel = !result && status !== 'scanning' ? (
    <ScannerStatePanel
      status={status}
      panelRef={statePanelRef}
      onOpenCamera={() => void startCamera()}
      onManual={enterManual}
    />
  ) : null

  return (
    <ModalSurface
      title="📷 掃卡"
      description="相機只在你明確選擇開啟後請求權限；沒有相機也能手動輸入卡碼。"
      onClose={onClose}
      className="scanner-surface"
      footer={(
        <div className="scan-footer">
          <span>卡碼只會加入一次；重複掃描不會覆寫或重複發放。</span>
          <button className="btn btn--ghost btn--sm" data-scan-back onClick={onBackToLibrary ?? onClose}>{backLabel}</button>
        </div>
      )}
    >
      <div className="scanner-flow" data-scanner data-scanner-state={flowState}>
        {statePanel}

        {/* Keep one media element mounted between explicit camera actions so a
            resolved stream cannot race a route/state remount. It is invisible
            until scanning is active and never requests a permission itself. */}
        <div
          className={`scan-view ${status === 'scanning' && !result ? 'scan-view--active' : 'scan-view--preload'}`}
          data-scan-camera-view
          data-scan-camera-active={status === 'scanning' && !result ? 'true' : 'false'}
          aria-hidden={status !== 'scanning' || Boolean(result)}
        >
          <video ref={videoRef} className="scan-view__video" playsInline muted />
          <canvas ref={canvasRef} className="scan-view__canvas" />
          {status === 'scanning' && !result && <div className="scan-view__reticle" aria-hidden="true" />}
          {status === 'scanning' && !result && <div className="scan-view__msg" role="status">相機已啟動，將 QR 對準框線。</div>}
        </div>

        {result && <ScanResultPanel result={result} onRescan={rescan} onManual={enterManual} panelRef={statePanelRef} />}

        <div className={`scan-manual ${status === 'manual' || result ? 'scan-manual--primary' : ''}`} data-scan-manual-panel>
          <label className="scan-manual__label" htmlFor="card-scanner-manual">手動輸入 QR 卡碼</label>
          <div className="scan-manual__controls">
            <input
              ref={manualRef}
              id="card-scanner-manual"
              className="utility-search"
              placeholder="MZ1:卡號:校驗"
              value={manual}
              aria-label="手動輸入 QR 卡碼"
              data-scan-manual-input
              onChange={(event) => setManual(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') submitManual() }}
              disabled={processing}
            />
            <button className="btn btn--sm" data-scan-submit onClick={submitManual} disabled={processing || !manual.trim()}>
              {processing ? '檢查中…' : '確認卡碼'}
            </button>
          </div>
        </div>
      </div>
    </ModalSurface>
  )
}

function ScannerStatePanel({ status, panelRef, onOpenCamera, onManual }: {
  status: Exclude<CameraStatus, 'scanning'>
  panelRef: RefObject<HTMLElement>
  onOpenCamera: () => void
  onManual: () => void
}) {
  const copy = CAMERA_COPY[status]
  const fallback = status === 'denied' || status === 'unsupported' || status === 'manual'
  const headingId = `scanner-state-heading-${status}`
  return (
    <section
      ref={panelRef}
      className={`scan-state scan-state--${status} ${fallback ? 'scan-nocam' : ''}`}
      data-scan-state-panel={status}
      aria-labelledby={headingId}
      role={status === 'permission' ? 'status' : undefined}
      tabIndex={-1}
    >
      <div className="scan-state__icon" aria-hidden="true">{status === 'starting' ? '📷' : status === 'permission' ? '⏳' : status === 'manual' ? '⌨️' : '⚠️'}</div>
      <div className="eyebrow">{copy.eyebrow}</div>
      <h3 id={headingId}>{copy.heading}</h3>
      <p className="scan-state__reason"><strong>原因：</strong>{copy.reason}</p>
      <p className="scan-state__next"><strong>下一步：</strong>{copy.next}</p>
      <div className="scan-state__actions">
        {status === 'starting' && <button className="btn btn--sm" data-scan-camera onClick={onOpenCamera}>開啟相機</button>}
        {status !== 'manual' && <button className="btn btn--ghost btn--sm" data-scan-manual onClick={onManual}>改用手動輸入</button>}
      </div>
    </section>
  )
}

function ScanResultPanel({ result, onRescan, onManual, panelRef }: {
  result: ScanResult
  onRescan: () => void
  onManual: () => void
  panelRef: RefObject<HTMLElement>
}) {
  const success = result.kind === 'success'
  const duplicate = result.kind === 'duplicate'
  const card = success || duplicate ? result.card : null
  const species = success || duplicate ? result.species : null
  const heading = success ? '掃卡成功，已加入我的 Mobie' : duplicate ? '這張卡已經在我的 Mobie' : '無法辨識這張卡碼'
  const headingId = `scanner-result-heading-${result.kind}`
  const reason = success
    ? '卡碼有效，這次掃描已建立一筆 canonical Mobie。'
    : duplicate
      ? '相同 card ID 已存在，這次沒有重複發放、覆寫或修改。'
      : '卡碼格式、版本、校驗或卡庫資料沒有通過檢查。'
  const next = success || duplicate
    ? '可以回到卡庫查看，也可以再掃一張。'
    : '檢查卡碼後再試，或回到卡庫建立／匯入這張卡。'
  return (
    <motion.section
      ref={panelRef}
      className={`scan-result scan-result--${result.kind}`}
      data-scan-result={result.kind}
      data-scan-card-id={card?.cardId}
      aria-labelledby={headingId}
      role={result.kind === 'invalid' ? 'alert' : 'status'}
      tabIndex={-1}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="scan-state__icon" aria-hidden="true">{success ? '✅' : duplicate ? '↩️' : '⚠️'}</div>
      <div className="eyebrow">{success ? 'Scanner / Success' : duplicate ? 'Scanner / Duplicate' : 'Scanner / Invalid'}</div>
      <h3 id={headingId}>{heading}</h3>
      <p className="scan-state__reason"><strong>原因：</strong>{reason}</p>
      <p className="scan-state__next"><strong>下一步：</strong>{next}</p>
      {card && species && (
        <div className="scan-result__card" data-scan-card-summary>
          <img className="scan-result__art" src={species.artworkUrl} alt={species.nameZh} />
          <strong>{species.nameZh} Lv.{card.level}</strong>
          <span>卡片 ID：#{card.cardId}</span>
        </div>
      )}
      {result.kind === 'invalid' && <p className="scan-result__message">{result.message}</p>}
      <div className="scan-state__actions">
        <button className="btn btn--sm" data-scan-rescan onClick={onRescan}>{success || duplicate ? '再掃一張' : '重新檢查'}</button>
        <button className="btn btn--ghost btn--sm" data-scan-result-manual onClick={onManual}>手動輸入</button>
      </div>
    </motion.section>
  )
}
