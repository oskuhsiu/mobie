import { useCallback, useEffect, useRef, useState } from 'react'
import { audio } from '@/audio/audioEngine'
import {
  deleteReplay,
  getReplay,
  listReplayMetas,
  replayStorageAvailable,
  subscribeReplays,
  type ReplayRecordMeta,
  ReplayStorageError,
} from '@/game/replay/replayDb'
import { decodeReplay } from '@/game/replay/codec'
import { formatReplayDuration, summarizeReplay, type ReplaySummary } from '@/game/replay/summary'
import type { ReplayLog, DisplayUnitSnapshot } from '@/game/replay/types'
import { logToReport } from '@/game/replay/report'
import { getSpecies } from '@/game/data/species'
import { lookupRegion } from '@/game/data/regionLookup'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { ReplayPlayerModal } from '@/ui/components/ReplayPlayerModal'
import { ModalSurface } from '@/ui/shell/ModalSurface'
import { useOverlayController } from '@/ui/shell/OverlayController'

type ReplayRowState = 'ready' | 'empty' | 'decode-error' | 'missing' | 'storage-error'
type ReplayListState = 'loading' | 'empty' | 'ready' | 'partial' | 'error'
type Notice = { tone: 'status' | 'error'; text: string }

interface ReplayRow {
  meta: ReplayRecordMeta
  log: ReplayLog | null
  summary: ReplaySummary | null
  state: ReplayRowState
  error?: string
}

// A pushed confirmation unmounts the list surface. Keep one short-lived
// announcement so the returned list can report a completed delete.
let pendingReplayNotice: Notice | null = null
let pendingReplayFocus: { battleId: string; action: 'play' | 'delete' } | null = null

function errorText(cause: unknown, fallback: string): string {
  if (cause instanceof ReplayStorageError) return cause.message
  if (cause instanceof Error && cause.message) return `${fallback}：${cause.message}`
  return fallback
}

function formatCreatedAt(ms: number): { text: string; dateTime?: string } {
  if (!Number.isFinite(ms) || ms <= 0) return { text: '時間未記錄（舊回放）' }
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return { text: '時間未記錄（舊回放）' }
  return {
    text: new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date),
    dateTime: date.toISOString(),
  }
}

function regionLabel(regionId: string): string {
  try {
    const region = lookupRegion(regionId)
    return `${region.icon} ${region.name}`
  } catch {
    return regionId ? `區域 ${regionId}` : '未記錄區域'
  }
}

function snapshotFor(row: ReplayRow): DisplayUnitSnapshot[] {
  return row.log?.header.snapshot ?? []
}

function safeSpecies(speciesId: number) {
  try { return getSpecies(speciesId) } catch { return null }
}

function updateRow(rows: ReplayRow[], battleId: string, next: Partial<ReplayRow>): ReplayRow[] {
  return rows.map((row) => row.meta.battleId === battleId ? { ...row, ...next } : row)
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function normalizeMeta(raw: ReplayRecordMeta, index: number): ReplayRecordMeta {
  const value = raw as unknown as Record<string, unknown>
  const battleId = typeof value.battleId === 'string' && value.battleId.length > 0 ? value.battleId : `unknown-${index}`
  const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : 0
  return {
    battleId,
    createdAt,
    regionId: typeof value.regionId === 'string' ? value.regionId : '',
    mode: value.mode === 'wild' ? 'wild' : 'arena',
    outcome: value.outcome === 'win' ? 'win' : 'lose',
    players: textList(value.players),
    foes: textList(value.foes),
    ...(typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0 ? { durationMs: value.durationMs } : {}),
    ...(typeof value.turnCount === 'number' && Number.isInteger(value.turnCount) && value.turnCount >= 0 ? { turnCount: value.turnCount } : {}),
    ...(typeof value.eventCount === 'number' && Number.isInteger(value.eventCount) && value.eventCount >= 0 ? { eventCount: value.eventCount } : {}),
  }
}

async function loadReplayRows(): Promise<ReplayRow[]> {
  if (!replayStorageAvailable()) {
    throw new ReplayStorageError('unavailable', '此瀏覽器沒有可用的回放儲存空間。請改用支援 IndexedDB 的瀏覽器。')
  }
  const metas = await listReplayMetas()
  return Promise.all(metas.map(async (rawMeta, index): Promise<ReplayRow> => {
    const meta = normalizeMeta(rawMeta, index)
    try {
      const record = await getReplay(meta.battleId)
      if (!record) {
        return { meta, log: null, summary: null, state: 'missing', error: '找不到完整回放資料，可能已被瀏覽器清除。' }
      }
      const decoded = decodeReplay(record.json)
      if (!decoded.ok) {
        return { meta, log: null, summary: null, state: 'decode-error', error: decoded.message }
      }
      const summary = summarizeReplay(decoded.log)
      if (summary.eventCount === 0) {
        return { meta, log: decoded.log, summary, state: 'empty', error: '這筆回放沒有可播放事件。' }
      }
      return { meta, log: decoded.log, summary, state: 'ready' }
    } catch (cause) {
      return { meta, log: null, summary: null, state: 'storage-error', error: errorText(cause, '這筆回放暫時無法讀取') }
    }
  }))
}

type ReplayDelivery =
  | { method: 'shared' }
  | { method: 'downloaded'; recoveryText: string }
  | { method: 'copied' }
  | { method: 'manual'; recoveryText: string }
  | { method: 'cancelled' }

/** Share first, then download, with honest clipboard/manual fallbacks. */
async function shareOrDownloadText(filename: string, text: string): Promise<ReplayDelivery> {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (typeof navigator.share === 'function') {
    const file = new File([blob], filename, { type: 'text/plain' })
    let shareable = !nav.canShare
    try {
      shareable = shareable || nav.canShare?.({ files: [file] }) === true
    } catch {
      shareable = false
    }
    if (shareable) {
      try {
        // Headless/embedded browsers can expose navigator.share but leave its
        // promise pending forever. Bound that capability probe so download and
        // clipboard fallbacks remain reachable.
        const result = await Promise.race([
          Promise.resolve(navigator.share({ files: [file], title: filename })).then(
            () => ({ status: 'shared' as const }),
            (cause: unknown) => ({ status: 'failed' as const, cause }),
          ),
          new Promise<{ status: 'timeout' }>((resolve) => window.setTimeout(() => resolve({ status: 'timeout' }), 1500)),
        ])
        if (result.status === 'shared') return { method: 'shared' }
        if (result.status === 'failed' && (result.cause as Error)?.name === 'AbortError') return { method: 'cancelled' }
      } catch {
        // Continue to download when constructing or invoking the share sheet fails.
      }
    }
  }

  try {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    return { method: 'downloaded', recoveryText: text }
  } catch {
    // A browser can accept anchor.click() while blocking the actual save; the
    // success message therefore only says that the download was started.
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return { method: 'copied' }
    }
  } catch {
    // Continue to a selectable copy for browsers without clipboard permission.
  }
  return { method: 'manual', recoveryText: text }
}

function focusReplayAction(attribute: 'data-replay-play' | 'data-replay-delete', battleId: string): HTMLElement | null {
  const candidates = [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)]
  return candidates.find((element) => element.getAttribute(attribute) === battleId) ?? null
}

function focusReplayFallback(pending: { battleId: string; action: 'play' | 'delete' }): HTMLElement | null {
  const exact = focusReplayAction(`data-replay-${pending.action}`, pending.battleId)
  return exact
    ?? document.querySelector<HTMLElement>(`[data-replay-${pending.action}]`)
    ?? document.querySelector<HTMLElement>('[data-replay-refresh]')
}

function restoreReplayFocus(attribute: 'data-replay-play' | 'data-replay-delete', battleId: string): HTMLElement | null {
  // The parent list is async after a nested overlay closes. Let its post-load
  // effect resolve the target instead of focusing a stale row during the pop.
  if (pendingReplayFocus) return null
  return focusReplayAction(attribute, battleId)
}

export function ReplayListModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ReplayRow[]>([])
  const [state, setState] = useState<ReplayListState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(() => pendingReplayNotice)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [manualReport, setManualReport] = useState<{ filename: string; text: string } | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const aliveRef = useRef(true)
  const controller = useOverlayController()
  const loadTokenRef = useRef(0)

  useEffect(() => {
    pendingReplayNotice = null
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const announce = useCallback((next: Notice) => {
    setNotice(next)
  }, [])

  useEffect(() => {
    if (!notice) return
    // Status messages are announced through aria-live. Keep keyboard focus on
    // the row action after a nested play/delete overlay returns.
    if (notice.tone === 'status') return
    const focus = () => noticeRef.current?.focus()
    const frame = requestAnimationFrame(focus)
    const timers = [120, 320, 700].map((delay) => window.setTimeout(focus, delay))
    return () => {
      cancelAnimationFrame(frame)
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [notice])

  // OverlayController restores focus immediately after a pop, while the
  // remounted list still has to read IndexedDB. Retry after that async read so
  // the exact row (or the nearest surviving action after delete) receives it.
  useEffect(() => {
    if (state === 'loading' || !pendingReplayFocus) return
    const pending = pendingReplayFocus
    const focus = () => {
      const element = focusReplayFallback(pending)
      if (!element) return
      element.focus()
      pendingReplayFocus = null
    }
    const frame = requestAnimationFrame(focus)
    const timers = [80, 220, 500, 900, 1400].map((delay) => window.setTimeout(focus, delay))
    return () => {
      cancelAnimationFrame(frame)
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [rows, state])

  const load = useCallback(async (showLoading: boolean) => {
    const token = ++loadTokenRef.current
    if (showLoading) setState('loading')
    setLoadError(null)
    try {
      const next = await loadReplayRows()
      if (!aliveRef.current || token !== loadTokenRef.current) return
      setRows(next)
      setState(next.length === 0 ? 'empty' : next.some((row) => row.state !== 'ready') ? 'partial' : 'ready')
    } catch (cause) {
      if (!aliveRef.current || token !== loadTokenRef.current) return
      setRows([])
      setLoadError(errorText(cause, '回放資料暫時無法載入'))
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load(true)
    return subscribeReplays(() => { void load(false) })
  }, [load])

  const open = async (row: ReplayRow) => {
    if (busyAction || row.state !== 'ready' || !row.log) return
    setBusyAction(`play:${row.meta.battleId}`)
    setNotice(null)
    try {
      // Re-read on action so a stale list cannot open deleted/corrupt content.
      const record = await getReplay(row.meta.battleId)
      if (!aliveRef.current) return
      if (!record) {
        setRows((current) => updateRow(current, row.meta.battleId, { state: 'missing', log: null, summary: null, error: '找不到完整回放資料，可能已被瀏覽器清除。' }))
        announce({ tone: 'error', text: '找不到這筆回放，請重新整理清單。' })
        return
      }
      const decoded = decodeReplay(record.json)
      if (!aliveRef.current) return
      if (!decoded.ok) {
        setRows((current) => updateRow(current, row.meta.battleId, { state: 'decode-error', log: null, summary: null, error: decoded.message }))
        announce({ tone: 'error', text: `回放無法播放：${decoded.message}` })
        return
      }
      if (!aliveRef.current) return
      audio.play('select')
      controller.push({
        id: `replay:${row.meta.battleId}`,
        policy: 'escape-and-backdrop',
        content: <ReplayPlayerModal log={decoded.log} onClose={() => { pendingReplayFocus = { battleId: row.meta.battleId, action: 'play' }; controller.pop() }} portal />,
      }, { restoreFocus: () => restoreReplayFocus('data-replay-play', row.meta.battleId) })
    } catch (cause) {
      announce({ tone: 'error', text: errorText(cause, '回放暫時無法播放') })
    } finally {
      if (aliveRef.current) setBusyAction(null)
    }
  }

  const exportTxt = async (row: ReplayRow) => {
    if (busyAction || row.state !== 'ready') return
    setBusyAction(`export:${row.meta.battleId}`)
    setNotice(null)
    try {
      const record = await getReplay(row.meta.battleId)
      if (!aliveRef.current) return
      if (!record) {
        announce({ tone: 'error', text: '找不到這筆回放，無法匯出。請重新整理清單。' })
        return
      }
      const decoded = decodeReplay(record.json)
      if (!aliveRef.current) return
      if (!decoded.ok) {
        setRows((current) => updateRow(current, row.meta.battleId, { state: 'decode-error', log: null, summary: null, error: decoded.message }))
        announce({ tone: 'error', text: `戰報無法匯出：${decoded.message}` })
        return
      }
      const created = formatCreatedAt(row.meta.createdAt)
      const filename = `戰報-${created.text.replace(/[^0-9]/g, '') || row.meta.battleId}.txt`
      const delivery = await shareOrDownloadText(filename, logToReport(decoded.log))
      if (!aliveRef.current) return
      audio.play('select')
      if (delivery.method === 'shared') announce({ tone: 'status', text: `已開啟分享面板送出 ${filename}。` })
      else if (delivery.method === 'downloaded') {
        setManualReport({ filename, text: delivery.recoveryText })
        announce({ tone: 'status', text: `已開始下載 ${filename}；若瀏覽器攔截，可在下方手動保存戰報。` })
      }
      else if (delivery.method === 'copied') announce({ tone: 'status', text: `下載受阻，已將 ${filename} 的文字戰報複製到剪貼簿。` })
      else if (delivery.method === 'manual') setManualReport({ filename, text: delivery.recoveryText })
      else announce({ tone: 'status', text: '已取消分享。' })
    } catch (cause) {
      announce({ tone: 'error', text: errorText(cause, '戰報匯出失敗') })
    } finally {
      if (aliveRef.current) setBusyAction(null)
    }
  }

  const openDelete = (row: ReplayRow) => {
    if (busyAction) return
    controller.push({
      id: `replay-delete:${row.meta.battleId}`,
      policy: 'escape-and-backdrop',
      content: (
        <DeleteReplayOverlay
          row={row}
          onCancel={() => { pendingReplayFocus = { battleId: row.meta.battleId, action: 'delete' }; controller.pop() }}
          onDeleted={() => {
            pendingReplayNotice = { tone: 'status', text: `已刪除回放：${row.meta.players.join('、') || '未命名對戰'}。` }
            pendingReplayFocus = { battleId: row.meta.battleId, action: 'delete' }
            controller.pop()
          }}
        />
      ),
    }, { restoreFocus: () => restoreReplayFocus('data-replay-delete', row.meta.battleId) })
  }

  const readyCount = rows.filter((row) => row.state === 'ready').length
  const description = state === 'loading'
    ? '正在讀取瀏覽器中的回放…'
    : `${rows.length} 場回放；可播放 ${readyCount} 場。新回放只會在設定開啟錄製後產生。`

  return (
    <ModalSurface
      title="🎬 戰鬥回放"
      description={description}
      onClose={onClose}
      className="replay-list-surface"
      footer={<div className="utility-foot">回放只存於本機瀏覽器 IndexedDB <b>mz-replays</b>，最多保留最近 50 場；戰報由 canonical replay 即時投影，不另存衍生資料。</div>}
    >
      <div className="replay-list" data-replay-list data-replay-list-state={state}>
        <div className="replay-list__toolbar">
          <span className="replay-list__storage" data-replay-storage-state={state === 'error' ? 'error' : 'ready'}>
            {state === 'error' ? '儲存空間需要處理' : `本機回放 · ${rows.length} 場`}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" data-replay-refresh onClick={() => void load(true)} disabled={state === 'loading'}>重新整理</button>
        </div>

        {notice && (
          <div
            ref={noticeRef}
            className={`replay-notice replay-notice--${notice.tone}`}
            data-replay-feedback={notice.tone}
            role={notice.tone === 'error' ? 'alert' : 'status'}
            aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
            tabIndex={notice.tone === 'error' ? -1 : undefined}
          >{notice.text}</div>
        )}

        {state === 'loading' && (
          <div className="replay-list__state" role="status" data-replay-loading>
            <div className="eyebrow">Replay List</div>
            <h3>正在載入回放…</h3>
            <p>正在讀取本機紀錄並檢查每筆 canonical event。</p>
          </div>
        )}

        {state === 'error' && (
          <div className="replay-list__state replay-list__state--error" role="alert" data-replay-storage-error>
            <div className="eyebrow">Replay Storage</div>
            <h3>回放儲存空間暫時無法使用</h3>
            <p>{loadError ?? '既有回放沒有被修改。請重新整理，或改用支援 IndexedDB 的瀏覽器。'}</p>
            <button type="button" className="btn btn--sm" data-replay-retry onClick={() => void load(true)}>重新載入</button>
          </div>
        )}

        {state === 'empty' && (
          <div className="replay-list__state replay-empty" data-replay-empty>
            <div className="eyebrow">Replay List</div>
            <h3>還沒有回放</h3>
            <p>到「⚙️ 設定 → 🎬 錄製戰鬥回放」開啟錄製，完成下一場戰鬥後就會出現在這裡。</p>
          </div>
        )}

        {(state === 'ready' || state === 'partial') && (
          <>
            {state === 'partial' && <div className="replay-list__partial" role="status" data-replay-partial>部分回放需要處理；可對壞檔重試，或確認後刪除。</div>}
            <div className="replay-list__items" role="list" aria-label="戰鬥回放清單" data-replay-items>
              {rows.map((row) => (
                <ReplayRowView
                  key={row.meta.battleId}
                  row={row}
                  busyAction={busyAction}
                  onPlay={() => void open(row)}
                  onExport={() => void exportTxt(row)}
                  onDelete={() => openDelete(row)}
                  onRetry={() => void load(false)}
                />
              ))}
            </div>
          </>
        )}

        {manualReport && (
          <div className="replay-manual" data-replay-manual>
            <div className="replay-manual__head">
              <strong>下載受阻：手動保存戰報</strong>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setManualReport(null)}>收起</button>
            </div>
            <p>請複製以下文字到文字檔保存；它是由 canonical replay 即時產生的戰報。</p>
            <textarea readOnly value={manualReport.text} aria-label={`${manualReport.filename} 手動復原文字`} data-replay-manual-text />
          </div>
        )}
      </div>
    </ModalSurface>
  )
}

function ReplayRowView({
  row,
  busyAction,
  onPlay,
  onExport,
  onDelete,
  onRetry,
}: {
  row: ReplayRow
  busyAction: string | null
  onPlay: () => void
  onExport: () => void
  onDelete: () => void
  onRetry: () => void
}) {
  const canonicalHeader = row.log?.header
  const outcome = canonicalHeader?.outcome ?? row.meta.outcome
  const regionId = canonicalHeader?.regionId ?? row.meta.regionId
  const mode = canonicalHeader?.mode ?? row.meta.mode
  const created = formatCreatedAt(canonicalHeader?.createdAt ?? row.meta.createdAt)
  const snapshot = snapshotFor(row)
  const summary = row.summary
  const names = summary ? `${summary.players.join('、') || '我方'} vs ${summary.foes.join('、') || '對手'}` : `${row.meta.players.join('、') || '我方'} vs ${row.meta.foes.join('、') || '對手'}`
  const disabled = Boolean(busyAction)
  const statusLabel = row.state === 'decode-error'
    ? `無法播放：${row.error ?? 'canonical event 無法解碼。'}`
    : row.state === 'missing'
      ? row.error ?? '完整資料不存在。'
      : row.state === 'storage-error'
        ? row.error ?? '儲存空間讀取失敗。'
        : row.state === 'empty'
          ? '這筆回放沒有可播放事件。'
          : null

  return (
    <article className={`replay-item replay-item--${row.state}`} data-replay-row data-replay-state={row.state} data-replay-id={row.meta.battleId} role="listitem">
      <div className="replay-item__identity">
        <div className="replay-item__art-strip" aria-label="參戰 Mobie">
          {snapshot.length > 0 ? snapshot.slice(0, 6).map((unit) => {
            const species = safeSpecies(unit.speciesId)
            return <MobieSprite key={unit.instanceId} src={species?.artworkUrl ?? ''} alt={unit.displayName} shiny={unit.shiny} className="replay-item__art" />
          }) : <div className="replay-item__art replay-item__art--fallback" role="img" aria-label="參戰資料未記錄">◇</div>}
        </div>
        <div
          className="replay-item__main"
          role="button"
          tabIndex={row.state === 'ready' ? 0 : -1}
          aria-disabled={row.state !== 'ready' ? 'true' : undefined}
          aria-label={`播放回放 ${names}`}
          data-replay-invoker={row.meta.battleId}
          onClick={() => { if (row.state === 'ready') onPlay() }}
          onKeyDown={(event) => {
            if (row.state !== 'ready' || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            onPlay()
          }}
        >
          <div className="replay-item__title">
            <span className={`replay-item__badge replay-item__badge--${outcome}`}>{outcome === 'win' ? '勝利' : '落敗'}</span>
            <strong>{names}</strong>
          </div>
          <div className="replay-item__sub">
            <time dateTime={created.dateTime}>{created.text}</time>　·　{regionLabel(regionId)}　·　{mode === 'wild' ? '野外' : '競技'}
          </div>
          <div className="replay-item__facts">
            <span>參戰 {(summary?.participants ?? snapshot.length) || '未知'} 隻</span>
            <span>⏱ {formatReplayDuration(summary?.durationMs ?? (typeof row.meta.durationMs === 'number' ? row.meta.durationMs : null))}</span>
            <span>第 {summary?.turnCount ?? row.meta.turnCount ?? '？'} 回合</span>
            <span>{summary?.eventCount ?? row.meta.eventCount ?? '？'} 個事件</span>
          </div>
          {statusLabel && <div className="replay-item__status" role={row.state === 'storage-error' ? 'alert' : 'status'}>{statusLabel}</div>}
        </div>
      </div>
      <div className="replay-item__actions" aria-label={`${names} 可用操作`}>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          data-replay-play={row.meta.battleId}
          aria-label={`播放回放 ${names}`}
          disabled={disabled || row.state !== 'ready'}
          onClick={onPlay}
        >▶ 播放</button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          data-replay-export={row.meta.battleId}
          aria-label={`匯出戰報 ${names}`}
          disabled={disabled || row.state !== 'ready'}
          onClick={onExport}
        >📄 匯出</button>
        {(row.state === 'decode-error' || row.state === 'storage-error' || row.state === 'missing') && (
          <button type="button" className="btn btn--ghost btn--sm" data-replay-row-retry={row.meta.battleId} disabled={disabled} onClick={onRetry}>重試</button>
        )}
        <button
          type="button"
          className="btn btn--danger btn--sm"
          data-replay-delete={row.meta.battleId}
          aria-label={`刪除回放 ${names}`}
          disabled={disabled}
          onClick={onDelete}
        >🗑 刪除</button>
      </div>
    </article>
  )
}

function DeleteReplayOverlay({ row, onCancel, onDeleted }: { row: ReplayRow; onCancel: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const aliveRef = useRef(true)
  const snapshot = snapshotFor(row)
  const names = `${row.summary?.players.join('、') || row.meta.players.join('、') || '我方'} vs ${row.summary?.foes.join('、') || row.meta.foes.join('、') || '對手'}`
  const outcome = row.log?.header.outcome ?? row.meta.outcome
  const regionId = row.log?.header.regionId ?? row.meta.regionId

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteReplay(row.meta.battleId)
      if (!aliveRef.current) return
      audio.play('select')
      onDeleted()
    } catch (cause) {
      if (!aliveRef.current) return
      audio.play('defeat')
      setError(errorText(cause, '刪除失敗，回放仍保留在本機。'))
      setBusy(false)
    }
  }

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    if (!error) return
    const frame = requestAnimationFrame(() => errorRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [error])

  return (
    <ModalSurface
      title="確認刪除回放"
      description="這個動作會從本機 IndexedDB 移除回放，且不提供復原或 undo。"
      onClose={() => { if (!busy) onCancel() }}
      policy="escape-and-backdrop"
      className="replay-confirm-surface"
      restoreFocus={false}
      footer={(
        <div className="replay-confirm__actions">
          <button type="button" className="btn btn--ghost" data-replay-delete-cancel onClick={() => { if (!busy) onCancel() }} disabled={busy}>取消</button>
          <button type="button" className="btn btn--danger" data-replay-delete-confirm onClick={() => void confirm()} disabled={busy}>{busy ? '刪除中…' : '確認刪除'}</button>
        </div>
      )}
    >
      <div className="replay-confirm" data-replay-delete-dialog data-replay-id={row.meta.battleId}>
        <div className="replay-confirm__art-strip">
          {snapshot.slice(0, 6).map((unit) => {
            const species = safeSpecies(unit.speciesId)
            return <MobieSprite key={unit.instanceId} src={species?.artworkUrl ?? ''} alt={unit.displayName} shiny={unit.shiny} className="replay-confirm__art" />
          })}
        </div>
        <div className="replay-confirm__identity">
          <strong>{names}</strong>
          <span>{outcome === 'win' ? '勝利' : '落敗'}　·　{regionLabel(regionId)}</span>
          <span>刪除後這場回放與它的戰報都無法從本機清單復原。</span>
        </div>
        {error && <div ref={errorRef} className="replay-notice replay-notice--error" data-replay-delete-error role="alert" tabIndex={-1}>{error}</div>}
      </div>
    </ModalSurface>
  )
}
