// M10 — 成就頁。進度條 + 達成狀態 + 領取（→ 孵化所蛋獎勵）。發獎走明確 action（plan/10 §3.3）。
import { motion } from 'framer-motion'
import { useMeta } from '@/store/metaStore'
import { useRoster } from '@/store/rosterStore'
import { useIncubator } from '@/store/incubatorStore'
import { computeAchievements } from '@/game/achievements'

export function AchievementsModal({ onClose }: { onClose: () => void }) {
  const meta = useMeta((s) => s.meta)
  const roster = useRoster((s) => s.roster)
  const claimAchievement = useMeta((s) => s.claimAchievement)
  const addRewardEgg = useIncubator((s) => s.addRewardEgg)
  const views = computeAchievements(meta, roster)
  const done = views.filter((v) => v.unlocked).length

  // 領取：metaStore 標記（exactly-once）→ reward 寫入孵化所（產蛋）
  const claim = (id: string) => {
    const reward = claimAchievement(id)
    if (reward) addRewardEgg(reward)
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-card__head">
          <div>
            <div className="h-title" style={{ fontSize: 24 }}>🏆 成就</div>
            <div className="h-sub">已達成 {done} / {views.length}　領取可獲得孵化所的蛋</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {views.map((v) => {
            const pct = Math.round((v.progress / v.target) * 100)
            return (
              <div key={v.def.id} className={`ach-row ${v.unlocked ? 'ach-row--done' : ''}`}>
                <span className="ach-row__icon">{v.def.icon}</span>
                <div className="ach-row__body">
                  <div className="ach-row__top">
                    <span className="ach-row__name">{v.def.name}</span>
                    <span className="ach-row__count">{v.progress}/{v.target}</span>
                  </div>
                  <div className="ach-row__desc">{v.def.desc}　<span className="ach-row__reward">🥚 {v.def.reward.label}</span></div>
                  <div className="ach-row__track"><div className="ach-row__fill" style={{ width: `${pct}%` }} /></div>
                </div>
                {v.claimed
                  ? <span className="ach-row__claimed">✓ 已領取</span>
                  : v.unlocked
                    ? <button className="btn btn--sm ach-row__claim" onClick={() => claim(v.def.id)}>領取</button>
                    : <span className="ach-row__lock">進行中</span>}
              </div>
            )
          })}
        </div>
      </motion.div>
    </motion.div>
  )
}
