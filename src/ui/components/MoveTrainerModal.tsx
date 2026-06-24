import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Move, OwnedUnit } from '@/game/types'
import { useRoster } from '@/store/rosterStore'
import { useSkillPoints } from '@/store/skillPointsStore'
import { getSpecies } from '@/game/data/species'
import { getMove } from '@/game/data/moves'
import { effectiveLearnedMoves, teachableNotLearned, resolveEquippedMoves, MOVE_SLOT_CAP } from '@/game/learnset'
import { TYPE_LABEL_ZH, typeColor } from '@/ui/typeMeta'
import { audio } from '@/audio/audioEngine'

/** 學一招花的 SP（變化招便宜、攻擊招依威力 tier）。 */
function learnCost(move: Move): number {
  if (move.category === 'status') return 2
  return move.power >= 95 ? 4 : move.power >= 70 ? 3 : 2
}

/** 一顆招式 chip：屬性色點 + 名稱 + 威力/變化效果。equipped 高亮、可標 SP 成本。 */
function MoveChip({ move, state, cost, onClick }: {
  move: Move
  state: 'equipped' | 'learned' | 'learnable'
  cost?: number
  onClick?: () => void
}) {
  const sub = move.category === 'status' ? `✦ ${move.effect?.label ?? '輔助'}` : `威力 ${move.power}`
  return (
    <button
      className={`move-chip move-chip--${state} ${move.category === 'status' ? 'move-chip--status' : ''}`}
      style={{ ['--mv' as string]: typeColor(move.type) }}
      onClick={onClick}
      title={`${TYPE_LABEL_ZH[move.type]}・${move.category === 'status' ? '變化' : move.category === 'physical' ? '物理' : '特殊'}`}
    >
      <span className="move-chip__name">{move.nameZh}</span>
      <span className="move-chip__sub">{sub}</span>
      {cost != null && <span className="move-chip__cost">SP {cost}</span>}
    </button>
  )
}

/**
 * 招式訓練所（M19.e）：每隻 Mobie 學新招（花 SP，teachable 未學）/ 調整出戰 loadout（≤4、至少留 1）。
 * SP 與夥伴技能（M17）共用同一池但分頁分池顯示（plan/17 §3.1）。canonical 只動 learnedMoveIds/equippedMoveIds。
 */
export function MoveTrainerModal({ onClose }: { onClose: () => void }) {
  const roster = useRoster((s) => s.roster)
  const learnMove = useRoster((s) => s.learnMove)
  const setEquippedMoves = useRoster((s) => s.setEquippedMoves)
  const sp = useSkillPoints((s) => s.sp)
  const spend = useSkillPoints((s) => s.spend)
  const [openId, setOpenId] = useState<string | null>(null)

  const equippedIdsOf = (u: OwnedUnit) =>
    resolveEquippedMoves(u.equippedMoveIds, getSpecies(u.speciesId), u.level).map((m) => m.id)

  const toggleEquip = async (u: OwnedUnit, moveId: number) => {
    const current = equippedIdsOf(u)
    let next: number[]
    if (current.includes(moveId)) {
      if (current.length <= 1) { audio.play('defeat'); return } // 至少留 1 招
      next = current.filter((id) => id !== moveId)
    } else {
      if (current.length >= MOVE_SLOT_CAP) { audio.play('defeat'); return } // 出戰已滿 4
      next = [...current, moveId]
    }
    await setEquippedMoves(u.id, next)
    audio.play('select')
  }

  const learn = async (u: OwnedUnit, moveId: number, cost: number) => {
    if (sp < cost || !spend(cost)) { audio.play('defeat'); return }
    await learnMove(u.id, moveId)
    audio.play('super')
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
            <div className="h-title" style={{ fontSize: 24 }}>📖 招式訓練所</div>
            <div className="h-sub">學新招（花 SP）／調整出戰 4 招。打倒 boss 獲得 SP。</div>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span className="sp-badge">✦ SP {sp}</span>
            <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
          </div>
        </div>

        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {roster.map((u) => {
            const species = getSpecies(u.speciesId)
            const equipped = equippedIdsOf(u)
            const learned = effectiveLearnedMoves(u, species)
            const learnable = teachableNotLearned(u, species)
            const open = openId === u.id
            return (
              <div key={u.id} className="col" style={{ gap: 0 }}>
                <div className="team-row">
                  <div className="team-row__art"><img src={species.artworkUrl} alt={species.nameZh} /></div>
                  <div className="team-row__info">
                    <div className="team-row__name">{species.nameZh} <span className="hpbar__lv">Lv.{u.level}</span></div>
                    <div className="team-row__sub">出戰：{equipped.map((id) => getMove(id).nameZh).join('、')}</div>
                  </div>
                  <button className="team-row__item-btn" onClick={() => { audio.play('select'); setOpenId(open ? null : u.id) }}>
                    招式 ▾
                  </button>
                </div>

                <AnimatePresence>
                  {open && (
                    <motion.div
                      className="item-picker"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <div className="trainer-sec">出戰 loadout（點切換，上限 {MOVE_SLOT_CAP}、至少留 1）</div>
                      <div className="move-chip-row">
                        {learned.map((id) => (
                          <MoveChip
                            key={id}
                            move={getMove(id)}
                            state={equipped.includes(id) ? 'equipped' : 'learned'}
                            onClick={() => void toggleEquip(u, id)}
                          />
                        ))}
                      </div>
                      {learnable.length > 0 && (
                        <>
                          <div className="trainer-sec">學新招（花 SP；目前 SP {sp}）</div>
                          <div className="move-chip-row">
                            {learnable.map((id) => {
                              const mv = getMove(id)
                              const cost = learnCost(mv)
                              return (
                                <MoveChip
                                  key={id}
                                  move={mv}
                                  state="learnable"
                                  cost={cost}
                                  onClick={() => void learn(u, id, cost)}
                                />
                              )
                            })}
                          </div>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>

        <div className="model-foot">
          升級會自動領悟新招；訓練所可學 teachable 招、調整出戰 4 招。SP 與夥伴技能（M17）共用、分池顯示。
        </div>
      </motion.div>
    </motion.div>
  )
}
