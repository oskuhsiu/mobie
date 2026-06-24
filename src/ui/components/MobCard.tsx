import { motion } from 'framer-motion'
import type { BattleMobie, Move, Stats } from '@/game/types'
import { IndividualInfo } from '@/ui/components/IndividualInfo'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'
import { getItem } from '@/game/ext/items'
import { getAbility } from '@/game/ext/abilities'
import { TYPE_LABEL_ZH, typeColor } from '@/ui/typeMeta'

const STAT_ROWS: { key: keyof Stats; label: string }[] = [
  { key: 'hp', label: 'HP' }, { key: 'atk', label: '攻' }, { key: 'def', label: '防' },
  { key: 'spa', label: '特攻' }, { key: 'spd', label: '特防' }, { key: 'spe', label: '速' },
]
const STAT_MAX = 200 // 六維 mini-bar 視覺上限（夾 100%）
const catLabel = (c: Move['category']) => (c === 'physical' ? '物理' : c === 'special' ? '特殊' : '變化')

/** 一招 loadout row：名稱 + 型別 + 物理/特殊/變化 + 威力/命中（變化招顯效果）。 */
function MoveRow({ move }: { move: Move }) {
  return (
    <div className="mobcard-move" style={{ ['--mv' as string]: typeColor(move.type) }}>
      <span className="mobcard-move__name">{move.nameZh}</span>
      <span className="type-badge" style={{ background: typeColor(move.type) }}>{TYPE_LABEL_ZH[move.type]}</span>
      <span className="mobcard-move__cat">{catLabel(move.category)}</span>
      <span className="mobcard-move__stat">
        {move.category === 'status' ? `✦ ${move.effect?.label ?? '輔助'}` : `威力 ${move.power}・命中 ${move.accuracy}`}
      </span>
    </div>
  )
}

/** 深度資訊遮罩占位（對手未看穿時用）。 */
function Masked({ label }: { label: string }) {
  return <div className="mobcard-masked">🔍 {label}</div>
}

/**
 * Mobie 資訊卡（M16，純 UI／顯示層，不動 reducer/engine/持久化）。
 * 自己（owner）或已看穿（revealed）→ 全顯示招式/六維/星級/特性道具；對手未看穿 → 基本面（名/型別/Lv）+ 深度遮罩。
 * 看穿旗標由 M17 設（battleStore.revealedFoes）；M16 對手 revealed 恆 false → 顯占位「看穿後揭露」。
 */
export function MobCard({ mon, owner, revealed, onClose }: {
  mon: BattleMobie
  owner: boolean
  revealed: boolean
  onClose: () => void
}) {
  const showDeep = owner || revealed
  const item = getItem(mon.heldItemId)
  const ability = getAbility(mon.abilityId)

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal-card mobcard"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-card__head">
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <div className="mobcard__art"><MobieSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} /></div>
            <div>
              <div className="h-title" style={{ fontSize: 22 }}>
                {mon.nameZh} <span className="hpbar__lv">Lv.{mon.level}</span>
                {mon.shiny && <span className="indiv__shiny"> ✦異色</span>}
              </div>
              <div style={{ marginTop: 4 }}><TypeBadges types={mon.types} /></div>
              {!owner && <div className="h-sub" style={{ marginTop: 4 }}>{revealed ? '已看穿' : '對手 · 基本面'}</div>}
            </div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        {/* 招式 loadout（≤4） */}
        <div className="mobcard-sec">招式</div>
        {showDeep
          ? <div className="mobcard-moves">{mon.moves.map((mv, i) => <MoveRow key={i} move={mv} />)}</div>
          : <Masked label="看穿後揭露招式" />}

        {/* 六維 mini-bar */}
        <div className="mobcard-sec">能力值</div>
        {showDeep ? (
          <div className="mobcard-stats">
            {STAT_ROWS.map(({ key, label }) => {
              const val = key === 'hp' ? mon.maxHp : mon[key]
              return (
                <div key={key} className="mobcard-stat">
                  <span className="mobcard-stat__label">{label}</span>
                  <div className="mobcard-stat__track">
                    <div className="mobcard-stat__fill" style={{ width: `${Math.min(100, (val / STAT_MAX) * 100)}%` }} />
                  </div>
                  <span className="mobcard-stat__val">{val}</span>
                </div>
              )
            })}
          </div>
        ) : <Masked label="看穿後揭露數值" />}

        {/* 個體 / 特性 / 道具 */}
        <div className="mobcard-sec">個體</div>
        {showDeep ? (
          <div className="col" style={{ gap: 8 }}>
            <IndividualInfo mon={mon} detailed />
            <div className="mobcard-meta">
              <span>特性：{ability ? `${ability.icon} ${ability.name}` : '—'}</span>
              <span>道具：{item ? `${item.icon} ${item.name}` : '未裝備'}</span>
            </div>
          </div>
        ) : <Masked label="看穿後揭露星級・特性・道具" />}
      </motion.div>
    </motion.div>
  )
}
