import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useRoster } from '@/store/rosterStore'
import { loadMeta, setProfileName, sanitizeProfileName } from '@/game/save/saveMeta'
import { buildSaveFile, deliverSaveFile } from '@/game/save/saveIO'
import { listModelIds } from '@/scene/models/modelStore'
import { audio } from '@/audio/audioEngine'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function fmtTime(ms: number): string {
  if (!ms) return '尚無存檔變動'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

/**
 * 存檔管理：匯出成 `<profileName>.save`（zip）→ 系統分享面板送 Google Drive / Files，或下載。
 * 不是後端同步——雲端那段由 OS 負責，這裡只打包 / 解包。匯入（含新舊對照 / 備份覆蓋）在 M5-4。
 */
export function SaveManagerModal({ onClose }: { onClose: () => void }) {
  const roster = useRoster((s) => s.roster)
  const [name, setName] = useState('')
  const [includeModels, setIncludeModels] = useState(false)
  const [modelCount, setModelCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [meta, setMeta] = useState(() => loadMeta())

  useEffect(() => {
    setName(loadMeta().profileName)
    listModelIds()
      .then((ids) => setModelCount(ids.length))
      .catch(() => {})
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
          {includeModels && modelCount > 0 && (
            <div className="lib-hint">含模型的檔案可能較大（每隻 GLB 數 MB）。</div>
          )}

          <button className="btn" style={{ marginTop: 8 }} onClick={() => void doExport()} disabled={busy}>
            {busy ? '打包中…' : '⬆ 匯出存檔'}
          </button>
        </div>

        <div className="model-foot">
          目前進度：{roster.length} 隻寶可夢。上次更新：{fmtTime(meta.updatedAt)}（v{meta.revision}）。
        </div>
        {msg && <div className="lib-msg" style={{ marginTop: 8 }}>{msg}</div>}
      </motion.div>
    </motion.div>
  )
}
