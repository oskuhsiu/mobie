// M24 Ticket 41 — canonical Incubator projection and durable hatch reveal.
import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useIncubator } from '@/store/incubatorStore'
import { isHatchable, isSupportedEggSource } from '@/game/incubator'
import { getSpecies } from '@/game/data/species'
import { findMove } from '@/game/data/moves'
import { GradeBadge } from '@/ui/components/GradeBadge'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { GestureGate } from '@/ui/components/GestureGate'
import { useSettings } from '@/store/settingsStore'
import { interactModeOf } from '@/game/settings'
import { audio } from '@/audio/audioEngine'
import { buildBattleMobie } from '@/game/stats'
import { ownedToCard } from '@/game/growth'
import type { HatchReceipt } from '@/game/incubatorHatch'
import { ModalSurface } from '@/ui/shell/ModalSurface'
import { useOverlayController } from '@/ui/shell/OverlayController'

const SOURCE_LABEL: Record<string, string> = {
  achievement: '成就獎勵',
  duplicate: '重複捕獲轉化',
  tower: '舊資料（不可孵化）',
}

const INCUBATOR_PAGE_SIZE = 24

function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? '未知來源（不可孵化）'
}

type EggRowState = 'incubating' | 'ready' | 'hatching' | 'invalid-source' | 'error'

export function IncubatorModal({ onClose }: { onClose: () => void }) {
  const eggs = useIncubator((state) => state.state.eggs)
  const loaded = useIncubator((state) => state.loaded)
  const loadError = useIncubator((state) => state.loadError)
  const load = useIncubator((state) => state.load)
  const hatchBusy = useIncubator((state) => state.hatchBusy)
  const hatchErrors = useIncubator((state) => state.hatchErrors)
  const hatchOutbox = useIncubator((state) => state.state.hatchOutbox)
  const pendingHatchEggs = useMemo(
    () => new Set((hatchOutbox ?? []).filter((entry) => entry.status === 'pending').map((entry) => entry.eggId)),
    [hatchOutbox],
  )
  const hatch = useIncubator((state) => state.hatchWithReceipt)
  const reconcileHatches = useIncubator((state) => state.reconcileHatches)
  // M22.i：孵化前摩擦生熱只影響 presentation；canonical hatch 仍由
  // durable coordinator 決定。off＝直接孵化，timeout／skip 也只跳過演出。
  const rubOn = useSettings((state) => interactModeOf(state.settings, 'hatch') !== 'off')
  const controller = useOverlayController()
  const [page, setPage] = useState(1)
  const globalError = hatchErrors['*']
  const rootState = loadError
    ? 'error'
    : !loaded
      ? 'loading'
      : eggs.length === 0
        ? 'empty'
        : eggs.every((egg) => !isSupportedEggSource(egg.source))
          ? 'invalid-source'
          : 'ready'

  const pageCount = Math.max(1, Math.ceil(eggs.length / INCUBATOR_PAGE_SIZE))
  const visibleEggs = eggs.slice((page - 1) * INCUBATOR_PAGE_SIZE, page * INCUBATOR_PAGE_SIZE)
  const hasMoreEggs = page < pageCount

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const doHatch = async (id: string) => {
    try {
      const receipt = await hatch(id)
      if (!receipt) return
      audio.play('capture')
      controller.push({
        id: `hatch-reveal:${receipt.eggId}`,
        policy: 'escape-and-backdrop',
        content: <HatchReveal receipt={receipt} onClose={controller.pop} />,
      }, { restoreFocus: restoreEggFocus(receipt.eggId) })
    } catch {
      // The store retains a row-scoped error and pending outbox. Keeping the
      // Incubator mounted makes the Retry action immediately available.
    }
  }

  const restoreEggFocus = (id: string) => () => [...document.querySelectorAll<HTMLElement>('[data-egg-hatch]')]
    .find((element) => element.closest<HTMLElement>('[data-egg-id]')?.dataset.eggId === id) ?? null

  const onHatchClick = (id: string) => {
    if (!rubOn) { void doHatch(id); return }
    controller.push({
      id: `hatch:${id}`,
      policy: 'explicit-action-only',
      content: (
        <GestureGate
          title="🔥 摩擦生熱"
          icon="🥚"
          hint="來回快速摩擦蛋殼，幫小生命破殼！"
          skipLabel="跳過演出"
          timeoutHint="逾時會直接完成孵化；結果仍會完整寫入 roster 與圖鑑。"
          onComplete={() => { controller.pop(); void doHatch(id) }}
          onCancel={controller.pop}
        />
      ),
    }, { restoreFocus: restoreEggFocus(id) })
  }

  return (
    <ModalSurface
      title="🥚 孵化所"
      description="成就獎勵與重複捕獲蛋會隨有效戰鬥累積進度；完成後才能孵化。"
      onClose={onClose}
      className="incubator-surface"
    >
      <div
        className="modal-surface__stack"
        data-incubator-root
        data-incubator-state={rootState}
        data-incubator-total={eggs.length}
        data-incubator-dom-cap={visibleEggs.length}
        data-incubator-page={page}
        data-incubator-page-count={pageCount}
        aria-live="polite"
      >
        {rootState === 'loading' && (
          <div className="incubator-state incubator-state--loading" data-incubator-state="loading" role="status">
            <span className="incubator-state__icon" aria-hidden="true">⏳</span>
            <b>孵化所資料載入中…</b>
            <span>正在讀取本機的 canonical 蛋資料。</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { try { load() } catch { /* keep the visible loading state */ } }}>重新載入</button>
          </div>
        )}
        {rootState === 'error' && (
          <div className="incubator-state incubator-state--error" data-incubator-state="error" role="alert">
            <span className="incubator-state__icon" aria-hidden="true">⚠️</span>
            <b>孵化所需要再試一次</b>
            <span>{loadError ?? '目前無法讀取孵化所資料。請返回後重新載入。'}</span>
            <button type="button" className="btn btn--sm" onClick={() => { try { load() } catch { /* keep the visible recovery state */ } }}>重新載入</button>
          </div>
        )}
        {globalError && (
          <div className="incubator-state incubator-state--error" data-incubator-global-error role="alert">
            <b>孵化結果需要再對帳</b>
            <span>{globalError}</span>
            <button type="button" className="btn btn--sm" onClick={() => { void reconcileHatches() }}>再試一次</button>
          </div>
        )}
        {rootState === 'empty' && (
          <div className="incubator-state incubator-state--empty" data-incubator-state="empty">
            <span className="incubator-state__icon" aria-hidden="true">🥚</span>
            <b>孵化所目前是空的</b>
            <span>還沒有蛋。領取成就獎勵，或在野外重複捕獲已擁有的 Mobie，就會取得合法的蛋。</span>
          </div>
        )}
        {(rootState === 'ready' || rootState === 'invalid-source') && visibleEggs.map((egg) => {
          const validSource = isSupportedEggSource(egg.source)
          const ready = validSource && isHatchable(egg)
          const error = hatchErrors[egg.id]
          const pending = pendingHatchEggs.has(egg.id)
          const busy = hatchBusy === egg.id || (pending && !error)
          const canHatch = ready || pending
          const rowState: EggRowState = !validSource
              ? 'invalid-source'
              : error
                ? 'error'
                : busy
                  ? 'hatching'
                  : ready ? 'ready' : 'incubating'
          const required = Math.max(1, egg.requiredProgress)
          const progress = Math.max(0, Math.min(required, Math.floor(egg.progress)))
          const remaining = Math.max(0, required - progress)
          const percent = Math.round((progress / required) * 100)
          const inheritedMove = egg.inheritedMoveId ? findMove(egg.inheritedMoveId) : null
          return (
            <article
              key={egg.id}
              className={`egg-row egg-row--${rowState}`}
              data-egg-id={egg.id}
              data-egg-source={egg.source}
              data-egg-state={rowState}
            >
              <span className="egg-row__icon" aria-hidden="true">{rowState === 'ready' ? '🐣' : rowState === 'invalid-source' ? '⚠️' : '🥚'}</span>
              <div className="egg-row__body">
                <div className="egg-row__top">
                  <span className="egg-row__label">{egg.label || '孵化蛋'}</span>
                  <span className="egg-row__src">{sourceLabel(egg.source)}</span>
                </div>
                <div
                  className="egg-row__track"
                  role="progressbar"
                  aria-label={`${egg.label || '孵化蛋'} 孵化進度`}
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={required}
                >
                  <div className="egg-row__fill" style={{ width: `${percent}%` }} />
                </div>
                <div className="egg-row__prog" data-egg-progress>{progress} / {required} · 還需 {remaining}</div>
                {inheritedMove && <div className="egg-row__inherit">🧬 蛋招：{inheritedMove.nameZh}</div>}
                {rowState === 'invalid-source' && <div className="egg-row__error" role="alert">來源不受支援，這顆蛋不會產生孵化結果。</div>}
                {error && <div className="egg-row__error" role="alert" data-egg-error>{error}</div>}
              </div>
              <button
                type="button"
                className="btn btn--sm"
                data-egg-hatch
                disabled={!canHatch || busy}
                onClick={() => { if (canHatch && !busy) onHatchClick(egg.id) }}
              >
                {busy ? '孵化處理中…' : error ? '再試一次' : ready ? '孵化' : rowState === 'invalid-source' ? '無法孵化' : '培育中'}
              </button>
            </article>
          )
        })}
        {(rootState === 'ready' || rootState === 'invalid-source') && (page > 1 || hasMoreEggs) && (
          <div className="incubator-pagination" data-incubator-pagination>
            <button type="button" className="btn btn--ghost btn--sm" data-incubator-page-prev disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>← 上一頁</button>
            <span>第 {page} / {pageCount} 頁</span>
            {hasMoreEggs && <button type="button" className="btn btn--ghost btn--sm incubator-load-more" data-incubator-load-more onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>下一頁 →</button>}
          </div>
        )}
      </div>
    </ModalSurface>
  )
}

type BattleNumericStat = 'maxHp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'
const STAT_LABELS: ReadonlyArray<readonly [BattleNumericStat, string]> = [
  ['maxHp', 'HP'],
  ['atk', '攻擊'],
  ['def', '防禦'],
  ['spa', '特攻'],
  ['spd', '特防'],
  ['spe', '速度'],
]

export function HatchReveal({ receipt, onClose }: { receipt: HatchReceipt; onClose: () => void }) {
  const reducedMotion = useReducedMotion() ?? false
  const species = getSpecies(receipt.unit.speciesId)
  const battle = buildBattleMobie(ownedToCard(receipt.unit))
  const [artworkState, setArtworkState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const source = sourceLabel(receipt.egg.source)
  return (
    <ModalSurface
      title="🎉 孵化結果"
      description="canonical roster 與圖鑑已完成對帳；這裡只展示本次孵化結果。"
      onClose={onClose}
      className="hatch-surface"
      closeLabel="收下夥伴"
    >
      <div className="hatch-reveal hatch-reveal--surface" data-hatch-reveal data-testid="hatch-reveal" data-hatch-state="hatched" data-hatch-operation-id={receipt.hatchOperationId} data-hatch-fingerprint={receipt.hatchFingerprint} onClick={onClose}>
        <motion.div
          className="hatch-reveal__mon"
          initial={reducedMotion ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0, filter: 'brightness(5)' }}
          animate={{ scale: 1, opacity: 1, filter: 'brightness(1)' }}
          transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 150, damping: 13 }}
          onClick={(event) => event.stopPropagation()}
        >
          <MobieSprite
            src={species.artworkUrl}
            alt={species.nameZh}
            shiny={receipt.unit.shiny}
            onStateChange={setArtworkState}
          />
        </motion.div>
        <div className="hatch-reveal__caption" onClick={(event) => event.stopPropagation()}>
          <span>孵出了 <b>{species.nameZh}</b>！</span>
          <GradeBadge indiv={receipt.unit} speciesId={receipt.unit.speciesId} />
        </div>
        <div className="hatch-reveal__facts" onClick={(event) => event.stopPropagation()}>
          <div className="hatch-reveal__fact-grid">
            <span>來源</span><b>{source}</b>
            <span>等級</span><b>Lv.{receipt.unit.level}</b>
            <span>個體</span><b>{receipt.unit.shiny ? '閃耀' : '標準'}</b>
            <span>Artwork</span><b>{artworkState === 'failed' ? '輪廓 fallback' : artworkState === 'loaded' ? '已載入' : '載入中…'}</b>
          </div>
          <div className="hatch-reveal__stats" aria-label="孵出個體能力值">
            {STAT_LABELS.map(([key, label]) => <span key={label}><small>{label}</small><b>{battle[key]}</b></span>)}
          </div>
        </div>
        <div className="hatch-reveal__feed" role="status" onClick={(event) => event.stopPropagation()}>
          <span>✓ 已加入 roster</span>
          <span>✓ 已登錄 Dex #{String(species.id).padStart(3, '0')}</span>
          {receipt.unit.learnedMoveIds?.length ? <span>🧬 已保留 {receipt.unit.learnedMoveIds.length} 個可用招式</span> : null}
        </div>
        <button type="button" className="btn hatch-reveal__dismiss" data-hatch-dismiss onClick={(event) => { event.stopPropagation(); onClose() }}>完成</button>
        <div className="h-sub">點擊背景、按 Escape 或選擇「完成」關閉</div>
      </div>
    </ModalSurface>
  )
}
