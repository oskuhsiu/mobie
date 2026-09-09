import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRoster } from '@/store/rosterStore'
import { useBag } from '@/store/bagStore'
import { getSpecies } from '@/game/data/species'
import { ITEMS, getItem } from '@/game/ext/items'
import { abilityForType, getAbility } from '@/game/ext/abilities'
import { growthProgress } from '@/game/growth'
import { buildOwnedMobieForDisplay } from '@/game/ownedMobie'
import { MobCard } from '@/ui/components/MobCard'
import { MobieSprite } from '@/ui/components/MobieSprite'
import type { OwnedUnit } from '@/game/types'
import { audio } from '@/audio/audioEngine'
import { ModalSurface } from '@/ui/shell/ModalSurface'
import { useOverlayController } from '@/ui/shell/OverlayController'

const COLLECTION_BREAKPOINT = 760
const PAGE_SIZE = 24

function useCompactCollection(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth <= COLLECTION_BREAKPOINT)

  useEffect(() => {
    const update = () => setCompact(window.innerWidth <= COLLECTION_BREAKPOINT)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return compact
}

function ResourceSummary({ roster, bag }: { roster: OwnedUnit[]; bag: Record<string, number> }) {
  const equipped = roster.reduce((count, unit) => count + (unit.heldItemId ? 1 : 0), 0)
  const available = ITEMS.reduce((count, item) => count + Math.max(0, bag[item.id] ?? 0), 0)
  return (
    <div className="resource-summary" data-resource-summary aria-label="收藏資源">
      <span><b>{roster.length}</b> 隻 Mobie</span>
      <span><b>{equipped}</b> 已裝備</span>
      <span><b>{available}</b> 件可用道具</span>
    </div>
  )
}

function itemCountLabel(count: number): string {
  return count > 0 ? `剩餘 ${count}` : '庫存不足'
}

/**
 * CollectionShell：寬版保留清單與 detail 的明示雙 pane；窄版切成單欄 detail sheet。
 * 兩種模式都由同一個 canonical roster、bag 與 MobCard projection 驅動。
 */
export function TeamModal({ onClose }: { onClose: () => void }) {
  const roster = useRoster((s) => s.roster)
  const loaded = useRoster((s) => s.loaded)
  const load = useRoster((s) => s.load)
  const bag = useBag((s) => s.bag)
  const equip = useBag((s) => s.equip)
  const controller = useOverlayController()
  const compact = useCompactCollection()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [pendingEquip, setPendingEquip] = useState<string | null>(null)
  const [equipNotice, setEquipNotice] = useState<{ unitId: string; tone: 'error' | 'status'; text: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const invokerRefs = useRef(new Map<string, HTMLButtonElement>())
  const detailCloseRef = useRef<HTMLButtonElement>(null)
  const lastSelectedId = useRef<string | null>(null)

  const filteredRoster = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return roster
    return roster.filter((unit) => {
      const species = getSpecies(unit.speciesId)
      return `${species.nameZh} ${species.name} ${species.id} ${unit.id}`.toLocaleLowerCase().includes(needle)
    })
  }, [query, roster])
  const visibleRoster = filteredRoster.slice(0, visibleCount)
  const selectedUnit = selectedId ? roster.find((unit) => unit.id === selectedId) ?? null : null

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [query])

  useEffect(() => {
    if (selectedId && !roster.some((unit) => unit.id === selectedId)) setSelectedId(null)
  }, [roster, selectedId])

  const restoreListFocus = useCallback((unitId: string | null) => {
    if (!unitId) return
    requestAnimationFrame(() => invokerRefs.current.get(unitId)?.focus())
  }, [])

  const closeDetail = useCallback(() => {
    const unitId = lastSelectedId.current
    setSelectedId(null)
    restoreListFocus(unitId)
  }, [restoreListFocus])

  const closeCompactDetail = useCallback((unitId: string) => {
    controller.pop()
    const focusInvoker = () => {
      const element = [...document.querySelectorAll<HTMLElement>('[data-mobie-invoker]')]
        .find((candidate) => candidate.dataset.mobieInvoker === unitId)
        ?? document.querySelector<HTMLElement>('[data-mobie-invoker]')
      if (element?.isConnected && !element.hasAttribute('disabled')) {
        element.focus()
      }
    }
    // The root surface creates its portal in a layout effect after pop. Retry
    // across that remount so its initial close-button focus cannot win the race.
    requestAnimationFrame(() => requestAnimationFrame(focusInvoker))
    for (const delay of [120, 320, 700]) window.setTimeout(focusInvoker, delay)
  }, [controller])

  const openDetail = useCallback((unit: OwnedUnit) => {
    const mon = buildOwnedMobieForDisplay(unit)
    lastSelectedId.current = unit.id
    setOpenId(null)
    setEquipNotice(null)
    audio.play('select')
    if (compact) {
      controller.push({
        id: `mobie-detail:${unit.id}`,
        policy: 'escape-and-backdrop',
        content: <MobCard mon={mon} owner ownerExp={unit.exp} revealed onClose={() => closeCompactDetail(unit.id)} />,
      }, {
        // The root TeamModal is temporarily unmounted while the pushed entry
        // is active, so resolve the remounted DOM equivalent after pop.
        restoreFocus: () => [...document.querySelectorAll<HTMLElement>('[data-mobie-invoker]')]
          .find((element) => element.dataset.mobieInvoker === unit.id) ?? null,
      })
      return
    }
    setSelectedId(unit.id)
  }, [compact, closeCompactDetail, controller])

  const choose = useCallback(async (unitId: string, itemId: string | null) => {
    if (pendingEquip) return
    setPendingEquip(unitId)
    setEquipNotice(null)
    try {
      const ok = await equip(unitId, itemId)
      if (ok) {
        audio.play('select')
        setOpenId(null)
      } else {
        audio.play('defeat')
        setEquipNotice({ unitId, tone: 'error', text: '裝備未完成：道具庫存不足，請重新確認。' })
      }
    } catch {
      audio.play('defeat')
      setEquipNotice({ unitId, tone: 'error', text: '裝備未完成：保存資料時發生問題，請再試一次。' })
    } finally {
      setPendingEquip(null)
    }
  }, [equip, pendingEquip])

  const retryLoad = async () => {
    setLoadError(null)
    try {
      await load()
    } catch {
      setLoadError('Mobie 資料暫時無法載入，請再試一次。')
    }
  }

  // Tests and a just-hydrated bootstrap may already expose canonical units
  // before the loaded flag publishes; a non-empty roster is safe to render.
  const collectionState = loadError ? 'error' : !loaded && roster.length === 0 ? 'loading' : roster.length === 0 ? 'empty' : 'ready'
  const hasMore = visibleRoster.length < filteredRoster.length
  const detailOpen = Boolean(selectedUnit)

  return (
    <ModalSurface
      title="我的 Mobie"
      description="在收藏中快速選擇夥伴，查看完整 MobCard，或管理持有道具。"
      onClose={onClose}
      className="collection-surface"
      footer={<div className="utility-foot">寬版可同時查看清單與 detail；窄版會切換成單欄資訊 sheet。道具裝備會即時對帳並保留在你的本機進度。</div>}
    >
      <div
        className="collection-shell"
        data-collection-shell
        data-collection-state={collectionState}
        data-layout={compact ? 'compact' : 'wide'}
        data-detail-open={detailOpen ? 'true' : 'false'}
      >
        <ResourceSummary roster={roster} bag={bag} />

        {collectionState === 'loading' && (
          <div className="collection-state" role="status" data-collection-loading>
            <div className="eyebrow">Collection</div>
            <h3>正在載入你的 Mobie…</h3>
            <button className="btn btn--ghost btn--sm" onClick={() => void retryLoad()}>重新載入</button>
          </div>
        )}

        {collectionState === 'error' && (
          <div className="collection-state collection-state--error" role="alert" data-collection-error>
            <div className="eyebrow">Collection</div>
            <h3>{loadError ?? '資料需要再試一次'}</h3>
            <button className="btn btn--sm" onClick={() => void retryLoad()}>重新載入</button>
          </div>
        )}

        {collectionState === 'empty' && (
          <div className="collection-state" data-collection-empty>
            <div className="eyebrow">Collection</div>
            <h3>還沒有夥伴</h3>
            <p>前往冒險收服 Mobie，或關閉這個視窗回到工具入口。</p>
            <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉收藏</button>
          </div>
        )}

        {collectionState === 'ready' && (
          <div className="collection-content">
            <section className="collection-list-pane" data-entity-list data-collection-scroll-owner="list" role="region" aria-labelledby="collection-list-title" aria-label="Mobie 清單">
              <div className="collection-pane-head">
                <div>
                  <div className="eyebrow">Entity List</div>
                  <h3 id="collection-list-title">你的 Mobie</h3>
                </div>
                <span className="collection-count">顯示 {visibleRoster.length} / {filteredRoster.length}</span>
              </div>
              <label className="collection-search">
                <span className="sr-only">搜尋我的 Mobie</span>
                <input
                  className="utility-search"
                  type="search"
                  value={query}
                  placeholder="搜尋名稱、編號或 ID…"
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="搜尋我的 Mobie"
                />
              </label>

              <div className="collection-entity-list" role="list" aria-label="Mobie 收藏清單">
                {visibleRoster.map((unit) => {
                  const species = getSpecies(unit.speciesId)
                  const held = getItem(unit.heldItemId)
                  const ability = getAbility(abilityForType(species.types[0]))
                  const open = openId === unit.id
                  const growth = growthProgress(unit.level, unit.exp)
                  const busy = pendingEquip === unit.id
                  const notice = equipNotice?.unitId === unit.id ? equipNotice : null
                  const availableCount = ITEMS.reduce((count, item) => count + (bag[item.id] ?? 0), 0)
                  return (
                    <div key={unit.id} className="collection-entity" role="listitem" data-entity-id={unit.id}>
                      <div className={`team-row ${selectedId === unit.id ? 'team-row--selected' : ''}`}>
                        <button
                          ref={(element) => {
                            if (element) invokerRefs.current.set(unit.id, element)
                            else invokerRefs.current.delete(unit.id)
                          }}
                          aria-label={`${species.nameZh} Lv.${unit.level}，查看完整資訊`}
                          aria-current={selectedId === unit.id ? 'true' : undefined}
                          data-mobie-invoker={unit.id}
                          className="team-row__main"
                          onClick={() => openDetail(unit)}
                          title="看資訊卡"
                        >
                          <div className="team-row__art">
                            <MobieSprite src={species.artworkUrl} alt={species.nameZh} shiny={unit.shiny} />
                          </div>
                          <div className="team-row__info">
                            <div className="team-row__name">{species.nameZh} <span className="hpbar__lv">Lv.{unit.level}</span> <span className="team-row__info-hint">ℹ️ 詳情</span></div>
                            <div className="my-mobies-growth">
                              {growth.atMaxLevel ? (
                                <span className="my-mobies-growth__max">已達滿級</span>
                              ) : (
                                <>
                                  <div className="my-mobies-growth__labels">
                                    <span>{growth.earnedExp} / {growth.requiredExp} EXP</span>
                                    <span>Lv.{unit.level + 1} 門檻 {growth.nextLevelExp}</span>
                                  </div>
                                  <div className="my-mobies-growth__track" role="progressbar" aria-label={`${species.nameZh} 等級進度`} aria-valuenow={growth.earnedExp} aria-valuemin={0} aria-valuemax={growth.requiredExp}>
                                    <div className="my-mobies-growth__fill" style={{ width: `${growth.ratio * 100}%` }} />
                                  </div>
                                </>
                              )}
                            </div>
                            <div className="team-row__sub">
                              {ability && <span className="team-row__ability" title={ability.desc}>特性：{ability.icon} {ability.name}</span>}
                              <span>道具：{held ? `${held.icon} ${held.name}` : '未裝備'}</span>
                            </div>
                          </div>
                        </button>
                        <button
                          className="team-row__item-btn"
                          aria-label={`${species.nameZh} 道具裝備`}
                          aria-expanded={open}
                          onClick={() => { audio.play('select'); setEquipNotice(null); setOpenId(open ? null : unit.id) }}
                        >
                          {held ? '更換' : '裝備'} ▾
                        </button>
                      </div>

                      <AnimatePresence initial={false}>
                        {open && (
                          <motion.div
                            className="item-picker"
                            data-item-picker
                            data-item-picker-for={unit.id}
                            data-item-picker-busy={busy ? 'true' : 'false'}
                            aria-busy={busy ? 'true' : undefined}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                          >
                            <div className="item-picker__head">
                              <span>持有道具</span>
                              <span>{availableCount > 0 ? `${availableCount} 件可用` : '目前沒有可用道具'}</span>
                            </div>
                            {busy && <div className="item-picker__status" role="status">正在更新裝備…</div>}
                            {notice && <div className="item-picker__status item-picker__status--error" role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
                            {held && (
                              <button className="item-chip" disabled={busy} onClick={() => void choose(unit.id, null)} aria-label={`${species.nameZh} 卸下 ${held.name}`}>
                                ✕ 卸下<span className="item-chip__count">歸還 1 件</span>
                              </button>
                            )}
                            {ITEMS.map((item) => {
                              const equipped = unit.heldItemId === item.id
                              const count = bag[item.id] ?? 0
                              const disabled = busy || equipped || count <= 0
                              const status = equipped ? '裝備中' : itemCountLabel(count)
                              return (
                                <button
                                  key={item.id}
                                  className={`item-chip ${equipped ? 'item-chip--on' : ''}`}
                                  disabled={disabled}
                                  title={`${item.desc}（${status}）`}
                                  aria-label={`${item.name}，${status}`}
                                  onClick={() => void choose(unit.id, item.id)}
                                >
                                  {item.icon} {item.name}
                                  <span className="item-chip__count">{equipped ? '裝備中' : `×${count}`}</span>
                                </button>
                              )
                            })}
                            {availableCount === 0 && !held && (
                              <div className="item-picker__hint">目前沒有可裝備道具；庫存補充後可從這裡重新嘗試。</div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })}
              </div>

              {visibleRoster.length === 0 && <div className="collection-no-results" role="status">找不到符合的 Mobie。清除搜尋後再試一次。</div>}
              {hasMore && (
                <button className="btn btn--ghost btn--sm collection-load-more" data-collection-load-more onClick={() => setVisibleCount((count) => Math.min(filteredRoster.length, count + PAGE_SIZE))}>
                  顯示更多（還有 {filteredRoster.length - visibleRoster.length} 隻）
                </button>
              )}
            </section>

            <aside className="collection-detail-pane" data-detail-panel data-collection-scroll-owner="detail" role="region" aria-label="Mobie 詳情">
              {selectedUnit ? (
                <MobCard
                  mon={buildOwnedMobieForDisplay(selectedUnit)}
                  owner
                  ownerExp={selectedUnit.exp}
                  revealed
                  onClose={closeDetail}
                  layout="panel"
                  closeRef={detailCloseRef}
                />
              ) : (
                <div className="collection-detail-empty" data-detail-empty>
                  <div className="eyebrow">Detail Panel</div>
                  <h3 id="collection-detail-title">選一隻 Mobie</h3>
                  <p>從左側清單開啟完整 MobCard；你會看到招式、六維、個體、Grade、特性、道具與 EXP。</p>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </ModalSurface>
  )
}
