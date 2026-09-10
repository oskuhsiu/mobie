import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRoster } from '@/store/rosterStore'
import { loadMeta, setProfileName, sanitizeProfileName, compareSaves, type SaveComparison } from '@/game/save/saveMeta'
import {
  buildSaveFile,
  deliverSaveFile,
  readSaveFile,
  applyImportedSave,
  backupCurrentSave,
  recoverSaveTransaction,
  restoreBackup,
} from '@/game/save/saveIO'
import { getBackupInfo, type BackupInfo } from '@/game/save/backupStore'
import { listCards } from '@/game/cardLibrary'
import type { UnpackOk } from '@/game/save/bundle'
import { audio } from '@/audio/audioEngine'
import { ModalSurface } from '@/ui/shell/ModalSurface'
import { getSaveOperationSnapshot, subscribeSaveOperationGuard } from '@/game/save/saveOperationGuard'

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
  const saveOperation = useSyncExternalStore(subscribeSaveOperationGuard, getSaveOperationSnapshot, getSaveOperationSnapshot)
  const saveBlocked = saveOperation.blocked
  const [name, setName] = useState('')
  const [cardsCount, setCardsCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [meta, setMeta] = useState(() => loadMeta())

  // 匯入相關
  const [pending, setPending] = useState<UnpackOk | null>(null)
  const [importErr, setImportErr] = useState<string | null>(null)
  const [confirmOlder, setConfirmOlder] = useState(false)
  const [backup, setBackup] = useState<BackupInfo | null>(null)
  const [recoveryText, setRecoveryText] = useState<string | null>(null)
  const [downloadRecovery, setDownloadRecovery] = useState<string | null>(null)
  const compareRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileTriggerRef = useRef<HTMLButtonElement>(null)

  // 對照表是匯入最關鍵的資訊（尤其較舊警告）——出現時自動捲入視野，別讓它躲在捲動區下方
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => compareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 360)
    return () => clearTimeout(t)
  }, [pending])

  const refreshLocal = () => {
    setMeta(loadMeta())
    listCards().then((c) => setCardsCount(c.length)).catch(() => {})
    getBackupInfo().then(setBackup).catch(() => {})
  }

  useEffect(() => {
    setName(loadMeta().profileName)
    refreshLocal()
  }, [])

  useEffect(() => {
    void recoverSaveTransaction().catch((error) => {
      setMsg(`存檔交易回復失敗：${error instanceof Error ? error.message : String(error)}`)
    })
  }, [])

  const filename = `${sanitizeProfileName(name) ?? 'trainer'}.save`

  const commitName = () => {
    if (saveBlocked) return
    const m = setProfileName(name)
    setMeta(m)
    setName(m.profileName)
  }

  const doExport = async () => {
    if (saveBlocked) {
      setMsg(saveOperation.message)
      return
    }
    setBusy(true)
    setMsg(null)
    setRecoveryText(null)
    setDownloadRecovery(null)
    commitName()
    try {
      const built = await buildSaveFile(roster)
      const delivery = await deliverSaveFile(built)
      audio.play('select')
      if (delivery.method === 'shared') setMsg(`已開啟分享面板送出 ${built.filename}（${fmtBytes(built.size)}）`)
      else if (delivery.method === 'downloaded') {
        setDownloadRecovery(delivery.recoveryText ?? null)
        setMsg(`已開始下載 ${built.filename}（${fmtBytes(built.size)}）。若瀏覽器未出現檔案，請顯示復原碼。`)
      }
      else if (delivery.method === 'copied') setMsg(`下載受阻，已將 ${built.filename} 的復原碼複製到剪貼簿。`)
      else {
        setMsg(`下載與剪貼簿都受阻，請在下方手動保存 ${built.filename} 的復原碼。`)
        setRecoveryText(delivery.recoveryText ?? null)
      }
      setMeta(loadMeta())
    } catch (e) {
      setMsg((e as Error)?.name === 'AbortError' ? '已取消分享' : `匯出失敗：${(e as Error)?.message ?? String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = async (file: File) => {
    if (saveBlocked) {
      setMsg(saveOperation.message)
      return
    }
    setMsg(null)
    setImportErr(null)
    setPending(null)
    setConfirmOlder(false)
    try {
      const r = await readSaveFile(file)
      if (r.ok) setPending(r)
      else setImportErr(r.message)
    } finally {
      requestAnimationFrame(() => fileTriggerRef.current?.focus())
    }
  }

  const direction: SaveComparison | null = pending ? compareSaves(meta, pending.meta) : null

  const doImport = async () => {
    if (!pending) return
    if (saveBlocked) {
      setMsg(saveOperation.message)
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await applyImportedSave(pending)
      audio.play('victory')
      const legacyNotice = pending.legacyModelCount > 0
        ? `；舊版模型資料 ${pending.legacyModelCount} 個已完成完整性驗證並忽略`
        : ''
      setMsg(`已匯入存檔（${pending.roster.length} 隻、${pending.cards.length} 張卡${legacyNotice}）。`)
      setPending(null)
      refreshLocal()
    } catch (e) {
      setMsg(`匯入失敗：${(e as Error)?.message ?? String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const doRestore = async () => {
    if (saveBlocked) {
      setMsg(saveOperation.message)
      return
    }
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

  const doBackup = async () => {
    if (saveBlocked) {
      setMsg(saveOperation.message)
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await backupCurrentSave(Date.now())
      audio.play('select')
      setMsg('已建立目前進度備份，可在本頁還原。')
      refreshLocal()
    } catch (e) {
      setMsg(`備份失敗：${(e as Error)?.message ?? String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalSurface
      title="☁️ 存檔"
      description="打包成 .save 檔，自己存到 Google Drive 或其他雲端 / 裝置。"
      onClose={onClose}
      footer={<div className="utility-foot">目前進度：{roster.length} 隻Mobie。上次更新：{fmtTime(meta.updatedAt)}（v{meta.revision}）。</div>}
    >
      <div className="modal-surface__stack">
        {saveBlocked && (
          <div className="settlement-status" role="status" aria-live="polite" data-save-settlement-gate data-save-operation-gate>
            {saveOperation.message}
          </div>
        )}
          {/* ── 匯出 ── */}
          <section className="lib-panel save-step" data-save-step="export" aria-labelledby="save-step-export-heading" style={{ overflow: 'visible' }}>
            <h3 id="save-step-export-heading" className="save-step__title">1. 匯出目前進度</h3>
            <div className="col" style={{ gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>存檔名稱</span>
              <input
                className="utility-search"
                value={name}
                maxLength={24}
                disabled={busy || saveBlocked}
                placeholder="trainer"
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
              />
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>檔名：<b>{filename}</b></span>
            </div>
            <div className="lib-hint" style={{ marginLeft: 0 }}>
              新存檔固定只含 Mobie 與卡片進度；custom GLB/GLTF 已停用，既有本機資料不會被讀取或刪除。
            </div>

            <button className="btn" data-save-export onClick={() => void doExport()} disabled={busy || saveBlocked}>
              {busy ? '處理中…' : saveBlocked ? '操作暫停…' : '⬆ 匯出存檔'}
            </button>
            {recoveryText && (
              <label className="save-recovery">
                <span>手動保存復原碼（完整選取後貼到安全位置）</span>
                <textarea data-save-recovery readOnly value={recoveryText} onFocus={(event) => event.currentTarget.select()} />
              </label>
            )}
            {downloadRecovery && !recoveryText && (
              <button className="btn btn--ghost btn--sm" data-save-recovery-reveal onClick={() => setRecoveryText(downloadRecovery)}>
                顯示復原碼（若未取得下載檔）
              </button>
            )}
          </section>

          {/* ── 匯入 ── */}
          <section className="lib-panel save-step" data-save-step="import" aria-labelledby="save-step-import-heading" style={{ overflow: 'visible' }}>
            <h3 id="save-step-import-heading" className="save-step__title">2. 匯入並比較</h3>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 2 }}>先驗證檔案，再比較目前與匯入進度；覆蓋前會自動建立備份。</div>
            <div className="save-file-picker">
              <button
                ref={fileTriggerRef}
                type="button"
                className="btn btn--ghost btn--sm"
                data-save-import-trigger
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || saveBlocked}
              >📂 選擇 .save 檔…</button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".save,.zip,application/zip"
                hidden
                disabled={busy || saveBlocked}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onPickFile(f)
                  e.target.value = ''
                }}
              />
            </div>
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
                    </tbody>
                  </table>

                  {pending.legacyModelCount > 0 && (
                    <div className="lib-hint" style={{ marginLeft: 0 }}>
                      這份舊版存檔含 {pending.legacyModelCount} 個停用的 custom model entry；只驗證檔案完整性，匯入時會忽略，且不會碰本機舊資料。
                    </div>
                  )}

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
                      disabled={busy || saveBlocked || (direction === 'older' && !confirmOlder)}
                    >
                      {direction === 'older' ? '仍要覆蓋並匯入' : '覆蓋並匯入'}
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => setPending(null)} disabled={busy || saveBlocked}>取消</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

          </section>

          {/* ── 備份 / 還原 ── */}
          <section className="lib-panel save-step" data-save-step="backup" aria-labelledby="save-step-backup-heading" style={{ overflow: 'visible' }}>
            <h3 id="save-step-backup-heading" className="save-step__title">3. 備份與還原</h3>
            <div className="lib-hint" style={{ marginLeft: 0 }}>備份只含目前 Mobie 與卡片 canonical data，不含成就、孵化或 Result 待辦回條。</div>
            <button className="btn btn--ghost btn--sm" data-save-backup onClick={() => void doBackup()} disabled={busy || saveBlocked}>
              {busy ? '處理中…' : '建立目前進度備份'}
            </button>
            {backup && (
              <div className="lib-hint" style={{ marginLeft: 0 }}>
                有匯入前備份（可還原，{fmtTime(backup.at)}）。
                <button className="btn btn--ghost btn--sm" data-save-restore style={{ marginLeft: 8 }} onClick={() => void doRestore()} disabled={busy || saveBlocked}>
                  ↩ 還原備份
                </button>
              </div>
            )}
          </section>
        {msg && <div className="lib-msg" style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </ModalSurface>
  )
}
