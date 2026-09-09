import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '@/app/GameProvider'
import { TEAM_SIZE } from '@/game/machine/gameMachine'
import { useRoster } from '@/store/rosterStore'
import { usePlayerSkills } from '@/store/playerSkillsStore'
import { PRODUCT_RUNTIME } from '@/game/ext/productRuntime'
import { ownedToCard, growthProgress } from '@/game/growth'
import { buildBattleMobie } from '@/game/stats'
import { scoreCardVsFoes, recommendTeamIds, type Matchup } from '@/game/recommend'
import { audio } from '@/audio/audioEngine'
import type { BattleMobie, Card, OwnedUnit, TypeName } from '@/game/types'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'
import { IndividualInfo } from '@/ui/components/IndividualInfo'
import { MobCard } from '@/ui/components/MobCard'
import { captureTargetOf } from '@/game/hunt'
import { canCaptureIn, lookupRegion } from '@/game/data/regionLookup'
import { rollEncounterAccidents } from '@/game/accidents'
import { useAccidents } from '@/store/accidentStore'
import { getItem } from '@/game/ext/items'
import { abilityForType, getAbility } from '@/game/ext/abilities'
import { CHAIN_RULES } from '@/game/ext/chain'
import { COMBO_DEFS, matchCombo, type ComboDef } from '@/game/ext/combo'
import { SYNERGY_RULES } from '@/game/ext/synergy'
import { PARTNER_SKILLS, isPartnerSkillLearned } from '@/game/ext/partnerSkills'
import { evolvedSpeciesId } from '@/game/ext/evolution'
import { getSpecies } from '@/game/data/species'
import { lookupTerrain } from '@/game/data/terrains'
import { TYPE_LABEL_ZH } from '@/ui/typeMeta'
import { useOverlayController } from '@/ui/shell/OverlayController'
const TEAM_PAGE_SIZE = 24
const TEAM_DRAFTS = new Map<string, string[]>()

function encounterDraftKey(regionId: string | null, foes: readonly Card[]): string {
  return `${regionId ?? 'none'}:${foes.map((card) => card.cardId).join('|')}`
}
interface CardEntry {
  card: Card
  mon: BattleMobie
  unit: OwnedUnit
}
function synergyCondition(id: string, team: readonly BattleMobie[]): string {
  if (id === 'diverse') {
    const types = new Set(team.flatMap((mon) => mon.types)).size
    return `至少涵蓋 3 種屬性（目前 ${types} 種）`
  }
  if (id === 'kinship') {
    const counts = new Map<TypeName, number>()
    for (const mon of team)
      for (const type of new Set(mon.types))
        counts.set(type, (counts.get(type) ?? 0) + 1)
    const shared = [...counts.entries()].find(([, count]) => count >= 2)?.[0]
    return shared ? `至少 2 隻共享${TYPE_LABEL_ZH[shared]}屬性（目前已成立）` : '至少 2 隻共享一種屬性'
  }
  const generations = new Set(team.map((mon) => mon.speciesId <= 151 ? 1 : 2))
  if (team.length < 2) return '全隊同世代，至少 2 隻'
  if (generations.size === 1) return '全隊同世代，至少 2 隻（目前已成立）'
  return '全隊同世代，至少 2 隻（目前混合世代）'
}
function comboRequirement(def: ComboDef, team: readonly BattleMobie[]): {
  text: string
  active: boolean
} {
  if (def.requires.typePair) {
    const [first, second] = def.requires.typePair
    return {
      text: `需要${TYPE_LABEL_ZH[first]}＋${TYPE_LABEL_ZH[second]}屬性隊員；編隊符合後，需由符合配對的隊員參與連鎖（每組合每場一次）`,
      active: Boolean(matchCombo([...team], [def], [])),
    }
  }
  const [first, second] = def.requires.speciesPair ?? []
  const firstName = first === undefined ? '未知' : getSpecies(first).nameZh
  const secondName = second === undefined ? '未知' : getSpecies(second).nameZh
  return {
    text: `需要${firstName}＋${secondName}；編隊符合後，需由符合配對的隊員參與連鎖（每組合每場一次）`,
    active: Boolean(matchCombo([...team], [def], [])),
  }
}
function comboEffect(def: ComboDef): string {
  const cast = def.cast
  if (cast.kind === 'infuseTerrain') {
    const terrain = lookupTerrain(cast.terrainId)
    return `威力 ×${def.power}；灌注${terrain?.icon ?? ''}${terrain?.name ?? cast.terrainId} ${cast.turns} 回合`
  }
  const stat: Record<string, string> = { atk: '攻擊', def: '防禦', spa: '特攻', spd: '特防' }
  const verb = cast.kind === 'teamBuff' ? '我方' : '敵方'
  const direction = cast.kind === 'teamBuff' ? '提升' : '降低'
  return `威力 ×${def.power}；${verb}${stat[cast.stat] ?? cast.stat}${direction}至 ×${cast.mult}，${cast.turns} 回合`
}
function evolutionCopy(unit: OwnedUnit): string {
  const species = getSpecies(unit.speciesId)
  if (species.evolvesTo === undefined || species.evolveLevel === undefined)
    return '已達最終形態'
  const readyId = evolvedSpeciesId(unit)
  const targetId = readyId ?? species.evolvesTo
  const target = getSpecies(targetId)
  if (readyId !== null)
    return `可進化為 ${target.nameZh}（目前 Lv.${unit.level}）`
  return `Lv.${species.evolveLevel} 進化為 ${target.nameZh}（還需 ${Math.max(0, species.evolveLevel - unit.level)} 級）`
}
function modeLabel(mode: 'active' | 'support'): string {
  return mode === 'active' ? '戰中主動' : '全隊支援'
}
function SelectedTeam({ entries, busy, onRemove, onMove, }: {
  entries: CardEntry[]
  busy: boolean
  onRemove: (id: string) => void
  onMove: (id: string, delta: -1 | 1) => void
}) {
  return (<section className="team-composer" aria-labelledby="team-composer-title" data-team-composer>
   <div className="team-composer__head">
    <div>
     <div className="eyebrow">Your battle team</div>
     <h2 id="team-composer-title">我的出戰隊伍</h2>
    </div>
    <span className="team-composer__count">已選 {entries.length}/{TEAM_SIZE}</span>
   </div>
   <div className="team-composer__slots" role="list" aria-label="已選出戰順序">
    {entries.map(({ card, mon, unit }, index) => {
      const item = getItem(mon.heldItemId)
      const ability = getAbility(abilityForType(mon.types[0]))
      return (<article key={card.cardId} className="team-composer__slot" role="listitem" data-team-slot={index + 1}>
       <div className="team-composer__slot-number" aria-label={`第 ${index + 1} 位`}>{index + 1}</div>
       <div className="team-composer__slot-art"><MobieSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny}/></div>
       <div className="team-composer__slot-body">
        <div className="team-composer__slot-name">{mon.nameZh}</div>
        <div className="team-composer__slot-meta">Lv.{mon.level} · {index === 0 ? '先發' : `後備 ${index}`}</div>
        <div className="team-composer__slot-effects">
         {ability && <span title={ability.desc}>{ability.icon} {ability.name}</span>}
         <span title={item?.desc}>{item ? `${item.icon} ${item.name}` : '未裝備道具'}</span>
        </div>
        <div className="team-composer__slot-evolution">{evolutionCopy(unit)}</div>
       </div>
       <div className="team-composer__slot-actions" aria-label={`${mon.nameZh} 順序操作`}>
        <button type="button" className="team-composer__move" aria-label={`將 ${mon.nameZh} 往前移到第 ${index} 位`} disabled={busy || index === 0} onClick={() => onMove(card.cardId, -1)}>↑</button>
        <button type="button" className="team-composer__move" aria-label={`將 ${mon.nameZh} 往後移到第 ${index + 2} 位`} disabled={busy || index === entries.length - 1} onClick={() => onMove(card.cardId, 1)}>↓</button>
        <button type="button" className="team-composer__remove" aria-label={`從出戰隊伍移除 ${mon.nameZh}`} disabled={busy} onClick={() => onRemove(card.cardId)}>移除</button>
       </div>
      </article>)
    })}
    {entries.length === 0 && <div className="team-composer__empty" data-team-empty-slot><span className="team-composer__empty-plus" aria-hidden="true">＋</span><span>請從下方 roster 選擇 3 隻 Mobie</span></div>}
    {entries.length > 0 && entries.length < TEAM_SIZE && <div className="team-composer__empty" data-team-missing-slot><span className="team-composer__empty-plus" aria-hidden="true">＋</span><span>還需選擇 {TEAM_SIZE - entries.length} 隻</span></div>}
   </div>
  </section>)
}
function FixedSystems({ entries, mons, learnedSkillIds }: {
  entries: CardEntry[]
  mons: BattleMobie[]
  learnedSkillIds: string[]
}) {
  const activeModifiers = useMemo(() => PRODUCT_RUNTIME.previewPlayerSynergy(mons), [mons])
  const activeSynergies = useMemo(() => new Set(activeModifiers.map((modifier) => modifier.label)), [activeModifiers])
  const comboStates = useMemo(() => COMBO_DEFS.map((def) => ({ def, ...comboRequirement(def, mons) })), [mons])
  return (<section className="team-systems" aria-labelledby="team-systems-title" data-fixed-systems>
   <div className="team-systems__head">
    <div><div className="eyebrow">Product systems</div><h2 id="team-systems-title">固定戰術回饋</h2></div>
    <span className="h-sub">選擇變更後即時更新；所有功能固定啟用</span>
   </div>
   <div className="team-systems__grid">
    <article className="team-system-card" data-system="synergy">
      <div className="team-system-card__title">🧬 隊伍羈絆</div>
      <ul className="team-system-card__list">
        {SYNERGY_RULES.map((rule) => {
          const active = activeSynergies.has(rule.modifier.label)
          return (
            <li key={rule.id} className={active ? 'team-system-card__item--active' : ''}>
              <span aria-hidden="true">{rule.icon}</span>
              <span className="team-system-card__copy">
                <b>{rule.label}</b>
                <span>{rule.modifier.label}</span>
                <small>{synergyCondition(rule.id, mons)}</small>
              </span>
              <strong>{active ? '已成立' : '待成形'}</strong>
            </li>
          )
        })}
      </ul>
    </article>

    <article className="team-system-card" data-system="loadout">
      <div className="team-system-card__title">🛡️ 特性與持有道具</div>
      {entries.length === 0 ? (
        <p className="team-system-card__empty">選人後顯示每隻的真實特性與道具效果。</p>
      ) : (
        <ul className="team-system-card__list">
          {entries.map(({ card, mon }) => {
            const ability = getAbility(abilityForType(mon.types[0]))
            const item = getItem(mon.heldItemId)
            return (
              <li key={card.cardId}>
                <span aria-hidden="true">{mon.shiny ? '✦' : '•'}</span>
                <span className="team-system-card__copy">
                  <b>{mon.nameZh}</b>
                  <span>{ability ? `${ability.icon} ${ability.name}：${ability.desc}` : '特性資料尚未提供'}</span>
                  <small>{item ? `${item.icon} ${item.name}：${item.desc}` : '未裝備持有道具'}</small>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </article>

    <article className="team-system-card" data-system="chain-combo">
     <div className="team-system-card__title">⛓️ 連鎖與合體技</div>
     <div className="team-system-card__rule"><b>連鎖攻擊</b><span>連鎖槽滿 {CHAIN_RULES.gaugeFull} 後，最多 {CHAIN_RULES.maxHits} 隻存活隊友連續出擊；每次命中 +{CHAIN_RULES.gainBase}。</span></div>
      <ul className="team-system-card__list team-system-card__list--compact">
        {comboStates.map(({ def, active, text }) => (
          <li key={def.id} className={active ? 'team-system-card__item--active' : ''}>
            <span aria-hidden="true">{def.icon}</span>
            <span className="team-system-card__copy">
              <b>{def.name}</b>
              <span>{comboEffect(def)}</span>
              <small>{text}</small>
            </span>
            <strong>{active ? '編隊符合' : '待成形'}</strong>
          </li>
        ))}
      </ul>
    </article>

    <article className="team-system-card" data-system="evolution-partner">
     <div className="team-system-card__title">✨ 進化與夥伴技能</div>
      {entries.length > 0 && (
        <ul className="team-system-card__list team-system-card__list--compact">
          {entries.map(({ card, unit }) => (
            <li key={card.cardId}>
              <span aria-hidden="true">🧬</span>
              <span className="team-system-card__copy">
                <b>{getSpecies(unit.speciesId).nameZh}</b>
                <span>{evolutionCopy(unit)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="team-system-card__list team-system-card__list--compact">
        {PARTNER_SKILLS.map((skill) => {
          const learned = isPartnerSkillLearned(skill.id, learnedSkillIds)
          return (
            <li key={skill.id} className={learned ? 'team-system-card__item--active' : ''}>
              <span aria-hidden="true">{skill.icon}</span>
              <span className="team-system-card__copy">
                <b>{skill.name} <small>（{modeLabel(skill.mode)}）</small></b>
                <span>{skill.desc}</span>
                <small>{learned ? '已習得，可在合法戰鬥階段使用' : `未習得；需要 SP ${skill.cost}`}</small>
              </span>
              <strong>{learned ? '可用' : '未習得'}</strong>
            </li>
          )
        })}
      </ul>
    </article>
   </div>
  </section>)
}
function AdvicePanel({
  entries,
  matchups,
}: {
  entries: CardEntry[]
  matchups: Record<string, Matchup>
}) {
  return (
    <section
      className="team-select-advice"
      id="team-select-advice"
      aria-labelledby="team-select-advice-title"
      aria-live="polite"
      data-team-advice
    >
      <div className="team-select-advice__head">
        <div>
          <div className="eyebrow">Recommendation</div>
          <h2 id="team-select-advice-title">對手整隊的剋制建議</h2>
        </div>
        <span className="h-sub">不會自動選人，也不會改變你的出戰順序</span>
      </div>
      {entries.length > 0 ? (
        <ol className="team-select-advice__list">
          {entries.map(({ card, mon }, index) => {
            const matchup = matchups[card.cardId]
            return (
              <li key={card.cardId}>
                <span className="team-select-advice__rank">{index + 1}</span>
                <span className="team-select-advice__copy">
                  <b>{mon.nameZh} Lv.{mon.level}</b>
                  <span>
                    進攻：{matchup.counters > 0 ? `可克制 ${matchup.counters} 名對手` : '缺少明顯屬性克制'}；
                    風險：{matchup.weakTo > 0 ? `會被 ${matchup.weakTo} 名對手克制` : '未發現明顯屬性弱點'}
                  </span>
                </span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="team-select-advice__empty">目前沒有可供比較的 Mobie；返回遭遇不會遺失本次對手資料。</p>
      )}
    </section>
  )
}

function EncounterSummary({
  regionName,
  captureEligible,
  target,
  effectiveExpMult,
  captureMult,
  selectedSupply,
  hasSupply,
  foes,
  onOpenCard,
}: {
  regionName: string
  captureEligible: boolean
  target: BattleMobie | null
  effectiveExpMult: number
  captureMult: number
  selectedSupply: { label: string; desc: string } | null
  hasSupply: boolean
  foes: BattleMobie[]
  onOpenCard: (mon: BattleMobie, owner: boolean, invoker: HTMLButtonElement, id: string) => void
}) {
  return (
    <div className="team-select__fixed-context" data-team-fixed-context>
      <div className="encounter-context encounter-context--team" data-encounter-context data-team-encounter-context>
        <div className="encounter-context__title">
          <span className="eyebrow">Encounter handoff</span>
          <span className="h-sub">
            {regionName} · {captureEligible ? '勝利後可嘗試收服 featured target' : '本場只結算經驗'}
          </span>
        </div>
        <div className="encounter-context__flags" data-accident-flags>
          {target && (
            <span className="accident-tag">
              🎯 {captureEligible ? `捕獲承諾：${target.nameZh}` : `對戰主將：${target.nameZh}`}
            </span>
          )}
          {effectiveExpMult > 1 && <span className="accident-tag">🍀 勝利經驗 ×{effectiveExpMult}</span>}
          {captureMult > 1 && <span className="accident-tag">🎯 捕獲率加成 ×{captureMult}</span>}
          {selectedSupply && (
            <span className="accident-tag accident-tag--supply" title={selectedSupply.desc}>
              📦 {selectedSupply.label}：{selectedSupply.desc}
            </span>
          )}
          {!selectedSupply && hasSupply && (
            <span className="accident-tag accident-tag--supply">📦 補給狀態：已進入本場遭遇</span>
          )}
        </div>
      </div>
      <div className="foe-strip" data-team-opponent-summary>
        <span className="foe-strip__label capture-target-label">
          {target ? `${captureEligible ? '可收服目標' : '對戰主將'}：${target.nameZh}` : '對手'}
        </span>
        <div className="foe-strip__list">
          {foes.map((foe, index) => (
            <button
              key={`${foe.speciesId}-${index}`}
              className={`foe-strip__mon ${index === foes.length - 1 ? 'foe-strip__mon--boss' : ''}`}
              title={`${foe.nameZh} Lv.${foe.level}（看資訊卡）`}
              aria-label={`${foe.nameZh}，${captureEligible && index === foes.length - 1 ? '可收服目標' : '對手隊伍成員'}`}
              onClick={(event) => onOpenCard(foe, false, event.currentTarget, `foe-${index}`)}
            >
              <span className="foe-strip__art">
                <MobieSprite src={foe.artworkUrl} alt={foe.nameZh} shiny={foe.shiny} />
              </span>
              <div className="foe-strip__types"><TypeBadges types={foe.types} /></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function TeamRoster({
  cards,
  visibleCards,
  matchups,
  recommendedSet,
  picked,
  adviceShown,
  submitBusy,
  pageCount,
  visiblePage,
  onToggle,
  onOpenCard,
  onPageChange,
}: {
  cards: CardEntry[]
  visibleCards: CardEntry[]
  matchups: Record<string, Matchup>
  recommendedSet: ReadonlySet<string>
  picked: string[]
  adviceShown: boolean
  submitBusy: boolean
  pageCount: number
  visiblePage: number
  onToggle: (cardId: string) => void
  onOpenCard: (mon: BattleMobie, owner: boolean, invoker: HTMLButtonElement, id: string) => void
  onPageChange: (page: number) => void
}) {
  return (
    <section
      className="team-select-roster"
      aria-labelledby="team-roster-title"
      data-team-roster
      data-roster-page-size={TEAM_PAGE_SIZE}
      data-roster-visible-count={visibleCards.length}
    >
      <div className="team-select-roster__head">
        <div>
          <div className="eyebrow">Mobie roster</div>
          <h2 id="team-roster-title">Mobie 名單</h2>
        </div>
        <span className="team-select-roster__count">顯示 {visibleCards.length} / 共 {cards.length}</span>
      </div>
      <div className="hand team-select-roster__grid" role="list" aria-label="可選 Mobie" data-roster-grid>
        {visibleCards.map(({ card, mon, unit }, index) => {
          const matchup = matchups[card.cardId]
          const isRecommended = recommendedSet.has(card.cardId)
          const order = picked.indexOf(card.cardId)
          const isPicked = order >= 0
          const positionLabel = order === 0 ? '先發' : `後備 ${order}`
          const item = getItem(mon.heldItemId)
          const ability = getAbility(abilityForType(mon.types[0]))
          const growth = growthProgress(unit.level, unit.exp)
          return (
            <motion.article
              key={card.cardId}
              className={`poke-card ${isPicked ? 'poke-card--picked' : ''} ${adviceShown && isRecommended ? 'poke-card--rec' : ''}`}
              role="listitem"
              data-card-id={card.cardId}
              data-card-picked={isPicked ? 'true' : 'false'}
              initial={{ opacity: 0, rotateY: 35, y: 20 }}
              animate={{ opacity: 1, rotateY: 0, y: 0 }}
              transition={{ delay: 0.03 * index, type: 'spring', stiffness: 150, damping: 16 }}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('button')) return
                onToggle(card.cardId)
              }}
            >
              <button
                type="button"
                className="poke-card__select"
                aria-label={isPicked ? `取消選擇 ${mon.nameZh}，${positionLabel}` : `選擇 ${mon.nameZh}`}
                aria-pressed={isPicked}
                data-card-select
                disabled={submitBusy}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggle(card.cardId)
                }}
              >
                <span className="poke-card__lv">Lv.{mon.level}</span>
                <div className="matchup-badges">
                  {matchup.counters > 0 && <span className="matchup-badge matchup-badge--good">剋 {matchup.counters}</span>}
                  {matchup.weakTo > 0 && <span className="matchup-badge matchup-badge--bad">弱 {matchup.weakTo}</span>}
                </div>
                {adviceShown && isRecommended && <span className="poke-card__rec">⭐ 建議候選</span>}
                {adviceShown && (
                  <span className="col matchup-advice" style={{ gap: 2 }}>
                    <span className="matchup-advice__upside">
                      進攻：{matchup.counters > 0 ? `可克制 ${matchup.counters} 名對手` : '缺少明顯屬性克制'}
                    </span>
                    <span className="matchup-advice__risk">
                      風險：{matchup.weakTo > 0 ? `會被 ${matchup.weakTo} 名對手克制` : '未發現明顯屬性弱點'}
                    </span>
                  </span>
                )}
                {isPicked && <span className="poke-card__pick">{positionLabel}</span>}
                <div className="poke-card__art">
                  <MobieSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} />
                </div>
                <div className="poke-card__name">{mon.nameZh}</div>
                <div className="poke-card__types"><TypeBadges types={mon.types} /></div>
                <div className="poke-card__features">
                  {ability && <span title={ability.desc}>特性：{ability.icon} {ability.name}</span>}
                  <span title={item?.desc}>道具：{item ? `${item.icon} ${item.name}` : '未裝備'}</span>
                </div>
                <div className="poke-card__growth" aria-label={`${mon.nameZh} EXP 進度`}>
                  {growth.atMaxLevel ? '已達滿級' : `EXP ${growth.earnedExp}/${growth.requiredExp}`}
                </div>
                <IndividualInfo mon={mon} />
              </button>
              <button
                type="button"
                className="poke-card__info"
                aria-label={`查看${mon.nameZh}資訊卡`}
                title="查看資訊卡"
                data-card-info
                disabled={submitBusy}
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenCard(mon, true, event.currentTarget, card.cardId)
                }}
              >
                ⓘ
              </button>
            </motion.article>
          )
        })}
      </div>
      {pageCount > 1 && (
        <nav className="team-select-pagination" aria-label="Mobie 名單分頁" data-roster-pagination>
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={visiblePage === 0 || submitBusy}
            onClick={() => onPageChange(Math.max(0, visiblePage - 1))}
          >
            上一頁
          </button>
          <span aria-live="polite">第 {visiblePage + 1} / {pageCount} 頁</span>
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={visiblePage >= pageCount - 1 || submitBusy}
            onClick={() => onPageChange(Math.min(pageCount - 1, visiblePage + 1))}
          >
            下一頁
          </button>
        </nav>
      )}
    </section>
  )
}

function EmptyRoster({ loaded, busy, onBack }: { loaded: boolean; busy: boolean; onBack: () => void }) {
  return (
    <section className="team-select-empty" role="status" data-team-select-empty>
      <div className="eyebrow">Roster empty</div>
      <h2>{loaded ? '目前沒有可用 Mobie' : '正在載入 Mobie…'}</h2>
      <p>
        {loaded
          ? '請返回遭遇，或先從收藏取得夥伴；目前不會指向未啟用的掃卡入口。'
          : '資料準備完成後會顯示可選的隊員。'}
      </p>
      <button className="btn btn--ghost" onClick={onBack} disabled={busy}>返回 Encounter</button>
    </section>
  )
}

function StartFooter({
  ready,
  busy,
  count,
  reason,
  onEngage,
}: {
  ready: boolean
  busy: boolean
  count: number
  reason: string
  onEngage: () => void
}) {
  return (
    <div className="team-select__footer" data-team-start-footer>
      {!ready && <p id="team-select-start-reason" className="team-select__start-reason" role="status">{reason}</p>}
      {busy && <p className="team-select__start-busy" role="status" aria-live="polite">正在把 {TEAM_SIZE} 人隊伍交給 Battle…</p>}
      <motion.button
        className="btn team-select__start"
        style={{ fontSize: 19, padding: '16px 48px' }}
        animate={{ opacity: ready && !busy ? 1 : 0.5 }}
        whileTap={ready && !busy ? { scale: 0.96 } : undefined}
        disabled={!ready || busy}
        aria-describedby={!ready ? 'team-select-start-reason' : undefined}
        aria-busy={busy}
        onClick={onEngage}
      >
        ⚔ 出戰　<span style={{ fontSize: 14, opacity: 0.85 }}>{count}/{TEAM_SIZE}</span>
      </motion.button>
    </div>
  )
}

export function CardSelectScreen() {
  const { context, send } = useGame()
  const foes = useMemo(() => context.foeTeam.map(buildBattleMobie), [context.foeTeam])
  const target = captureTargetOf(foes) ?? null
  const captureEligible = canCaptureIn(context.regionId)
  const region = useMemo(() => {
    if (!context.regionId) return null
    try { return lookupRegion(context.regionId) } catch { return null }
  }, [context.regionId])
  const encounterAccidents = useMemo(
    () => region ? rollEncounterAccidents(region, context.foeTeam) : { luckyExpMult: 1, supply: null },
    [context.foeTeam, region],
  )
  const expMult = useAccidents((s) => s.expMult)
  const captureMult = useAccidents((s) => s.captureMult)
  const supplyKind = useAccidents((s) => s.supplyKind)
  const effectiveExpMult = Math.max(encounterAccidents.luckyExpMult, expMult)
  const selectedSupply = encounterAccidents.supply?.find((option) => option.kind === supplyKind) ?? null
  const [adviceShown, setAdviceShown] = useState(false)
  const [visiblePage, setVisiblePage] = useState(0)
  const [submitBusy, setSubmitBusy] = useState(false)
  const submitRef = useRef(false)
  const controller = useOverlayController()
  const draftKey = encounterDraftKey(context.regionId, context.foeTeam)
  const roster = useRoster((s) => s.roster)
  const loaded = useRoster((s) => s.loaded)
  const learnedSkillIds = usePlayerSkills((s) => s.learnedSkillIds)
  const cards = useMemo<CardEntry[]>(
    () => roster.map((unit) => {
      const card = ownedToCard(unit)
      return { card, mon: buildBattleMobie(card), unit }
    }),
    [roster],
  )
  const cardsById = useMemo(() => new Map(cards.map((entry) => [entry.card.cardId, entry])), [cards])
  const [picked, setPicked] = useState<string[]>(() => TEAM_DRAFTS.get(draftKey)?.slice(0, TEAM_SIZE) ?? [...new Set(context.playerTeam.map((card) => card.cardId))].slice(0, TEAM_SIZE))

  useEffect(() => {
    setPicked((previous) => [...new Set(previous)].filter((id) => cardsById.has(id)).slice(0, TEAM_SIZE))
  }, [cardsById])

  const matchups = useMemo(() => {
    const result: Record<string, Matchup> = {}
    for (const entry of cards) result[entry.card.cardId] = scoreCardVsFoes(entry.mon, foes)
    return result
  }, [cards, foes])
  const recommendedIds = useMemo(
    () => recommendTeamIds(cards.map((entry) => ({ id: entry.card.cardId, mon: entry.mon })), foes, TEAM_SIZE),
    [cards, foes],
  )
  const recommendedSet = useMemo(() => new Set(recommendedIds), [recommendedIds])
  const recommendedEntries = useMemo(
    () => recommendedIds.map((id) => cardsById.get(id)).filter((entry): entry is CardEntry => Boolean(entry)),
    [cardsById, recommendedIds],
  )
  const pickedEntries = useMemo(
    () => picked.map((id) => cardsById.get(id)).filter((entry): entry is CardEntry => Boolean(entry)),
    [cardsById, picked],
  )
  const pickedMons = useMemo(() => pickedEntries.map((entry) => entry.mon), [pickedEntries])
  const pageCount = Math.max(1, Math.ceil(cards.length / TEAM_PAGE_SIZE))
  const visibleCards = cards.slice(visiblePage * TEAM_PAGE_SIZE, (visiblePage + 1) * TEAM_PAGE_SIZE)
  const ready = pickedEntries.length === TEAM_SIZE
  const startReason = cards.length === 0
    ? loaded ? '目前沒有可用 Mobie，請返回遭遇或先取得夥伴。' : 'Mobie 資料準備中，完成後才能出戰。'
    : `還需選擇 ${Math.max(0, TEAM_SIZE - pickedEntries.length)} 隻 Mobie，才能出戰。`

  useEffect(() => {
    if (visiblePage >= pageCount) setVisiblePage(pageCount - 1)
  }, [pageCount, visiblePage])

  const openCard = useCallback((mon: BattleMobie, owner: boolean, invoker: HTMLButtonElement, id: string) => {
    audio.play('select')
    controller.push({
      id: `team-card:${id}`,
      policy: 'escape-and-backdrop',
      content: <MobCard mon={mon} owner={owner} revealed={false} onClose={controller.pop} />,
    }, { invoker })
  }, [controller])
  const handleBack = useCallback(() => {
    if (submitRef.current) return
    TEAM_DRAFTS.set(draftKey, picked)
    send({ type: 'BACK' })
  }, [draftKey, picked, send])
  const toggle = useCallback((cardId: string) => {
    if (submitRef.current) return
    audio.play('select')
    setPicked((previous) => {
      if (previous.includes(cardId)) return previous.filter((id) => id !== cardId)
      if (previous.length >= TEAM_SIZE || !cardsById.has(cardId)) return previous
      return [...previous, cardId]
    })
  }, [cardsById])
  const remove = useCallback((cardId: string) => {
    if (submitRef.current) return
    audio.play('select')
    setPicked((previous) => previous.filter((id) => id !== cardId))
  }, [])
  const move = useCallback((cardId: string, delta: -1 | 1) => {
    if (submitRef.current) return
    setPicked((previous) => {
      const index = previous.indexOf(cardId)
      const nextIndex = index + delta
      if (index < 0 || nextIndex < 0 || nextIndex >= previous.length) return previous
      const next = [...previous]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }, [])
  const engage = useCallback(() => {
    if (submitRef.current || !ready) return
    const chosen = pickedEntries.map((entry) => entry.card)
    if (chosen.length !== TEAM_SIZE) return
    submitRef.current = true
    TEAM_DRAFTS.delete(draftKey)
    setSubmitBusy(true)
    audio.play('select')
    send({ type: 'SELECT_TEAM', cards: chosen })
  }, [draftKey, pickedEntries, ready, send])

  return (
    <div
      className="team-select-screen"
      data-team-select
      data-team-select-state={cards.length === 0 ? 'empty' : ready ? 'ready' : 'incomplete'}
      data-team-select-busy={submitBusy ? 'true' : 'false'}
    >
      <div className="team-select__topbar">
        <button className="btn btn--ghost" style={{ padding: '10px 18px' }} onClick={handleBack} disabled={submitBusy}>
          ← 返回
        </button>
        <motion.button
          className="btn btn--ghost team-select__advice-button"
          style={{ padding: '12px 18px', whiteSpace: 'nowrap', fontSize: 15 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => { audio.play('select'); setAdviceShown((shown) => !shown) }}
          aria-label={adviceShown ? '收起建議' : '顯示建議'}
          aria-pressed={adviceShown}
          aria-controls="team-select-advice"
          disabled={submitBusy}
        >
          💡 {adviceShown ? '收起建議' : '顯示建議'}
        </motion.button>
      </div>
      <header className="team-select__header">
        <div className="eyebrow">Step 2 · 組你的隊伍</div>
        <h1 className="h-title">選擇出戰 Mobie</h1>
        <p className="h-sub">挑 {TEAM_SIZE} 隻組隊；第一隻是先發，其餘依序後備。推薦只提供參考，不會代替你選隊。</p>
      </header>

      <EncounterSummary
        regionName={region?.name ?? '目前區域'}
        captureEligible={captureEligible}
        target={target}
        effectiveExpMult={effectiveExpMult}
        captureMult={captureMult}
        selectedSupply={selectedSupply}
        hasSupply={Boolean(encounterAccidents.supply)}
        foes={foes}
        onOpenCard={openCard}
      />

      {adviceShown && <AdvicePanel entries={recommendedEntries} matchups={matchups} />}
      <SelectedTeam entries={pickedEntries} busy={submitBusy} onRemove={remove} onMove={move} />

      {cards.length === 0 ? (
        <EmptyRoster loaded={loaded} busy={submitBusy} onBack={handleBack} />
      ) : (
        <TeamRoster
          cards={cards}
          visibleCards={visibleCards}
          matchups={matchups}
          recommendedSet={recommendedSet}
          picked={picked}
          adviceShown={adviceShown}
          submitBusy={submitBusy}
          pageCount={pageCount}
          visiblePage={visiblePage}
          onToggle={toggle}
          onOpenCard={openCard}
          onPageChange={setVisiblePage}
        />
      )}

      <FixedSystems entries={pickedEntries} mons={pickedMons} learnedSkillIds={learnedSkillIds} />
      <StartFooter ready={ready} busy={submitBusy} count={pickedEntries.length} reason={startReason} onEngage={engage} />
    </div>
  )
}
