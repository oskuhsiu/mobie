// M14.e — 回放清單（Title「🎬 回放」入口）。列出 mz-replays 各場 → 點選播放、匯出 .txt 戰報、刪除。
// 載入時 decodeReplay；壞檔走分類錯誤提示（比照 SaveManager）。.txt 為即時投影、不持久化（plan/15 §7）。

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { audio } from '@/audio/audioEngine'
import { listReplayMetas, getReplay, deleteReplay, subscribeReplays, type ReplayRecordMeta } from '@/game/replay/replayDb'
import { decodeReplay } from '@/game/replay/codec'
import { logToReport } from '@/game/replay/report'
import type { ReplayLog } from '@/game/replay/types'
import { ReplayPlayerModal } from '@/ui/components/ReplayPlayerModal'

/** 把一段文字交給使用者（iPad 優先分享面板，桌機退回 <a download>）。 */
async function shareOrDownloadText(filename: string, text: string): Promise<void> {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (typeof navigator.share === 'function') {
    const file = new File([blob], filename, { type: 'text/plain' })
    if (!nav.canShare || nav.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
      }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

const fmtTime = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ReplayListModal({ onClose }: { onClose: () => void }) {
  const [metas, setMetas] = useState<ReplayRecordMeta[] | null>(null)
  const [playing, setPlaying] = useState<ReplayLog | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const refresh = () => { void listReplayMetas().then((m) => { if (alive) setMetas(m) }) }
    refresh()
    const unsub = subscribeReplays(refresh)
    return () => { alive = false; unsub() }
  }, [])

  const open = async (battleId: string) => {
    setError(null)
    const rec = await getReplay(battleId)
    if (!rec) { setError('找不到這筆回放（可能已被清除）。'); return }
    const res = decodeReplay(rec.json)
    if (!res.ok) { setError(`回放無法播放：${res.message}`); return }
    audio.play('select')
    setPlaying(res.log)
  }

  const exportTxt = async (meta: ReplayRecordMeta) => {
    const rec = await getReplay(meta.battleId)
    if (!rec) return
    const res = decodeReplay(rec.json)
    if (!res.ok) { setError(`戰報無法匯出：${res.message}`); return }
    audio.play('select')
    await shareOrDownloadText(`戰報-${fmtTime(meta.createdAt).replace(/[/: ]/g, '')}.txt`, logToReport(res.log))
  }

  const remove = async (battleId: string) => {
    audio.play('select')
    await deleteReplay(battleId)
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="modal-card" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__head">
          <div>
            <div className="h-title" style={{ fontSize: 24 }}>🎬 戰鬥回放</div>
            <div className="h-sub">重播每場戰鬥、匯出文字戰報。需在「⚙️ 設定」開啟錄製才會有新紀錄。</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        {error && <div className="replay-error">{error}</div>}

        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {metas === null && <div className="h-sub" style={{ padding: 12 }}>載入中…</div>}
          {metas !== null && metas.length === 0 && (
            <div className="replay-empty">
              還沒有任何回放。到「⚙️ 設定 → 🎬 錄製戰鬥回放」打開後，打一場就會出現在這裡。
            </div>
          )}
          {metas?.map((m) => (
            <div key={m.battleId} className="replay-item">
              <div className="replay-item__main" role="button" tabIndex={0} onClick={() => void open(m.battleId)}>
                <div className="replay-item__title">
                  <span className={`replay-item__badge replay-item__badge--${m.outcome}`}>{m.outcome === 'win' ? '勝' : '敗'}</span>
                  {m.players.join('、')} <span className="replay-item__vs">vs</span> {m.foes.join('、')}
                </div>
                <div className="replay-item__sub">{fmtTime(m.createdAt)}　·　{m.mode === 'wild' ? '野外' : '競技/塔'}</div>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => void exportTxt(m)}>📄 戰報</button>
              <button className="btn btn--ghost btn--sm" onClick={() => void remove(m.battleId)}>🗑</button>
            </div>
          ))}
        </div>

        <div className="model-foot">回放存於瀏覽器 <b>mz-replays</b>，最多保留最近 50 場（超過自動清最舊）。文字戰報為即時產生、不另存。</div>
      </motion.div>

      {playing && <ReplayPlayerModal log={playing} onClose={() => setPlaying(null)} />}
    </motion.div>
  )
}
