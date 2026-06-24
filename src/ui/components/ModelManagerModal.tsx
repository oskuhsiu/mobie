import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { SPECIES_SORTED, matchesSpecies } from '@/game/data/speciesQuery'
import { putModel, deleteModel, listModelIds, subscribeModels } from '@/scene/models/modelStore'
import { audio } from '@/audio/audioEngine'

/**
 * 3D 模型管理：把本機 GLB drop-in 對應到某 speciesId（存進 IndexedDB）。
 * repo 不內建/不散布任何模型——這只是把「使用者自己的檔案」存進「使用者自己的瀏覽器」。
 * 戰鬥場景 MobieVisual 會優先用這裡匯入的 GLB，沒有才退回 artwork billboard。
 */
export function ModelManagerModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [customIds, setCustomIds] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const refresh = () => listModelIds().then((ids) => { if (alive) setCustomIds(new Set(ids)) })
    refresh()
    return subscribeModels(() => { if (alive) refresh() })
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim()
    const base = s ? SPECIES_SORTED.filter((sp) => matchesSpecies(sp, s)) : SPECIES_SORTED
    if (s) return base.slice(0, 80)
    // 無搜尋時：已套用自訂模型者優先，其餘限量顯示（避免一次塞滿 251 列）
    const custom = base.filter((sp) => customIds.has(sp.id))
    const rest = base.filter((sp) => !customIds.has(sp.id))
    return [...custom, ...rest].slice(0, 60)
  }, [q, customIds])

  const onPick = async (id: number, file?: File) => {
    if (!file) return
    setError(null)
    setBusy(id)
    try {
      await putModel(id, file)
      audio.play('select')
    } catch (e) {
      setError(e instanceof Error ? e.message : '匯入失敗')
    } finally {
      setBusy(null)
    }
  }

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="modal-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-card__head">
          <div>
            <div className="h-title" style={{ fontSize: 24 }}>🧩 3D 模型</div>
            <div className="h-sub">替任一寶可夢匯入本機 GLB；沒匯入的就用官方 artwork 立繪。</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        <input
          className="model-search"
          placeholder="搜尋名稱或編號…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {error && <div className="model-error">⚠ {error}</div>}

        <div className="model-list scroll">
          {filtered.map((sp) => {
            const has = customIds.has(sp.id)
            return (
              <div className={`model-row ${has ? 'model-row--has' : ''}`} key={sp.id}>
                <img className="model-row__art" src={sp.artworkUrl} alt={sp.nameZh} loading="lazy" draggable={false} />
                <div className="model-row__meta">
                  <div className="model-row__name">
                    {sp.nameZh} <span className="model-row__id">#{sp.id}</span>
                  </div>
                  <div className={`model-row__status ${has ? 'is-custom' : ''}`}>
                    {has ? '✓ 已套用自訂 3D 模型' : '預設：artwork 立繪'}
                  </div>
                </div>
                {has && (
                  <button className="btn btn--ghost btn--sm" onClick={() => void deleteModel(sp.id)}>
                    移除
                  </button>
                )}
                <label className="btn btn--sm model-row__import">
                  {busy === sp.id ? '匯入中…' : has ? '替換' : '匯入 GLB'}
                  <input
                    type="file"
                    accept=".glb,.gltf,model/gltf-binary"
                    hidden
                    onChange={(e) => { void onPick(sp.id, e.target.files?.[0]); e.target.value = '' }}
                  />
                </label>
              </div>
            )
          })}
          {filtered.length === 0 && <div className="model-empty">找不到符合的寶可夢</div>}
        </div>

        <div className="model-foot">
          模型只存在你這台瀏覽器（IndexedDB），本程式不內建也不散布任何 3D 模型。
          建議用 .glb；模型會自動縮放置中站到地台上。
        </div>
      </motion.div>
    </motion.div>
  )
}
