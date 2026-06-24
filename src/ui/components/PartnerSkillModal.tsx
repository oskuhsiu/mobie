import { motion } from 'framer-motion'
import { usePlayerSkills } from '@/store/playerSkillsStore'
import { useSkillPoints } from '@/store/skillPointsStore'
import { useSettings } from '@/store/settingsStore'
import { PARTNER_SKILLS, isPartnerSkillLearned, type PartnerSkillDef } from '@/game/ext/partnerSkills'
import { audio } from '@/audio/audioEngine'

/**
 * 夥伴技能訓練所（M17，plan/19）：訓練師自己的帳號級技能——花 SP 解鎖（看穿為起始免費）。
 * SP 與招式訓練所（M19.e）共用同一池，但**分池顯示**（兩成本表、兩 modal）＝plan/17 §3.1 護欄，
 * 避免玩家誤以為怪物招式與玩家技能同類。canonical roster 不動（存 mobie.playerskills.v1）。
 */
export function PartnerSkillModal({ onClose }: { onClose: () => void }) {
  const learnedSkillIds = usePlayerSkills((s) => s.learnedSkillIds)
  const learn = usePlayerSkills((s) => s.learn)
  const sp = useSkillPoints((s) => s.sp)
  const spend = useSkillPoints((s) => s.spend)
  const moduleOn = useSettings((s) => s.settings.modules.partnerSkills)

  const unlock = (skill: PartnerSkillDef) => {
    if (!spend(skill.cost)) { audio.play('defeat'); return } // spend 自帶餘額檢查、不足不扣
    learn(skill.id)
    audio.play('super')
  }

  const modeLabel = (m: PartnerSkillDef['mode']) => (m === 'active' ? '戰中主動' : '開戰支援')

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
            <div className="h-title" style={{ fontSize: 24 }}>✨ 夥伴技能</div>
            <div className="h-sub">訓練師自己的戰術工具（跨 Mobie 共用）。花 SP 解鎖；打倒 boss 獲得 SP。</div>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span className="sp-badge">✦ SP {sp}</span>
            <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
          </div>
        </div>

        {!moduleOn && (
          <div className="trainer-sec" style={{ color: 'var(--accent)' }}>
            ⚠️ 夥伴技能模組尚未開啟——到 ⚙️ 設定開啟後，戰鬥中才會出現「✨ 夥伴技能」行動鈕。
          </div>
        )}

        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PARTNER_SKILLS.map((skill) => {
            const learned = isPartnerSkillLearned(skill.id, learnedSkillIds)
            const starter = skill.cost === 0
            return (
              <div key={skill.id} className="team-row">
                <div className="team-row__art" style={{ display: 'grid', placeItems: 'center', fontSize: 30 }}>{skill.icon}</div>
                <div className="team-row__info">
                  <div className="team-row__name">
                    {skill.name} <span className="hpbar__lv">{modeLabel(skill.mode)}</span>
                  </div>
                  <div className="team-row__sub">{skill.desc}</div>
                </div>
                {learned ? (
                  <span className="sp-badge" style={{ opacity: 0.85 }}>
                    {starter ? '起始' : '已習得'} ✓
                  </span>
                ) : (
                  <button className="team-row__item-btn" onClick={() => unlock(skill)}>
                    解鎖 SP {skill.cost}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="model-foot">
          SP 與「📖 招式訓練所」共用同一池，但分池顯示（玩家技能 vs 怪物招式）。玩家技能存於 <b>mobie.playerskills.v1</b>，不掛任何 Mobie。
        </div>
      </motion.div>
    </motion.div>
  )
}
