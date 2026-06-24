import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRoster } from '@/store/rosterStore'
import { loadMeta, setProfileName, sanitizeProfileName, compareSaves, type SaveComparison } from '@/game/save/saveMeta'
import {
  buildSaveFile,
  deliverSaveFile,
  readSaveFile,
  backupCurrentSave,
  applyImportedSave,
  restoreBackup,
} from '@/game/save/saveIO'
import { getBackupInfo, type BackupInfo } from '@/game/save/backupStore'
import { listCards } from '@/game/cardLibrary'
import { listModelIds } from '@/scene/models/modelStore'
import type { UnpackOk } from '@/game/save/bundle'
import { audio } from '@/audio/audioEngine'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function fmtTime(ms: number): string {
  if (!ms) return '尚無變動'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

const DIR_LABEL: Record<SaveComparison, string> = { newer: '較新 ✅', older: '較舊 ⚠️', same: '相同' }
const DIR_COLOR: Record<SaveComparison, string> = {
  newer: 'var(--accent)',
  older: '#ff6b6b',
  same: 'var(--text-dim)',
}

/**
 * 存檔管理：匯出（分享面板/下載）+ 匯入（解析→本地vs匯入對照→較舊大聲警告→同意→
 * 覆蓋前自動備份→整包取代）。不是後端同步——雲端那段由 OS 負責。
 */
export function SaveManagerModal({ onClose }: { onClose: () => void }) {
  const roster = useRoster((s) => s.roster)
  const [name, setName] = useState('')
  const [includeModels, setIncludeModels] = useState(false)
  const [modelCount, setModelCount] = useState(0)
  const [cardsCount, setCardsCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [meta, setMeta] = useState(() => loadMeta())

  // 匯入相關
  const [pending, setPending] = useState<UnpackOk | null>(null)
  const [importErr, setImportErr] = useState<string | null>(null)
  const [confirmOlder, setConfirmOlder] = useState(false)
  const [backup, setBackup] = useState<BackupInfo | null>(null)
  const compareRef = useRef<HTMLDivElement>(null)

  // 對照表是匯入最關鍵的資訊（尤其較舊警告）——出現時自動捲入視野，別讓它躲在捲動區下方
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => compareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 360)
    return () => clearTimeout(t)
  }, [pending])

  const refreshLocal = () => {
    setMeta(loadMeta())
    listModelIds().then((ids) => setModelCount(ids.length)).catch(() => {})
    listCards().then((c) => setCardsCount(c.length)).catch(() => {})
    getBackupInfo().then(setBackup).catch(() => {})
  }

  useEffect(() => {
    setName(loadMeta().profileName)
    refreshLocal()
  }, [])

  const filename = `${sanitizeProfileName(name) ?? 'trainer'}.save`

  const commitName = () => {
    const m = setProfileName(name)
    setMeta(m)
    setName(m.profileName)
  }

  const doExport = async () => {
    setBusy(true)
    setMsg(null)
    commitName()
    try {
      const built = await buildSaveFile(roster, includeModels)
      const how = await deliverSaveFile(built)
      audio.play('select')
      const extra = built.modelCount ? `、含 ${built.modelCount} 個模型` : ''
      setMsg(`已${how === 'shared' ? '開啟分享面板送出' : '下載'} ${built.filename}（${fmtBytes(built.size)}${extra}）`)
      setMeta(loadMeta())
    } catch (e) {
      setMsg((e as Error)?.name === 'AbortError' ? '已取消分享' : `匯出失敗：${(e as Error)?.message ?? String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = async (file: File) => {
    setMsg(null)
    setImportErr(null)
    setPending(null)
    setConfirmOlder(false)
    const r = await readSaveFile(file)
    if (r.ok) setPending(r)
    else setImportErr(r.message)
  }

  const direction: SaveComparison | null = pending ? compareSaves(meta, pending.meta) : null

  const doImport = async () => {
    if (!pending) return
    setBusy(true)
    setMsg(null)
    try {
      await backupCurrentSave(Date.now()) // 安全紅線：覆蓋前一定先備份
      await applyImportedSave(pending)
      audio.play('victory')
      setMsg(`已匯入存檔（${pending.roster.length} 隻、${pending.cards.length} 張卡${pending.includesModels ? `、${pending.models.length} 個模型` : ''}）。`)
      setPending(null)
      refreshLocal()
    } catch (e) {
      setMsg(`匯入失敗：${(e as Error)?.message ?? String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const doRestore = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await restoreBackup()
      if (!r) setMsg('沒有可還原的備份。')
      else if (r.ok) {
        audio.play('select')
        setMsg('已還原匯入前的備份。')
        refreshLocal()
      } else setMsg(`還原失敗：${r.message}`)
    } finally {
      setBusy(false)
    }
  }

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
            <div className="h-title" style={{ fontSize: 24 }}>☁️ 存檔</div>
            <div className="h-sub">打包成 .save 檔，自己存到 Google Drive 或其他雲端 / 裝置。</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* ── 匯出 ── */}
          <div className="lib-panel" style={{ overflow: 'visible' }}>
            <div className="col" style={{ gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>存檔名稱</span>
              <input
                className="model-search"
                value={name}
                maxLength={24}
                placeholder="trainer"
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
              />
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>檔名：<b>{filename}</b></span>
            </div>

            <label className="lib-shiny" style={{ marginTop: 4 }}>
              <input type="checkbox" checked={includeModels} onChange={(e) => setIncludeModels(e.target.checked)} />
              包含 3D 模型（完整備份{modelCount ? `，${modelCount} 個` : '；目前無'}）
            </label>
            {includeModels && modelCount > 0 && <div className="lib-hint">含模型的檔案可能較大（每隻 GLB 數 MB）。</div>}

            <button className="btn" style={{ marginTop: 8 }} onClick={() => void doExport()} disabled={busy}>
              {busy ? '處理中…' : '⬆ 匯出存檔'}
            </button>
          </div>

          {/* ── 匯入 ── */}
          <div className="lib-panel" style={{ overflow: 'visible' }}>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 2 }}>從 .save 檔還原進度</div>
            <label className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }}>
              📂 選擇 .save 檔…
              <input
                type="file"
                accept=".save,.zip,application/zip"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onPickFile(f)
                  e.target.value = ''
                }}
              />
            </label>
            {importErr && <div className="lib-msg" style={{ color: '#ff6b6b' }}>⚠️ {importErr}</div>}

            <AnimatePresence>
              {pending && direction && (
                <motion.div
                  ref={compareRef}
                  className="save-compare"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <div className="save-compare__dir" style={{ color: DIR_COLOR[direction] }}>
                    匯入的存檔相對目前：<b>{DIR_LABEL[direction]}</b>
                  </div>
                  <table className="save-compare__table">
                    <thead>
                      <tr><th></th><th>目前</th><th>匯入</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>更新時間</td><td>{fmtTime(meta.updatedAt)}</td><td>{fmtTime(pending.meta.updatedAt)}</td></tr>
                      <tr><td>版本</td><td>v{meta.revision}</td><td>v{pending.meta.revision}</td></tr>
                      <tr><td>Mobie</td><td>{roster.length}</td><td>{pending.roster.length}</td></tr>
                      <tr><td>卡片</td><td>{cardsCount}</td><td>{pending.cards.length}</td></tr>
                      <tr><td>模型</td><td>{modelCount || '—'}</td><td>{pending.includesModels ? pending.models.length : '不含'}</td></tr>
                    </tbody>
                  </table>

                  {direction === 'older' && (
                    <div className="save-compare__warn">
                      ⚠️ 匯入的存檔比目前<b>舊</b>，覆蓋後會損失較新的進度。
                      <label className="lib-shiny" style={{ marginTop: 6 }}>
                        <input type="checkbox" checked={confirmOlder} onChange={(e) => setConfirmOlder(e.target.checked)} />
                        我了解，仍要用較舊的存檔覆蓋
                      </label>
                    </div>
                  )}

                  <div className="lib-hint" style={{ marginLeft: 0 }}>覆蓋前會自動備份目前進度，可隨時還原。</div>
                  <div className="row" style={{ gap: 8, marginTop: 6 }}>
                    <button
                      className="btn btn--sm"
                      onClick={() => void doImport()}
                      disabled={busy || (direction === 'older' && !confirmOlder)}
                    >
                      {direction === 'older' ? '仍要覆蓋並匯入' : '覆蓋並匯入'}
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => setPending(null)} disabled={busy}>取消</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {backup && !pending && (
              <div className="lib-hint" style={{ marginLeft: 0, marginTop: 6 }}>
                有匯入前備份（{fmtTime(backup.at)}）。
                <button className="btn btn--ghost btn--sm" style={{ marginLeft: 8 }} onClick={() => void doRestore()} disabled={busy}>
                  ↩ 還原
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="model-foot">
          目前進度：{roster.length} 隻Mobie。上次更新：{fmtTime(meta.updatedAt)}（v{meta.revision}）。
        </div>
        {msg && <div className="lib-msg" style={{ marginTop: 8 }}>{msg}</div>}
      </motion.div>
    </motion.div>
  )
}
