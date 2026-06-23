// M10 — 圖鑑（Dex）。1–251 三態（未見/看過/已捕）+ 擁有疊加 + Grade 篩選。純讀 meta + roster。
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useMeta } from '@/store/metaStore'
import { useRoster } from '@/store/rosterStore'
import { SPECIES_SORTED } from '@/game/data/speciesQuery'
import { currentlyOwnedSpecies, dexStateOf, type DexState } from '@/game/meta'
import { computeGrade, isShiningGrade, type Grade } from '@/game/grade'
import { getSpecies } from '@/game/data/species'

type Filter = 'all' | 'registered' | 'owned' | 'shining'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'registered', label: '已捕' },
  { id: 'owned', label: '擁有' },
  { id: 'shining', label: '✦ 閃耀' },
]

export function DexModal({ onClose }: { onClose: () => void }) {
  const meta = useMeta((s) => s.meta)
  const roster = useRoster((s) => s.roster)
  const [filter, setFilter] = useState<Filter>('all')

  const owned = useMemo(() => currentlyOwnedSpecies(roster), [roster])
  // 每個物種「最高擁有 Grade」（擁有才有；給篩選/徽章用）
  const gradeBySpecies = useMemo(() => {
    const m = new Map<number, Grade>()
    for (const u of roster) {
      const g = computeGrade(u, getSpecies(u.speciesId))
      if (g > (m.get(u.speciesId) ?? 0)) m.set(u.speciesId, g)
    }
    return m
  }, [roster])

  const registeredCount = meta.registered.length
  const ownedCount = owned.size
  const total = SPECIES_SORTED.length

  const visible = useMemo(() => SPECIES_SORTED.filter((sp) => {
    const st = dexStateOf(sp.id, meta, owned)
    if (filter === 'registered') return st === 'registered' || st === 'owned'
    if (filter === 'owned') return st === 'owned'
    if (filter === 'shining') return owned.has(sp.id) && isShiningGrade(gradeBySpecies.get(sp.id) ?? 1)
    return true
  }), [filter, meta, owned, gradeBySpecies])

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-card__head">
          <div>
            <div className="h-title" style={{ fontSize: 24 }}>📖 圖鑑</div>
            <div className="h-sub">已捕 {registeredCount} / {total}　擁有 {ownedCount} 種</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        <div className="dex-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? 'chip--on' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="scroll dex-grid">
          {visible.map((sp) => {
            const st: DexState = dexStateOf(sp.id, meta, owned)
            const known = st === 'registered' || st === 'owned'
            const grade = gradeBySpecies.get(sp.id)
            return (
              <div key={sp.id} className={`dex-cell dex-cell--${st}`} title={known || st === 'seen' ? sp.nameZh : '未發現'}>
                <span className="dex-cell__no">{String(sp.id).padStart(3, '0')}</span>
                <div className="dex-cell__art">
                  {st === 'unseen'
                    ? <span className="dex-cell__q">?</span>
                    : <img src={sp.artworkUrl} alt="" loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', filter: st === 'seen' ? 'brightness(0) opacity(0.55)' : 'none' }} />}
                </div>
                <span className="dex-cell__name">{known ? sp.nameZh : st === 'seen' ? '？？？' : '—'}</span>
                {st === 'owned' && grade && (
                  <span className={`dex-cell__grade ${isShiningGrade(grade) ? 'dex-cell__grade--shine' : ''}`}>
                    {grade === 6 ? 'SS' : grade === 5 ? 'S' : grade}
                  </span>
                )}
              </div>
            )
          })}
          {visible.length === 0 && <div className="h-sub" style={{ padding: 20 }}>此篩選下尚無寶可夢</div>}
        </div>
      </motion.div>
    </motion.div>
  )
}
