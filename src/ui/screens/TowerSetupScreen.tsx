import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '@/app/GameProvider'
import { useBootstrap } from '@/app/bootstrapCoordinator'
import { TEAM_SIZE, type GameContext } from '@/game/machine/gameMachine'
import { useRoster } from '@/store/rosterStore'
import { useRun } from '@/store/runStore'
import { ownedToCard, growthProgress } from '@/game/growth'
import { buildBattleMobie } from '@/game/stats'
import { ASCENSIONS, floorReward, getAscension, towerExpMult } from '@/game/tower'
import { PRODUCT_RUNTIME } from '@/game/ext/productRuntime'
import { SYNERGY_RULES } from '@/game/ext/synergy'
import { audio } from '@/audio/audioEngine'
import type { BattleMobie, Card, OwnedUnit, TypeName } from '@/game/types'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'
import { GestureGate } from '@/ui/components/GestureGate'
import { useSettings } from '@/store/settingsStore'
import { interactModeOf } from '@/game/settings'
import { useOverlayController } from '@/ui/shell/OverlayController'
import { TYPE_LABEL_ZH } from '@/ui/typeMeta'
import { useRouteFocus } from '@/ui/accessibility/useRouteFocus'

const TEAM_PAGE_SIZE = 24
const TOWER_DRAFT_KEY = 'tower-setup'
const TOWER_DRAFTS = new Map<string, string[]>()

interface TowerCardEntry {
  card: Card
  mon: BattleMobie
  unit: OwnedUnit
}

function hasStaleTowerContext(context: GameContext): boolean {
  return Boolean(
    context.tower
    || context.foeTeam.length > 0
    || context.playerTeam.length > 0
    || context.outcome
    || context.battleResult
    || context.captured,
  )
}

function synergyCondition(id: string, team: readonly BattleMobie[]): string {
  if (id === 'diverse') {
    const types = new Set(team.flatMap((mon) => mon.types)).size
    return `至少涵蓋 3 種屬性（目前 ${types} 種）`
  }
  if (id === 'kinship') {
    const counts = new Map<TypeName, number>()
    for (const mon of team) {
      for (const type of new Set(mon.types)) counts.set(type, (counts.get(type) ?? 0) + 1)
    }
    const shared = [...counts.entries()].find(([, count]) => count >= 2)?.[0]
    return shared ? `至少 2 隻共享${TYPE_LABEL_ZH[shared]}屬性（目前已成立）` : '至少 2 隻共享一種屬性'
  }
  const generations = new Set(team.map((mon) => mon.speciesId <= 151 ? 1 : 2))
  if (team.length < 2) return '全隊同世代，至少 2 隻'
  return generations.size === 1
    ? '全隊同世代，至少 2 隻（目前已成立）'
    : '全隊同世代，至少 2 隻（目前混合世代）'
}

function ascensionEffectCopy(level: number): string {
  const tier = getAscension(level)
  if (tier.levelBonus === 0) return '敵人等級不加成；使用標準 SP 獎勵。'
  return `敵人等級 +${tier.levelBonus}；每層 SP 獎勵依既有規則增加 ${tier.level}。`
}

function ascensionUnlockCopy(level: number): string {
  if (level === 0) return '初始難度，進入遊戲即可使用。'
  const prerequisite = getAscension(level - 1)
  return `解鎖條件：以「${prerequisite.name}」難度在任一 BOSS 層勝出（第 5、10、15…層）。`
}

function SelectedTowerTeam({
  entries,
  busy,
  onRemove,
  onMove,
}: {
  entries: TowerCardEntry[]
  busy: boolean
  onRemove: (id: string) => void
  onMove: (id: string, delta: -1 | 1) => void
}) {
  return (
    <section className="team-composer tower-team-composer" aria-labelledby="tower-team-composer-title" data-tower-team-composer>
      <div className="team-composer__head">
        <div>
          <div className="eyebrow">Tower expedition team</div>
          <h2 id="tower-team-composer-title">固定遠征隊伍</h2>
        </div>
        <span className="team-composer__count">已選 {entries.length}/{TEAM_SIZE}</span>
      </div>
      <p className="tower-setup__section-copy">三名隊員會沿用到整場遠征；1／2／3 是先發與後備順序，每層不會重新選人。</p>
      <div className="team-composer__slots" role="list" aria-label="Tower 固定出戰順序">
        {entries.map(({ card, mon }, index) => (
          <article key={card.cardId} className="team-composer__slot" role="listitem" data-tower-team-slot={index + 1}>
            <div className="team-composer__slot-number" aria-label={`第 ${index + 1} 位`}>{index + 1}</div>
            <div className="team-composer__slot-art"><MobieSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} /></div>
            <div className="team-composer__slot-body">
              <div className="team-composer__slot-name">{mon.nameZh}</div>
              <div className="team-composer__slot-meta">Lv.{mon.level} · {index === 0 ? '先發' : `後備 ${index}`}</div>
              <div className="team-composer__slot-effects">
                <span>{mon.types.map((type) => TYPE_LABEL_ZH[type]).join('／')}</span>
                <span>{mon.shiny ? '✦ 閃光' : '標準個體'}</span>
              </div>
            </div>
            <div className="team-composer__slot-actions" aria-label={`${mon.nameZh} 順序操作`}>
              <button type="button" className="team-composer__move" aria-label={`將 ${mon.nameZh} 往前移到第 ${index} 位`} disabled={busy || index === 0} onClick={() => onMove(card.cardId, -1)}>↑</button>
              <button type="button" className="team-composer__move" aria-label={`將 ${mon.nameZh} 往後移到第 ${index + 2} 位`} disabled={busy || index === entries.length - 1} onClick={() => onMove(card.cardId, 1)}>↓</button>
              <button type="button" className="team-composer__remove" aria-label={`從 Tower 隊伍移除 ${mon.nameZh}`} disabled={busy} onClick={() => onRemove(card.cardId)}>移除</button>
            </div>
          </article>
        ))}
        {Array.from({ length: TEAM_SIZE - entries.length }, (_, index) => (
          <div key={`empty-${index}`} className="team-composer__empty tower-team-composer__empty" role="listitem" data-tower-empty-slot={entries.length + index + 1}>
            <span className="team-composer__empty-plus" aria-hidden="true">＋</span>
            <span>第 {entries.length + index + 1} 位待選</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function TowerSynergy({ mons }: { mons: BattleMobie[] }) {
  const modifiers = useMemo(() => PRODUCT_RUNTIME.previewPlayerSynergy(mons), [mons])
  const active = useMemo(() => new Set(modifiers.map((modifier) => modifier.label)), [modifiers])
  return (
    <section className="team-systems tower-synergy" aria-labelledby="tower-synergy-title" data-tower-synergy>
      <div className="team-systems__head">
        <div>
          <div className="eyebrow">Team Select primitive</div>
          <h2 id="tower-synergy-title">隊伍羈絆回饋</h2>
        </div>
        <span className="h-sub">每次選擇與重排後即時更新，不會自動改變隊伍。</span>
      </div>
      <ul className="team-system-card__list tower-synergy__list">
        {SYNERGY_RULES.map((rule) => {
          const isActive = active.has(rule.modifier.label)
          return (
            <li key={rule.id} className={isActive ? 'team-system-card__item--active' : ''} data-tower-synergy-rule={rule.id} data-tower-synergy-active={isActive ? 'true' : 'false'}>
              <span aria-hidden="true">{rule.icon}</span>
              <span className="team-system-card__copy">
                <b>{rule.label}</b>
                <span>{rule.modifier.label}</span>
                <small>{synergyCondition(rule.id, mons)}</small>
              </span>
              <strong>{isActive ? '已成立' : '待成形'}</strong>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TowerAdvice({ mons, shown, onToggle }: { mons: BattleMobie[]; shown: boolean; onToggle: () => void }) {
  const modifiers = useMemo(() => new Set(PRODUCT_RUNTIME.previewPlayerSynergy(mons).map((modifier) => modifier.label)), [mons])
  const suggestions = SYNERGY_RULES.filter((rule) => !modifiers.has(rule.modifier.label))
  return (
    <section className="tower-advice" aria-labelledby="tower-advice-title" data-tower-advice data-tower-advice-shown={shown ? 'true' : 'false'}>
      <div className="tower-advice__head">
        <div>
          <div className="eyebrow">Recommendation</div>
          <h2 id="tower-advice-title">組隊建議</h2>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" aria-expanded={shown} aria-controls="tower-advice-body" onClick={onToggle}>
          💡 {shown ? '收起建議' : '顯示建議'}
        </button>
      </div>
      {shown && (
        <div id="tower-advice-body" className="tower-advice__body" aria-live="polite">
          <p>建議先用 ↑／↓ 調整先發，再用三種屬性或共享屬性組出穩定羈絆；這些只是 advice，不會自動選人或改變順序。</p>
          {mons.length === 0 ? (
            <p className="tower-advice__hint">先從下方 roster 選擇三名隊員，這裡會依真實羈絆條件更新。</p>
          ) : suggestions.length > 0 ? (
            <ul>
              {suggestions.map((rule) => <li key={rule.id}><b>{rule.icon} {rule.label}</b><span>{synergyCondition(rule.id, mons)}</span></li>)}
            </ul>
          ) : <p className="tower-advice__hint">目前三項固定羈絆都已成立，可以依先發策略確認順序。</p>}
        </div>
      )}
    </section>
  )
}

function TowerBrief({ bestFloor, ascension, ascensionUnlocked }: { bestFloor: number; ascension: number; ascensionUnlocked: number }) {
  const firstFloorSp = floorReward(1, ascension).sp
  const currentTier = getAscension(ascension)
  return (
    <section className="tower-setup-brief" aria-labelledby="tower-brief-title" data-tower-brief>
      <div className="tower-setup-brief__head">
        <div>
          <div className="eyebrow">Before you enter</div>
          <h2 id="tower-brief-title">先看懂這趟遠征</h2>
        </div>
        <span className="tower-setup__progress-badge" data-tower-progress>最高紀錄 第 {bestFloor} 層 · 已解鎖 {ascensionUnlocked + 1}/{ASCENSIONS.length} 階</span>
      </div>
      <div className="tower-setup-brief__grid">
        <article className="tower-brief-card" data-tower-stakes>
          <div className="tower-brief-card__icon" aria-hidden="true">🎲</div>
          <div>
            <h3>遠征賭注</h3>
            <p>固定三人連續作戰；每層勝利結算參戰 EXP，現在的第 1 層預計給 <b>SP +{firstFloorSp}</b>、EXP ×{towerExpMult(1).toFixed(2)}。</p>
            <small>輸一場即停止在目前樓層；Tower 不可捕獲，也沒有野外事故。</small>
          </div>
        </article>
        <article className="tower-brief-card" data-tower-reset>
          <div className="tower-brief-card__icon" aria-hidden="true">♻️</div>
          <div>
            <h3>重置後會怎樣</h3>
            <p>結束或敗北後，下次會從第 1 層重新開始；最高樓層與已解鎖 Ascension 會保留。</p>
            <small>離開這個 Setup 只返回 Region Hub，不會建立 battle，也不會套用 Tower Result。</small>
          </div>
        </article>
        <article className="tower-brief-card" data-tower-selected-summary>
          <div className="tower-brief-card__icon" aria-hidden="true">🗼</div>
          <div>
            <h3>目前難度</h3>
            <p><b>{currentTier.name}</b> · {ascensionEffectCopy(ascension)}</p>
            <small>難度只在 Start 時交給既有 Tower battle handoff；不會在 Setup 預先寫入進度。</small>
          </div>
        </article>
      </div>
    </section>
  )
}

function AscensionCards({ selected, unlocked, onSelect, onLocked }: { selected: number; unlocked: number; onSelect: (level: number) => void; onLocked: (level: number) => void }) {
  return (
    <section className="tower-ascensions" aria-labelledby="tower-ascensions-title" data-tower-ascensions>
      <div className="tower-ascensions__head">
        <div>
          <div className="eyebrow">Difficulty ladder</div>
          <h2 id="tower-ascensions-title">Ascension 難度</h2>
        </div>
        <p>已解鎖階級可自由選擇；鎖定階級保留真實取得條件與效果。</p>
      </div>
      <div className="tower-ascensions__grid" role="group" aria-label="Ascension 難度階級">
        {ASCENSIONS.map((tier) => {
          const locked = tier.level > unlocked
          const current = !locked && selected === tier.level
          const detailId = `tower-ascension-detail-${tier.level}`
          return (
            <button
              key={tier.level}
              type="button"
              className={`tower-ascension-card ${locked ? 'tower-ascension-card--locked' : ''} ${current ? 'tower-ascension-card--selected' : ''}`}
              aria-pressed={current}
              aria-disabled={locked}
              aria-describedby={detailId}
              data-ascension-level={tier.level}
              data-ascension-locked={locked ? 'true' : 'false'}
              data-ascension-selected={current ? 'true' : 'false'}
              onClick={() => locked ? onLocked(tier.level) : onSelect(tier.level)}
            >
              <span className="tower-ascension-card__topline">
                <span className="tower-ascension-card__level">A{tier.level}</span>
                <span className="tower-ascension-card__status">{locked ? '🔒 尚未解鎖' : current ? '✓ 目前選取' : '已解鎖'}</span>
              </span>
              <strong className="tower-ascension-card__name">{tier.name}</strong>
              <span className="tower-ascension-card__effect">{ascensionEffectCopy(tier.level)}</span>
              <span id={detailId} className="tower-ascension-card__unlock">{ascensionUnlockCopy(tier.level)}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function TowerRoster({
  cards,
  visibleCards,
  picked,
  busy,
  page,
  pageCount,
  onToggle,
  onPageChange,
}: {
  cards: TowerCardEntry[]
  visibleCards: TowerCardEntry[]
  picked: string[]
  busy: boolean
  page: number
  pageCount: number
  onToggle: (id: string) => void
  onPageChange: (page: number) => void
}) {
  return (
    <section className="team-select-roster tower-roster" aria-labelledby="tower-roster-title" data-tower-roster data-roster-page-size={TEAM_PAGE_SIZE} data-roster-visible-count={visibleCards.length}>
      <div className="team-select-roster__head">
        <div>
          <div className="eyebrow">Mobie roster</div>
          <h2 id="tower-roster-title">選擇三名遠征隊員</h2>
        </div>
        <span className="team-select-roster__count">顯示 {visibleCards.length} / 共 {cards.length}</span>
      </div>
      <div className="hand team-select-roster__grid tower-roster__grid" role="list" aria-label="可選 Tower 隊員" data-tower-roster-grid>
        {visibleCards.map(({ card, mon, unit }, index) => {
          const order = picked.indexOf(card.cardId)
          const isPicked = order >= 0
          const growth = growthProgress(unit.level, unit.exp)
          const position = order === 0 ? '先發' : order > 0 ? `後備 ${order}` : '未選'
          const detailId = `tower-card-detail-${card.cardId}`
          return (
            <motion.article
              key={card.cardId}
              className={`poke-card tower-roster-card ${isPicked ? 'poke-card--picked' : ''}`}
              role="listitem"
              data-card-id={card.cardId}
              data-card-picked={isPicked ? 'true' : 'false'}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.025 * index }}
            >
              <button
                type="button"
                className="tower-roster-card__select"
                aria-label={`${mon.nameZh}，Lv.${mon.level}，${isPicked ? position : '未選'}`}
                aria-pressed={isPicked}
                aria-describedby={detailId}
                disabled={busy}
                onClick={() => onToggle(card.cardId)}
              >
                <span className="poke-card__lv">Lv.{mon.level}</span>
                {isPicked && <span className="poke-card__pick">{position}</span>}
                <div className="poke-card__art"><MobieSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} /></div>
                <div className="poke-card__name">{mon.nameZh}</div>
                <div className="poke-card__types"><TypeBadges types={mon.types} /></div>
                <div className="tower-roster-card__meta">{mon.types.map((type) => TYPE_LABEL_ZH[type]).join('／')} · {mon.shiny ? '閃光' : '標準'}</div>
                <div id={detailId} className="poke-card__growth">{growth.atMaxLevel ? '已達滿級' : `EXP ${growth.earnedExp}/${growth.requiredExp}`}</div>
              </button>
            </motion.article>
          )
        })}
      </div>
      {pageCount > 1 && (
        <nav className="team-select-pagination" aria-label="Tower roster 分頁" data-tower-roster-pagination>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page === 0 || busy} onClick={() => onPageChange(Math.max(0, page - 1))}>上一頁</button>
          <span aria-live="polite">第 {page + 1} / {pageCount} 頁</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page >= pageCount - 1 || busy} onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}>下一頁</button>
        </nav>
      )}
    </section>
  )
}

function TowerEmptyRoster({ loaded, busy, onBack, onRetry, retrying }: { loaded: boolean; busy: boolean; onBack: () => void; onRetry: () => void; retrying: boolean }) {
  return (
    <section className="team-select-empty tower-empty" role="status" data-tower-empty>
      <div className="eyebrow">Roster recovery</div>
      <h2>{loaded ? '目前沒有可用 Mobie' : '正在載入 Mobie…'}</h2>
      <p>{loaded ? 'Tower 需要固定三名隊員。返回 Region Hub 後可從「我的 Mobie」取得夥伴，再回來組建遠征隊伍。' : '資料準備完成後會顯示可選的隊員；既有進度不會被清除。'}</p>
      <div className="row tower-empty__actions">
        {!loaded && <button type="button" className="btn btn--ghost" onClick={onRetry} disabled={busy || retrying}>{retrying ? '重新載入中…' : '重新載入'}</button>}
        <button type="button" className="btn btn--ghost" onClick={onBack} disabled={busy}>返回區域</button>
      </div>
    </section>
  )
}

function TowerLoadError({ message, onRetry, onBack, retrying, actionRef }: { message: string; onRetry: () => void; onBack: () => void; retrying: boolean; actionRef: React.RefObject<HTMLButtonElement> }) {
  return (
    <div className="encounter-error tower-setup-error" data-tower-setup data-tower-setup-state="error" data-tower-setup-error="load">
      <div className="encounter-error__card" role="alert">
        <div className="encounter-error__icon" aria-hidden="true">⚠️</div>
        <div className="eyebrow">Tower Setup recovery</div>
        <h1 className="h-title">遠征資料載入失敗</h1>
        <p className="h-sub">{message}</p>
        <div className="row encounter-error__actions">
          <button type="button" className="btn" onClick={onRetry} disabled={retrying}>{retrying ? '重新載入中…' : '重新嘗試'}</button>
          <button ref={actionRef} autoFocus type="button" className="btn btn--ghost" onClick={onBack}>返回區域</button>
        </div>
      </div>
    </div>
  )
}

function TowerStaleContext({ onBack, actionRef }: { onBack: () => void; actionRef: React.RefObject<HTMLButtonElement> }) {
  return (
    <div className="encounter-error tower-setup-error" data-tower-setup data-tower-setup-state="stale" data-tower-setup-error="stale">
      <div className="encounter-error__card" role="alert">
        <div className="encounter-error__icon" aria-hidden="true">🗼</div>
        <div className="eyebrow">Tower Setup recovery</div>
        <h1 className="h-title">這次遠征入口已過期</h1>
        <p className="h-sub">目前畫面帶著上一場 Tower 的暫存內容，不能在這裡重用。返回 Region Hub 會清掉未開始的暫存 handoff；已完成的進度不受影響，請重新選擇 Tower。</p>
        <button ref={actionRef} autoFocus type="button" className="btn btn--ghost" onClick={onBack}>返回區域並重新選 Tower</button>
      </div>
    </div>
  )
}

function TowerStartFooter({ ready, busy, count, reason, onStart }: { ready: boolean; busy: boolean; count: number; reason: string; onStart: () => void }) {
  return (
    <div className="team-select__footer tower-setup__footer" data-tower-start-footer>
      {!ready && <p id="tower-start-reason" className="team-select__start-reason" role="status">{reason}</p>}
      {busy && <p className="team-select__start-busy" role="status" aria-live="polite">正在準備 Tower handoff…</p>}
      <motion.button
        type="button"
        className="btn team-select__start"
        style={{ fontSize: 19, padding: '16px 48px' }}
        animate={{ opacity: ready && !busy ? 1 : 0.5 }}
        whileTap={ready && !busy ? { scale: 0.96 } : undefined}
        disabled={!ready || busy}
        aria-describedby={!ready ? 'tower-start-reason' : undefined}
        aria-busy={busy}
        onClick={onStart}
        data-tower-start
      >
        🗼 開始遠征　<span style={{ fontSize: 14, opacity: 0.85 }}>{count}/{TEAM_SIZE}</span>
      </motion.button>
    </div>
  )
}

export function TowerSetupScreen() {
  const { context, send } = useGame()
  const controller = useOverlayController()
  const { snapshot: bootstrapSnapshot, retry: retryBootstrap } = useBootstrap()
  const roster = useRoster((state) => state.roster)
  const loaded = useRoster((state) => state.loaded)
  const bestFloor = useRun((state) => state.bestFloor)
  const ascensionUnlocked = useRun((state) => state.ascensionUnlocked)
  const gateOn = useSettings((state) => interactModeOf(state.settings, 'tower') !== 'off')
  const [picked, setPicked] = useState<string[]>(() => TOWER_DRAFTS.get(TOWER_DRAFT_KEY)?.slice(0, TEAM_SIZE) ?? [])
  const [ascension, setAscension] = useState(0)
  const [visiblePage, setVisiblePage] = useState(0)
  const [adviceShown, setAdviceShown] = useState(false)
  const [startBusy, setStartBusy] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const startedRef = useRef(false)
  const towerBackRef = useRef<HTMLButtonElement>(null)
  const towerRecoveryRef = useRef<HTMLButtonElement>(null)

  const projection = useMemo(() => {
    try {
      const cards = roster.map((unit) => {
        const card = ownedToCard(unit)
        return { card, mon: buildBattleMobie(card), unit }
      })
      return { cards, error: null as string | null }
    } catch (error) {
      return {
        cards: [] as TowerCardEntry[],
        error: `Mobie 資料格式無法解析：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }, [roster])
  const cards = projection.cards
  const cardsById = useMemo(() => new Map(cards.map((entry) => [entry.card.cardId, entry])), [cards])
  const pickedEntries = useMemo(
    () => picked.map((id) => cardsById.get(id)).filter((entry): entry is TowerCardEntry => Boolean(entry)),
    [cardsById, picked],
  )
  const pickedMons = useMemo(() => pickedEntries.map((entry) => entry.mon), [pickedEntries])
  const pageCount = Math.max(1, Math.ceil(cards.length / TEAM_PAGE_SIZE))
  const visibleCards = cards.slice(visiblePage * TEAM_PAGE_SIZE, (visiblePage + 1) * TEAM_PAGE_SIZE)
  const staleContext = useMemo(() => hasStaleTowerContext(context), [context])
  const loadError = bootstrapSnapshot.status === 'partial-error' || Boolean(projection.error)
  const loading = !loaded || bootstrapSnapshot.status === 'loading'
  const ready = !staleContext && !loadError && !loading && cards.length >= TEAM_SIZE && pickedEntries.length === TEAM_SIZE && !startedRef.current

  useRouteFocus(towerRecoveryRef, staleContext || loadError)
  useRouteFocus(towerBackRef, !staleContext && !loadError)

  useEffect(() => {
    setPicked((previous) => [...new Set(previous)].filter((id) => cardsById.has(id)).slice(0, TEAM_SIZE))
  }, [cardsById])

  useEffect(() => {
    if (visiblePage >= pageCount) setVisiblePage(Math.max(0, pageCount - 1))
  }, [pageCount, visiblePage])

  useEffect(() => {
    if (ascension > ascensionUnlocked) {
      setAscension(0)
      setAnnouncement('原本選取的 Ascension 尚未解鎖，已回到可用的見習難度。')
    }
  }, [ascension, ascensionUnlocked])

  const handleBack = useCallback(() => {
    if (startBusy || startedRef.current) return
    TOWER_DRAFTS.set(TOWER_DRAFT_KEY, picked)
    controller.close()
    send({ type: 'BACK' })
  }, [controller, picked, send, startBusy])

  const retry = useCallback(() => {
    if (retrying) return
    setRetrying(true)
    void retryBootstrap().finally(() => setRetrying(false))
  }, [retryBootstrap, retrying])

  const toggle = useCallback((cardId: string) => {
    if (startBusy || startedRef.current) return
    audio.play('select')
    setPicked((previous) => {
      if (previous.includes(cardId)) {
        setAnnouncement('已從固定遠征隊伍移除；請補回三名隊員。')
        return previous.filter((id) => id !== cardId)
      }
      if (previous.length >= TEAM_SIZE) {
        setAnnouncement(`隊伍已滿 ${TEAM_SIZE} 名；先移除一名或用順序按鈕調整。`)
        return previous
      }
      const next = [...previous, cardId]
      setAnnouncement(`已加入第 ${next.length} 位；目前 ${next.length}/${TEAM_SIZE}。`)
      return next
    })
  }, [startBusy])

  const remove = useCallback((cardId: string) => {
    if (startBusy || startedRef.current) return
    audio.play('select')
    setPicked((previous) => previous.filter((id) => id !== cardId))
    setAnnouncement('已移除隊員；請確認新的出戰順序。')
  }, [startBusy])

  const move = useCallback((cardId: string, delta: -1 | 1) => {
    if (startBusy || startedRef.current) return
    setPicked((previous) => {
      const index = previous.indexOf(cardId)
      const nextIndex = index + delta
      if (index < 0 || nextIndex < 0 || nextIndex >= previous.length) return previous
      const next = [...previous]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      setAnnouncement(`已調整為 ${next.indexOf(cardId) + 1} 號位。`)
      return next
    })
  }, [startBusy])

  const beginRun = useCallback(() => {
    if (startedRef.current || !ready) return
    const chosen = pickedEntries.map((entry) => entry.card)
    if (chosen.length !== TEAM_SIZE) return
    startedRef.current = true
    TOWER_DRAFTS.delete(TOWER_DRAFT_KEY)
    audio.play('super')
    const seed = `tower-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    send({ type: 'START_TOWER', cards: chosen, ascension, seed })
  }, [ascension, pickedEntries, ready, send])

  const start = useCallback(() => {
    if (!ready || startBusy || startedRef.current) return
    setStartBusy(true)
    if (!gateOn) {
      beginRun()
      return
    }
    controller.push({
      id: 'tower-gate',
      policy: 'explicit-action-only',
      content: (
        <GestureGate
          title="🗼 破門而入"
          icon="🚪"
          hint="來回推撞塔門，闖進連勝塔！"
          timeoutHint="完成、略過或 6 秒逾時都會直接開始；這段手勢只負責演出，不改變難度或獎勵。"
          skipLabel="略過手勢・直接開始"
          onComplete={() => { controller.pop(); beginRun() }}
          onCancel={() => { controller.pop(); setStartBusy(false) }}
        />
      ),
    })
  }, [beginRun, controller, gateOn, ready, startBusy])

  const startReason = staleContext
    ? '這個 Setup 帶著過期 Tower context，請返回區域重新選 Tower。'
    : loadError
      ? '資料載入未完成，請先重新嘗試或返回區域。'
      : loading
        ? 'Mobie 資料準備中，完成後才能開始遠征。'
        : cards.length === 0
          ? '目前沒有可用 Mobie，請返回區域取得夥伴。'
          : pickedEntries.length < TEAM_SIZE
            ? `還需選擇 ${TEAM_SIZE - pickedEntries.length} 隻 Mobie，才能開始遠征。`
            : startBusy
              ? '正在準備 Tower handoff…'
              : ''

  if (staleContext) return <TowerStaleContext onBack={handleBack} actionRef={towerRecoveryRef} />
  if (loadError) {
    return <TowerLoadError message={projection.error ?? bootstrapSnapshot.error ?? 'Tower 需要先完成資料載入。'} onRetry={retry} onBack={handleBack} retrying={retrying} actionRef={towerRecoveryRef} />
  }

  return (
    <div
      className="tower-setup-screen"
      data-tower-setup
      data-tower-setup-state={loading ? 'loading' : cards.length === 0 ? 'empty' : ready ? 'ready' : 'incomplete'}
      data-tower-setup-busy={startBusy ? 'true' : 'false'}
      data-tower-ascension={ascension}
    >
      <div className="tower-setup__topbar">
        <button ref={towerBackRef} autoFocus type="button" className="btn btn--ghost" onClick={handleBack} disabled={startBusy || startedRef.current}>← 返回區域</button>
        <span className="tower-setup__route-label">Region Hub → Tower Setup</span>
      </div>

      <header className="tower-setup__header">
        <div className="eyebrow">Step 2 · Tower expedition</div>
        <h1 className="h-title">挑戰連勝塔</h1>
        <p className="h-sub">先確認難度、賭注與重置後果，再把固定三人隊伍交給既有 Tower battle。</p>
      </header>

      <TowerBrief bestFloor={bestFloor} ascension={ascension} ascensionUnlocked={ascensionUnlocked} />
      <AscensionCards
        selected={ascension}
        unlocked={ascensionUnlocked}
        onSelect={(level) => { audio.play('select'); setAscension(level); setAnnouncement(`已選取 ${getAscension(level).name} 難度。`) }}
        onLocked={(level) => setAnnouncement(`${getAscension(level).name} 尚未解鎖。${ascensionUnlockCopy(level)}`)}
      />
      <div className="tower-setup__announcement" role="status" aria-live="polite" data-tower-setup-announcement>{announcement}</div>

      <TowerAdvice mons={pickedMons} shown={adviceShown} onToggle={() => { audio.play('select'); setAdviceShown((shown) => !shown) }} />
      <SelectedTowerTeam entries={pickedEntries} busy={startBusy} onRemove={remove} onMove={move} />

      {loading || cards.length === 0 ? (
        <TowerEmptyRoster loaded={loaded} busy={startBusy} onBack={handleBack} onRetry={retry} retrying={retrying} />
      ) : (
        <TowerRoster
          cards={cards}
          visibleCards={visibleCards}
          picked={picked}
          busy={startBusy}
          page={visiblePage}
          pageCount={pageCount}
          onToggle={toggle}
          onPageChange={setVisiblePage}
        />
      )}

      <TowerSynergy mons={pickedMons} />
      <TowerStartFooter ready={ready} busy={startBusy} count={pickedEntries.length} reason={startReason} onStart={start} />
    </div>
  )
}
