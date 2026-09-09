import type { BattleMobie, Move, Stats } from '@/game/types'
import type { Ref } from 'react'
import { IndividualInfo } from '@/ui/components/IndividualInfo'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'
import { getItem } from '@/game/ext/items'
import { getAbility } from '@/game/ext/abilities'
import { TYPE_LABEL_ZH, typeColor } from '@/ui/typeMeta'
import { growthProgress } from '@/game/growth'
import { ModalSurface } from '@/ui/shell/ModalSurface'

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

function cardTitle(mon: BattleMobie): string {
  return `${mon.nameZh} Lv.${mon.level}${mon.shiny ? ' ✦異色' : ''}`
}

function cardDescription(mon: BattleMobie, owner: boolean, revealed: boolean) {
  return (
    <>
      <TypeBadges types={mon.types} />
      {!owner && <span style={{ marginLeft: 8 }}>{revealed ? '已看穿' : '對手 · 基本面'}</span>}
    </>
  )
}

function CardSections({ mon, owner, ownerExp, revealed }: {
  mon: BattleMobie
  owner: boolean
  ownerExp?: number
  revealed: boolean
}) {
  const showDeep = owner || revealed
  const item = getItem(mon.heldItemId)
  const ability = getAbility(mon.abilityId)
  const ownerGrowth = ownerExp === undefined ? null : growthProgress(mon.level, ownerExp)

  return (
    <>
      {owner && ownerExp !== undefined && (
        <div className="mobcard-growth" data-mobcard-exp>
          <span>總 EXP {ownerExp}</span>
          <span>{ownerGrowth?.atMaxLevel ? '已達滿級' : `距離 Lv.${mon.level + 1} 還需 ${ownerGrowth?.remainingExp ?? 0} EXP`}</span>
        </div>
      )}

      <div className="mobcard-sec">招式</div>
      {showDeep
        ? <div className="mobcard-moves">{mon.moves.map((mv, i) => <MoveRow key={i} move={mv} />)}</div>
        : <Masked label="看穿後揭露招式" />}

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
    </>
  )
}

export interface MobCardProps {
  mon: BattleMobie
  owner: boolean
  ownerExp?: number
  revealed: boolean
  onClose: () => void
  /** CollectionShell uses a non-modal detail panel on wide viewports. */
  layout?: 'modal' | 'panel'
  closeRef?: Ref<HTMLButtonElement>
}

/**
 * Mobie 資訊卡（M16，純 UI／顯示層，不動 reducer/engine/持久化）。
 * owner 或已看穿的對手會顯示完整深度資訊；未看穿的對手只顯示基本面和遮罩。
 */
export function MobCard({ mon, owner, ownerExp, revealed, onClose, layout = 'modal', closeRef }: MobCardProps) {
  const visibility = owner ? 'owner' : revealed ? 'opponent-revealed' : 'opponent-masked'
  const title = cardTitle(mon)
  const description = cardDescription(mon, owner, revealed)
  const className = `mobcard mobcard--${visibility}`

  if (layout === 'panel') {
    const titleId = `mobcard-panel-title-${mon.speciesId}-${mon.level}`
    return (
      <article
        className={`${className} mobcard--panel`}
        data-mobcard
        data-mobcard-layout="panel"
        data-mobcard-visibility={visibility}
        aria-labelledby={titleId}
      >
        <header className="mobcard-panel__head">
          <div className="mobcard-panel__heading">
            <div className="mobcard-panel__heading-row">
              <div className="mobcard__art"><MobieSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} /></div>
              <div>
                <h2 id={titleId} className="h-title mobcard-panel__title">{title}<span className="sr-only"> 完整資訊</span></h2>
                <p className="h-sub mobcard-panel__description">{description}</p>
              </div>
            </div>
          </div>
          <button ref={closeRef} className="btn btn--ghost btn--sm" data-mobcard-close onClick={onClose}>關閉</button>
        </header>
        <div className="mobcard-panel__body" data-mobcard-body>
          <CardSections mon={mon} owner={owner} ownerExp={ownerExp} revealed={revealed} />
        </div>
      </article>
    )
  }

  return (
    <ModalSurface
      title={<>{title}<span className="sr-only"> 完整資訊</span></>}
      description={description}
      onClose={onClose}
      className={className}
      headerLeading={<div className="mobcard__art"><MobieSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} /></div>}
      restoreFocus={false}
    >
      <div data-mobcard data-mobcard-layout="modal" data-mobcard-visibility={visibility}>
        <CardSections mon={mon} owner={owner} ownerExp={ownerExp} revealed={revealed} />
      </div>
    </ModalSurface>
  )
}
