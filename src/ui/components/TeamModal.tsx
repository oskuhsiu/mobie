import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRoster } from '@/store/rosterStore'
import { useBag } from '@/store/bagStore'
import { useSettings } from '@/store/settingsStore'
import { getSpecies } from '@/game/data/species'
import { ITEMS, getItem } from '@/game/ext/items'
import { abilityForType, getAbility } from '@/game/ext/abilities'
import { buildBattleMobie } from '@/game/stats'
import { ownedToCard } from '@/game/growth'
import { MobCard } from '@/ui/components/MobCard'
import type { BattleMobie, OwnedUnit } from '@/game/types'
import { audio } from '@/audio/audioEngine'

/**
 * 隊伍養成頁：替每隻Mobie裝備持有道具（M7）。背包庫存走 mobie.itembag.v1（exactly-once 對帳）。
 * 道具模組關閉時仍可瀏覽，但會提示去設定開啟才會在戰鬥生效（守可選式掛載）。
 */
export function TeamModal({ onClose }: { onClose: () => void }) {
  const roster = useRoster((s) => s.roster)
  const bag = useBag((s) => s.bag)
  const equip = useBag((s) => s.equip)
  const itemsOn = useSettings((s) => s.settings.modules.heldItems)
  const abilitiesOn = useSettings((s) => s.settings.modules.abilities)
  const [openId, setOpenId] = useState<string | null>(null)
  // 點 Mobie 開資訊卡（M16）：用 owner 全顯模式檢視招式/六維/個體/特性/道具。
  const [detail, setDetail] = useState<BattleMobie | null>(null)
  // 哪些相關模組未開（提示去設定開啟）
  const offModules = [!itemsOn && '持有道具', !abilitiesOn && '特性'].filter(Boolean) as string[]

  const choose = async (unitId: string, itemId: string | null) => {
    const ok = await equip(unitId, itemId)
    audio.play(ok ? 'select' : 'defeat')
    setOpenId(null)
  }

  // 由 canonical OwnedUnit 建出檢視用 BattleMobie；補上依屬性決定論的特性 id 供卡片顯示。
  const openDetail = (u: OwnedUnit) => {
    const mon = buildBattleMobie(ownedToCard(u))
    mon.abilityId = abilityForType(getSpecies(u.speciesId).types[0])
    audio.play('select')
    setDetail(mon)
  }

  return (
    <>
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
            <div className="h-title" style={{ fontSize: 24 }}>🎒 隊伍 · 道具</div>
            <div className="h-sub">每隻可裝一個持有道具；強化能力 / 提升傷害 / 回合末回血。</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        {offModules.length > 0 && (
          <div className="lib-msg" style={{ marginBottom: 8 }}>
            ⚠️ {offModules.join(' / ')}模組目前關閉——需到「⚙️ 設定」開啟才會在戰鬥生效。
          </div>
        )}

        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {roster.map((u) => {
            const sp = getSpecies(u.speciesId)
            const held = getItem(u.heldItemId)
            const ability = getAbility(abilityForType(sp.types[0]))
            const open = openId === u.id
            return (
              <div key={u.id} className="col" style={{ gap: 0 }}>
                <div className="team-row">
                  <button className="team-row__main" onClick={() => openDetail(u)} title="看資訊卡">
                    <div className="team-row__art">
                      <img src={sp.artworkUrl} alt={sp.nameZh} />
                    </div>
                    <div className="team-row__info">
                      <div className="team-row__name">{sp.nameZh} <span className="hpbar__lv">Lv.{u.level}</span> <span className="team-row__info-hint">ℹ️ 詳情</span></div>
                      <div className="team-row__sub">
                        {ability && <span className="team-row__ability" title={ability.desc}>特性：{ability.icon} {ability.name}</span>}
                        <span>道具：{held ? `${held.icon} ${held.name}` : '未裝備'}</span>
                      </div>
                    </div>
                  </button>
                  <button
                    className="team-row__item-btn"
                    onClick={() => { audio.play('select'); setOpenId(open ? null : u.id) }}
                  >
                    {held ? '更換' : '裝備'} ▾
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
                      {held && (
                        <button className="item-chip" onClick={() => void choose(u.id, null)}>
                          ✕ 卸下
                        </button>
                      )}
                      {ITEMS.map((it) => {
                        const equipped = u.heldItemId === it.id
                        const count = bag[it.id] ?? 0
                        const disabled = !equipped && count <= 0
                        return (
                          <button
                            key={it.id}
                            className={`item-chip ${equipped ? 'item-chip--on' : ''}`}
                            disabled={disabled}
                            title={it.desc}
                            onClick={() => !equipped && void choose(u.id, it.id)}
                          >
                            {it.icon} {it.name}
                            <span className="item-chip__count">{equipped ? '裝備中' : `×${count}`}</span>
                          </button>
                        )
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>

        <div className="model-foot">
          點 Mobie 看資訊卡（招式 / 六維 / 個體）。道具效果：強化能力值（S1）/ 提升傷害（S3）/ 回合末回血（S4）。
        </div>
      </motion.div>
    </motion.div>

    {/* M16 資訊卡：自己的 Mobie 一律全顯（招式/數值/個體/特性/道具）。
        置於 backdrop 之外的 sibling，避免點 MobCard 背景冒泡關掉整個隊伍頁。 */}
    <AnimatePresence>
      {detail && <MobCard mon={detail} owner revealed onClose={() => setDetail(null)} />}
    </AnimatePresence>
    </>
  )
}
