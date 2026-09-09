import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Move, OwnedUnit } from '@/game/types'
import { useRoster } from '@/store/rosterStore'
import { useSkillPoints } from '@/store/skillPointsStore'
import { getSpecies } from '@/game/data/species'
import { getMove, findMove } from '@/game/data/moves'
import {
  effectiveLearnedMoves,
  moveLearnCost,
  resolveEquippedMoves,
  teachableNotLearned,
  MOVE_SLOT_CAP,
} from '@/game/learnset'
import { TYPE_LABEL_ZH, typeColor } from '@/ui/typeMeta'
import { audio } from '@/audio/audioEngine'
import { ModalSurface } from '@/ui/shell/ModalSurface'

const CATEGORY_LABEL: Record<Move['category'], string> = {
  physical: '物理',
  special: '特殊',
  status: '變化',
}

type Notice = {
  unitId?: string
  tone: 'error' | 'status'
  text: string
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : '保存招式資料時發生問題，請再試一次。'
}

function statLabel(stat: NonNullable<NonNullable<Move['effect']>['stat']>): string {
  return ({ atk: '攻擊', def: '防禦', spa: '特攻', spd: '特防' })[stat]
}

function effectDescription(move: Move): string {
  const effect = move.effect
  if (!effect) return '—'
  if (effect.kind === 'buff') {
    const stat = effect.stat ? statLabel(effect.stat) : '能力'
    const mult = effect.mult == null ? '' : ` ×${effect.mult}`
    const duration = effect.duration == null ? '' : `・${effect.duration} 回合`
    return `${effect.label}・${stat}${mult}${duration}`
  }
  if (effect.kind === 'heal') {
    const amount = effect.healFrac == null ? '' : `・回復 ${Math.round(effect.healFrac * 100)}% HP`
    return `${effect.label}${amount}`
  }
  return `${effect.label}${effect.terrainId ? `・${effect.terrainId}` : ''}`
}

/** 完整招式 definition：訓練所與可學/已學/已裝備狀態共用同一份真實資料。 */
function MoveDefinition({ move }: { move: Move }) {
  return (
    <div
      className="trainer-move-definition"
      data-move-definition
      data-move-id={move.id}
      style={{ ['--mv' as string]: typeColor(move.type) }}
      aria-label={`${move.nameZh}，${TYPE_LABEL_ZH[move.type]}屬性，${CATEGORY_LABEL[move.category]}，${move.category === 'status' ? `效果：${effectDescription(move)}` : `威力 ${move.power}，命中 ${move.accuracy}%`}`}
    >
      <div className="trainer-move-definition__head">
        <strong className="trainer-move-definition__name">{move.nameZh}</strong>
        <span className="type-badge" style={{ background: typeColor(move.type) }}>{TYPE_LABEL_ZH[move.type]}</span>
        <span className="trainer-move-definition__category">{CATEGORY_LABEL[move.category]}</span>
      </div>
      <div className="trainer-move-definition__stats">
        {move.category === 'status' ? (
          <span data-move-effect>效果：{effectDescription(move)}</span>
        ) : (
          <>
            <span>威力 {move.power}</span>
            <span>命中 {move.accuracy}%</span>
            <span data-move-effect>效果：—</span>
          </>
        )}
      </div>
    </div>
  )
}

function loadoutIdsOf(unit: OwnedUnit): number[] {
  return resolveEquippedMoves(unit.equippedMoveIds, getSpecies(unit.speciesId), unit.level)
    .map((move) => move.id)
    .filter((id) => Boolean(findMove(id)))
}

function learnedIdsOf(unit: OwnedUnit): number[] {
  const species = getSpecies(unit.speciesId)
  return [...new Set(effectiveLearnedMoves(unit, species))].filter((id) => Boolean(findMove(id)))
}

function actionLabel(move: Move, slot: number): string {
  return `${move.nameZh}（第 ${slot} 槽）`
}

function EmptyTrainerState({ onClose, message }: { onClose: () => void; message: string }) {
  return (
    <div className="trainer-state" role="status" data-move-trainer-empty>
      <div className="eyebrow">Move Trainer</div>
      <h3>{message}</h3>
      <p>回到我的 Mobie 後重新開啟，招式變更會以 canonical roster 為準。</p>
      <button className="btn btn--ghost btn--sm" onClick={onClose}>返回</button>
    </div>
  )
}

/**
 * 招式訓練所：SP 學習與固定四槽 loadout 編輯共用一個 canonical store boundary。
 * 每個 mutation 都有忙碌鎖、可讀錯誤與 focus key；預覽只讀 definition，不碰 battle state。
 */
export function MoveTrainerModal({ onClose, initialUnitId }: { onClose: () => void; initialUnitId?: string }) {
  const roster = useRoster((state) => state.roster)
  const learnMoveWithSp = useRoster((state) => state.learnMoveWithSp)
  const setEquippedMoves = useRoster((state) => state.setEquippedMoves)
  const sp = useSkillPoints((state) => state.sp)
  const [openId, setOpenId] = useState<string | null>(initialUnitId ?? null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const actionRefs = useRef(new Map<string, HTMLButtonElement>())
  const focusKey = useRef<string | null>(null)

  const registerAction = useCallback((key: string, element: HTMLButtonElement | null) => {
    if (element) actionRefs.current.set(key, element)
    else actionRefs.current.delete(key)
  }, [])

  const focusAfterRender = useCallback((key: string) => {
    focusKey.current = key
    requestAnimationFrame(() => {
      const element = actionRefs.current.get(key)
      if (element?.isConnected && !element.disabled) element.focus()
    })
  }, [])

  useEffect(() => {
    if (!focusKey.current) return
    const frame = requestAnimationFrame(() => {
      const key = focusKey.current
      if (!key) return
      const element = actionRefs.current.get(key)
      if (element?.isConnected && !element.disabled) element.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [roster, sp, pendingKey])

  const initialTargetMissing = Boolean(initialUnitId && !roster.some((unit) => unit.id === initialUnitId))
  const rosterById = useMemo(() => new Map(roster.map((unit) => [unit.id, unit])), [roster])
  const busy = pendingKey !== null

  const runMutation = useCallback(async (
    key: string,
    unitId: string,
    task: () => Promise<void>,
    successText: string,
    focusTarget = key,
    errorFocusTarget = key,
  ) => {
    if (busy) return
    setPendingKey(key)
    setNotice(null)
    try {
      await task()
      setNotice({ unitId, tone: 'status', text: successText })
      focusAfterRender(focusTarget)
    } catch (cause) {
      setNotice({ unitId, tone: 'error', text: errorMessage(cause) })
      focusAfterRender(errorFocusTarget)
    } finally {
      setPendingKey(null)
    }
  }, [busy, focusAfterRender])

  const learn = useCallback((unit: OwnedUnit, move: Move) => {
    const key = `learn:${unit.id}:${move.id}`
    void runMutation(
      key,
      unit.id,
      async () => {
        const result = await learnMoveWithSp(unit.id, move.id)
        if (result.status === 'already-learned') throw new Error(`已學習「${move.nameZh}」，沒有再次扣除 SP。`)
      },
      `已學會「${move.nameZh}」；SP −${moveLearnCost(move)}，目前剩餘 ${Math.max(0, sp - moveLearnCost(move))}。`,
      `move:${unit.id}:${move.id}`,
    )
  }, [learnMoveWithSp, runMutation, sp])

  const updateLoadout = useCallback((unit: OwnedUnit, next: number[], successText: string, focusTarget: string) => {
    void runMutation(
      `loadout:${unit.id}`,
      unit.id,
      () => setEquippedMoves(unit.id, next),
      successText,
      focusTarget,
      focusTarget,
    )
  }, [runMutation, setEquippedMoves])

  const equip = useCallback((unit: OwnedUnit, moveId: number) => {
    const current = loadoutIdsOf(unit)
    const move = findMove(moveId)
    if (!move || current.includes(moveId)) return
    if (current.length >= MOVE_SLOT_CAP) {
      setNotice({ unitId: unit.id, tone: 'error', text: `出戰槽已滿（${MOVE_SLOT_CAP} 槽）；請先卸下一招再裝備。` })
      return
    }
    updateLoadout(unit, [...current, moveId], `已將「${move.nameZh}」裝備到第 ${current.length + 1} 槽。`, `move:${unit.id}:${moveId}`)
  }, [updateLoadout])

  const unequip = useCallback((unit: OwnedUnit, moveId: number) => {
    const current = loadoutIdsOf(unit)
    const move = findMove(moveId)
    if (!move || !current.includes(moveId)) return
    if (current.length <= 1) {
      setNotice({ unitId: unit.id, tone: 'error', text: '至少保留一個合法 battle action，最後一招不能卸下。' })
      return
    }
    updateLoadout(unit, current.filter((id) => id !== moveId), `已卸下「${move.nameZh}」；已學習狀態與 SP 保持不變。`, `move:${unit.id}:${moveId}`)
  }, [updateLoadout])

  const reorder = useCallback((unit: OwnedUnit, index: number, delta: -1 | 1) => {
    const current = loadoutIdsOf(unit)
    const nextIndex = index + delta
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return
    const next = [...current]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    const moved = findMove(next[index])
    if (!moved) return
    updateLoadout(unit, next, `已將「${moved.nameZh}」移到第 ${nextIndex + 1} 槽。`, `move:${unit.id}:${moved.id}`)
  }, [updateLoadout])

  const renderUnit = (unit: OwnedUnit) => {
    const species = getSpecies(unit.speciesId)
    const equipped = loadoutIdsOf(unit)
    const learned = learnedIdsOf(unit)
    const learnable = teachableNotLearned(unit, species)
      .map((id) => findMove(id))
      .filter((move): move is Move => Boolean(move))
    const open = openId === unit.id
    const unitBusy = Boolean(
      busy && (pendingKey === `loadout:${unit.id}` || pendingKey?.includes(`:${unit.id}:`)),
    )
    const unitNotice = notice?.unitId === unit.id ? notice : null
    const firstEmptySlot = equipped.length + 1
    return (
      <article
        key={unit.id}
        className="trainer-unit"
        data-trainer-unit={unit.id}
        data-trainer-open={open ? 'true' : 'false'}
        data-trainer-busy={unitBusy ? 'true' : 'false'}
      >
        <div className="team-row trainer-unit__row">
          <button
            type="button"
            className="team-row__main trainer-unit__toggle"
            aria-expanded={open}
            aria-controls={`trainer-panel-${unit.id}`}
            aria-label={`${species.nameZh} Lv.${unit.level}，${open ? '收合' : '開啟'}招式管理`}
            onClick={() => { audio.play('select'); setOpenId(open ? null : unit.id); setNotice(null) }}
          >
            <div className="team-row__art"><img src={species.artworkUrl} alt={species.nameZh} /></div>
            <div className="team-row__info">
              <div className="team-row__name">{species.nameZh} <span className="hpbar__lv">Lv.{unit.level}</span></div>
              <div className="team-row__sub">已學 {learned.length} 招・出戰 {equipped.length}/{MOVE_SLOT_CAP} 槽</div>
              <div className="trainer-unit__loadout-summary">{equipped.map((id, index) => `${index + 1}. ${getMove(id).nameZh}`).join('　')}</div>
            </div>
          </button>
          <button
            type="button"
            className="team-row__item-btn"
            aria-expanded={open}
            aria-controls={`trainer-panel-${unit.id}`}
            onClick={() => { audio.play('select'); setOpenId(open ? null : unit.id); setNotice(null) }}
          >
            招式 {open ? '▴' : '▾'}
          </button>
        </div>

        {open && (
          <div id={`trainer-panel-${unit.id}`} className="trainer-panel" data-trainer-panel>
            {unitNotice && (
              <div className={`trainer-notice trainer-notice--${unitNotice.tone}`} role={unitNotice.tone === 'error' ? 'alert' : 'status'} aria-live="polite" data-trainer-notice>
                <span>{unitNotice.text}</span>
                {unitNotice.tone === 'error' && <span className="trainer-notice__hint">操作沒有套用；確認資源後可再次嘗試。</span>}
              </div>
            )}
            {unitBusy && <div className="trainer-busy" role="status" aria-live="polite">正在保存 {species.nameZh} 的招式資料…</div>}

            <section className="trainer-section" aria-labelledby={`trainer-loadout-title-${unit.id}`} data-trainer-loadout-section>
              <div className="trainer-section__head">
                <div>
                  <div className="trainer-sec">Battle loadout</div>
                  <h3 id={`trainer-loadout-title-${unit.id}`}>出戰招式槽 1–{MOVE_SLOT_CAP}</h3>
                </div>
                <span className="trainer-section__meta">順序會帶入下一場 battle</span>
              </div>
              <ol className="trainer-loadout" aria-label={`${species.nameZh} 出戰招式槽`} data-move-loadout>
                {Array.from({ length: MOVE_SLOT_CAP }, (_, index) => {
                  const moveId = equipped[index]
                  const move = moveId == null ? null : findMove(moveId)
                  const slot = index + 1
                  const slotReasonId = `trainer-slot-reason-${unit.id}-${slot}`
                  return (
                    <li key={slot} className={`trainer-slot ${move ? 'trainer-slot--filled' : 'trainer-slot--empty'}`} data-move-slot={slot} data-slot-state={move ? 'filled' : 'empty'}>
                      <span className="trainer-slot__number">槽 {slot}</span>
                      {move ? (
                        <>
                          <MoveDefinition move={move} />
                          <div className="trainer-slot__actions">
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm trainer-action"
                              ref={(element) => registerAction(`move:${unit.id}:${move.id}`, element)}
                              disabled={busy}
                              aria-label={`將 ${actionLabel(move, slot)} 卸下`}
                              aria-describedby={equipped.length <= 1 ? slotReasonId : undefined}
                              onClick={() => unequip(unit, move.id)}
                            >
                              卸下
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm trainer-action"
                              ref={(element) => registerAction(`reorder:${unit.id}:${move.id}:up`, element)}
                              disabled={busy || index === 0}
                              aria-label={`將 ${move.nameZh} 往前移到第 ${Math.max(1, slot - 1)} 槽`}
                              onClick={() => reorder(unit, index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm trainer-action"
                              ref={(element) => registerAction(`reorder:${unit.id}:${move.id}:down`, element)}
                              disabled={busy || index >= equipped.length - 1}
                              aria-label={`將 ${move.nameZh} 往後移到第 ${Math.min(equipped.length, slot + 1)} 槽`}
                              onClick={() => reorder(unit, index, 1)}
                            >
                              ↓
                            </button>
                          </div>
                          {equipped.length <= 1 && <span id={slotReasonId} className="trainer-slot__reason">至少保留一個合法 battle action</span>}
                        </>
                      ) : (
                        <span className="trainer-slot__empty-copy">空槽・從下方已學招式裝備</span>
                      )}
                    </li>
                  )
                })}
              </ol>
            </section>

            <section className="trainer-section" aria-labelledby={`trainer-learned-title-${unit.id}`} data-trainer-learned-section>
              <div className="trainer-section__head">
                <div>
                  <div className="trainer-sec">Learned moves</div>
                  <h3 id={`trainer-learned-title-${unit.id}`}>已學招式（{learned.length}）</h3>
                </div>
                <span className="trainer-section__meta">卸下不會忘記，也不會退回 SP</span>
              </div>
              <div className="trainer-move-list" role="list" aria-label={`${species.nameZh} 已學招式`}>
                {learned.map((moveId) => {
                  const move = findMove(moveId)
                  if (!move) return null
                  const slot = equipped.indexOf(move.id)
                  const equippedLabel = slot >= 0 ? `已裝備・第 ${slot + 1} 槽` : '已學習・尚未裝備'
                  return (
                    <article key={move.id} className="trainer-move-card" role="listitem" data-move-id={move.id} data-move-state={slot >= 0 ? 'equipped' : 'learned'}>
                      <MoveDefinition move={move} />
                      <div className="trainer-move-card__status">{equippedLabel}</div>
                      {slot < 0 && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm trainer-action"
                          ref={(element) => registerAction(`move:${unit.id}:${move.id}`, element)}
                          disabled={busy || equipped.length >= MOVE_SLOT_CAP}
                          title={equipped.length >= MOVE_SLOT_CAP ? `出戰槽已滿（${MOVE_SLOT_CAP} 槽）；先卸下一招` : undefined}
                          aria-label={equipped.length >= MOVE_SLOT_CAP ? `裝備 ${move.nameZh}：出戰槽已滿` : `裝備 ${move.nameZh} 到第 ${firstEmptySlot} 槽`}
                          onClick={() => equip(unit, move.id)}
                        >
                          裝備到第 {firstEmptySlot} 槽
                        </button>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>

            <section className="trainer-section" aria-labelledby={`trainer-learn-title-${unit.id}`} data-trainer-learn-section>
              <div className="trainer-section__head">
                <div>
                  <div className="trainer-sec">Training catalogue</div>
                  <h3 id={`trainer-learn-title-${unit.id}`}>可學招式（{learnable.length}）</h3>
                </div>
                <span className="trainer-section__meta">只接受合法 teachable target</span>
              </div>
              {learnable.length > 0 ? (
                <div className="trainer-move-list" role="list" aria-label={`${species.nameZh} 可學招式`}>
                  {learnable.map((move) => {
                    const cost = moveLearnCost(move)
                    const insufficient = sp < cost
                    const reasonId = `trainer-learn-reason-${unit.id}-${move.id}`
                    const reason = insufficient ? `SP 不足：需要 ${cost}，目前 ${sp}` : `學習一次扣除 ${cost} SP`
                    return (
                      <article key={move.id} className="trainer-move-card trainer-move-card--learnable" role="listitem" data-move-id={move.id} data-move-state="learnable">
                        <MoveDefinition move={move} />
                        <div className="trainer-move-card__cost" id={reasonId}>{reason}</div>
                        <button
                          type="button"
                          className="btn btn--sm trainer-action trainer-action--learn"
                          ref={(element) => registerAction(`learn:${unit.id}:${move.id}`, element)}
                          disabled={busy || insufficient}
                          aria-describedby={reasonId}
                          aria-label={insufficient ? `學習 ${move.nameZh}：SP 不足` : `花費 ${cost} SP 學習 ${move.nameZh}`}
                          data-disabled-reason={insufficient ? 'sp-insufficient' : undefined}
                          onClick={() => learn(unit, move)}
                        >
                          {insufficient ? 'SP 不足' : `學習（${cost} SP）`}
                        </button>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <p className="trainer-empty-copy">目前沒有可學但尚未學會的招式。</p>
              )}
            </section>
          </div>
        )}
      </article>
    )
  }

  return (
    <ModalSurface
      title="📖 招式訓練所"
      description="查看真實招式資料、用 SP 學習，並調整固定 1–4 個 battle slots。"
      onClose={onClose}
      className="move-trainer-surface"
      headerAside={<span className="sp-badge" data-sp-ledger data-sp-current={sp}>✦ SP 餘額 {sp}</span>}
      footer={<div className="utility-foot">SP 與夥伴技能共用同一錢包；招式學習是一次性扣款。loadout 只在非戰鬥流程變更，下一場 battle 讀取已保存順序。</div>}
    >
      <div className="move-trainer" data-move-trainer data-move-trainer-initial={initialUnitId ?? ''} data-move-trainer-busy={busy ? 'true' : 'false'}>
        <div className="trainer-ledger" data-sp-ledger-summary>
          <span>可用 SP</span>
          <strong>{sp}</strong>
          <span>學招會扣 SP；裝備、卸下、排序不花 SP。</span>
        </div>
        {notice && !notice.unitId && <div className={`trainer-notice trainer-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
        {initialTargetMissing ? (
          <EmptyTrainerState onClose={onClose} message="找不到指定的 Mobie" />
        ) : roster.length === 0 ? (
          <EmptyTrainerState onClose={onClose} message="目前沒有可訓練的 Mobie" />
        ) : (
          <div className="trainer-units" role="list" aria-label="可訓練 Mobie">
            {roster.map((unit) => <div key={unit.id} role="listitem">{renderUnit(unit)}</div>)}
          </div>
        )}
        {openId && rosterById.has(openId) && <span className="sr-only" data-move-trainer-open-id>{openId}</span>}
      </div>
    </ModalSurface>
  )
}
