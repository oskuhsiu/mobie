// M24 Ticket 46 — replay playback is a read-only projection of decoded events.
// It never calls the battle reducer, resolver, RNG, settlement, or reward paths.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { audio } from '@/audio/audioEngine'
import type { Side, StatusEffect } from '@/game/battle/reducer'
import { lookupTerrain } from '@/game/data/terrains'
import {
  clampReplayCursor,
  flattenReplay,
  projectReplay,
  type ReplayProjection,
  type ReplayStep,
  type ReplayUnitProjection,
} from '@/game/replay/projection'
import type { ReplayLog } from '@/game/replay/types'
import { ModalSurface } from '@/ui/shell/ModalSurface'

const SPEEDS = [0.5, 1, 2, 4] as const
const BASE_STEP_MS = 900

function readReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function outcomeLabel(side: Side | null): string {
  if (side === 'player') return '我方獲勝'
  if (side === 'foe') return '對手獲勝'
  return '戰鬥進行中'
}

function finalOutcomeLabel(outcome: ReplayLog['header']['outcome']): string {
  return outcome === 'win' ? '勝利' : '落敗'
}

function terrainLabel(id: string): string {
  const terrain = lookupTerrain(id as Parameters<typeof lookupTerrain>[0])
  return terrain ? terrain.icon + ' ' + terrain.name : '未知地形（' + id + '）'
}

function statusIcon(status: StatusEffect): string {
  return status.mult >= 1 ? '▲' : '▼'
}

function StatusGroup({ side, statuses }: { side: Side; statuses: readonly StatusEffect[] }) {
  const label = side === 'player' ? '我方狀態' : '對手狀態'
  return (
    <div className="replay-status-group" data-replay-statuses={side} aria-label={label}>
      <strong>{label}</strong>
      {statuses.length === 0
        ? <span className="replay-status-group__empty">目前沒有已記錄狀態</span>
        : statuses.map((status, index) => (
          <span className="replay-status-chip" key={status.stat + ':' + status.source + ':' + index}>
            <span aria-hidden="true">{statusIcon(status)}</span>
            <span>{status.label}</span>
            <span className="replay-status-chip__turns">{status.remaining} 回合</span>
          </span>
        ))}
    </div>
  )
}

function ReplayField({ projection }: { projection: ReplayProjection }) {
  const { field } = projection
  const terrainText = !field.terrainKnown
    ? '場域：未記錄（尚未有地形事件）'
    : field.terrainIds.length === 0
      ? '場域：中性／無特殊地形'
      : '場域：' + field.terrainIds.map(terrainLabel).join('、')
  const chainText = field.chainCount === null
    ? '連鎖：尚無已記錄事件'
    : field.chainMax === null
      ? '連鎖：第 ' + field.chainCount + ' 段'
      : '連鎖：' + field.chainCount + '/' + field.chainMax

  return (
    <section className="replay-field" data-replay-field aria-label="場域與戰鬥狀態">
      <div className="replay-field__head">
        <h3>場域與狀態</h3>
        <span data-replay-chain>{chainText}</span>
      </div>
      <div className={'replay-field__terrain ' + (field.terrainKnown ? '' : 'replay-field__terrain--unknown')} data-replay-terrain>
        {terrainText}
      </div>
      <div className="replay-status-grid">
        <StatusGroup side="foe" statuses={field.enemyStatuses} />
        <StatusGroup side="player" statuses={field.teamStatuses} />
      </div>
      {field.comboCastEffects.length > 0 && (
        <div className="replay-combo-marks" data-replay-combo aria-label="合體技標記">
          <strong>合體技</strong>
          {field.comboCastEffects.map((mark) => (
            <span className="replay-combo-mark" key={mark.key}>
              <span aria-hidden="true">{mark.icon}</span> {mark.label} · {mark.remaining} 回合
            </span>
          ))}
        </div>
      )}
      {projection.degraded.length > 0 && (
        <div className="replay-degraded" role="status" data-replay-degraded>
          <strong>部分資料未記錄</strong>
          <span>{projection.degraded.join('；')}</span>
        </div>
      )}
    </section>
  )
}

function HpRow({ unit, isActive }: { unit: ReplayUnitProjection; isActive: boolean }) {
  const { snapshot } = unit
  const pct = snapshot.maxHp > 0 ? Math.round((unit.hp / snapshot.maxHp) * 100) : 0
  const color = pct > 50 ? '#4ad66d' : pct > 20 ? '#f0b429' : '#e7503a'
  const state = unit.fainted ? '已倒下' : isActive ? '出戰中' : '待命'
  return (
    <div
      className={'replay-unit ' + (isActive ? 'replay-unit--active ' : '') + (unit.fainted ? 'replay-unit--fainted' : '')}
      data-replay-unit={snapshot.instanceId}
      data-replay-hp={Math.round(unit.hp) + '/' + snapshot.maxHp}
      data-replay-active={isActive ? 'true' : 'false'}
      data-replay-fainted={unit.fainted ? 'true' : 'false'}
      role="group"
      aria-label={snapshot.displayName + '，' + state + '，HP ' + Math.round(unit.hp) + ' / ' + snapshot.maxHp}
    >
      <div className="replay-unit__name">
        {isActive && <span className="replay-unit__dot" aria-hidden="true">▶</span>}
        {snapshot.shiny && <span title="異色" aria-label="異色">✦</span>}
        <span>{snapshot.displayName}</span>
        <span className="replay-unit__lv">Lv.{snapshot.level}</span>
        <span className="replay-unit__state">{state}</span>
      </div>
      <div className="replay-hpbar" role="progressbar" aria-label={snapshot.displayName + ' HP'} aria-valuemin={0} aria-valuemax={snapshot.maxHp} aria-valuenow={Math.round(unit.hp)}>
        <div className="replay-hpbar__fill" style={{ width: Math.max(0, Math.min(100, pct)) + '%', background: color }} />
      </div>
      <div className="replay-unit__hp">{Math.round(unit.hp)}/{snapshot.maxHp}</div>
    </div>
  )
}

function TeamColumn({ side, label, projection }: { side: Side; label: string; projection: ReplayProjection }) {
  const members = [...projection.units.values()]
    .filter((unit) => unit.snapshot.side === side)
    .sort((a, b) => a.snapshot.slot - b.snapshot.slot)
  return (
    <section className="replay-team" data-replay-team={side} aria-label={label}>
      <div className="replay-team__label">{label}</div>
      {members.length === 0
        ? <div className="replay-team__empty">參戰資料未記錄</div>
        : members.map((unit) => (
          <HpRow key={unit.snapshot.instanceId} unit={unit} isActive={projection.active[side] === unit.snapshot.slot} />
        ))}
    </section>
  )
}

function openingLine(log: ReplayLog): string {
  const players = log.header.snapshot.filter((unit) => unit.side === 'player').map((unit) => unit.displayName)
  const foes = log.header.snapshot.filter((unit) => unit.side === 'foe').map((unit) => unit.displayName)
  return '【戰鬥開始】我方：' + (players.join('、') || '未記錄') + '　VS　對手：' + (foes.join('、') || '未記錄')
}

function ReplayTimeline({ log, steps, cursor, timelineRef }: {
  log: ReplayLog
  steps: readonly ReplayStep[]
  cursor: number
  timelineRef: React.RefObject<HTMLDivElement>
}) {
  const visible = steps.slice(0, cursor)
  const reportRows: Array<{ kind: 'turn' | 'event'; key: string; text: string; current?: boolean }> = []
  let lastTurn = -1
  for (const step of visible) {
    if (step.turnIndex !== lastTurn) {
      lastTurn = step.turnIndex
      reportRows.push({ kind: 'turn', key: 'turn-' + step.turnIndex, text: '— 第 ' + (step.turnIndex + 1) + ' 回合 —' })
    }
    if (step.reportLine) {
      reportRows.push({ kind: 'event', key: 'report-' + step.stepIndex, text: step.reportLine, current: step.stepIndex === cursor - 1 })
    }
  }
  return (
    <div className="replay-timeline" ref={timelineRef} data-replay-timeline>
      <section className="replay-report" data-replay-report aria-label="文字戰報">
        <div className="replay-report__line replay-report__line--opening">{openingLine(log)}</div>
        {steps.length === 0
          ? <div className="replay-report__line replay-report__line--cur" data-replay-empty>此回放沒有可播放的事件。</div>
          : reportRows.length === 0 && <div className="replay-report__line replay-report__line--cur">▶ 按播放開始回放…</div>}
        {reportRows.map((row) => (
          <div
            key={row.key}
            className={'replay-report__line ' + (row.kind === 'turn' ? 'replay-report__line--turn ' : '') + (row.current ? 'replay-report__line--cur' : '')}
            data-replay-report-line={row.kind}
            aria-current={row.current ? 'step' : undefined}
          >{row.text}</div>
        ))}
      </section>
      <section className="replay-feed" data-replay-feed aria-label="事件 feed" role="log" aria-live="polite">
        <div className="replay-feed__head"><h3>事件 Feed</h3><span>{cursor}/{steps.length}</span></div>
        {visible.length === 0
          ? <div className="replay-feed__empty">尚未播放事件；可用播放或單步開始。</div>
          : <ol>
            {visible.map((step) => (
              <li key={step.stepIndex} className={step.stepIndex === cursor - 1 ? 'replay-feed__entry--current' : ''} data-replay-feed-step={step.stepIndex} aria-current={step.stepIndex === cursor - 1 ? 'step' : undefined}>
                <span className="replay-feed__index">{step.stepIndex + 1}</span>
                <span className="replay-feed__turn">T{step.turnIndex + 1}</span>
                <span>{step.feedLine}</span>
              </li>
            ))}
          </ol>}
      </section>
    </div>
  )
}

export type ReplayPlayerLoadState = 'ready' | 'loading' | 'decode-error' | 'version-too-new' | 'empty'

function ReplayPlayerLoadStateView({ state, error, onRetry }: {
  state: Exclude<ReplayPlayerLoadState, 'ready'>
  error?: string
  onRetry?: () => void
}) {
  const copy = state === 'loading'
    ? { eyebrow: 'Replay Player', title: '正在載入回放…', body: '正在讀取本機 canonical event，請稍候。' }
    : state === 'version-too-new'
      ? { eyebrow: 'Replay Version', title: '此回放需要更新版本', body: error ?? '這筆回放由較新的遊戲版本產生，請更新後再試。' }
      : state === 'empty'
        ? { eyebrow: 'Replay Player', title: '此回放沒有可播放的事件', body: error ?? '回放仍可保留；清單可以重新整理或刪除它。' }
        : { eyebrow: 'Replay Player', title: '回放無法解碼', body: error ?? '這筆回放資料損毀或格式不完整。清單可以重新整理、重試或刪除它。' }
  return (
    <div className="replay-player__content replay-player__content--state" data-replay-player data-replay-state={state} data-replay-load-state={state}>
      <div className="replay-player__load-state" role={state === 'loading' ? 'status' : 'alert'}>
        <div className="eyebrow">{copy.eyebrow}</div>
        <h3>{copy.title}</h3>
        <p>{copy.body}</p>
        {onRetry && state !== 'loading' && <button type="button" className="btn btn--sm" data-replay-player-retry onClick={onRetry}>重新載入</button>}
      </div>
    </div>
  )
}

export function ReplayPlayerModal({ log, onClose, portal = false, loadState = 'ready', error, onRetry }: {
  log?: ReplayLog | null
  onClose: () => void
  portal?: boolean
  loadState?: ReplayPlayerLoadState
  error?: string
  onRetry?: () => void
}) {
  if (!log || loadState !== 'ready') {
    const state: Exclude<ReplayPlayerLoadState, 'ready'> = loadState === 'ready' ? 'decode-error' : loadState
    return (
      <ModalSurface title="🎬 回放" description="回放資料狀態" onClose={onClose} className="replay-player" portal={portal}>
        <ReplayPlayerLoadStateView state={state} error={error} onRetry={onRetry} />
      </ModalSurface>
    )
  }
  return <ReadyReplayPlayer log={log} onClose={onClose} portal={portal} />
}

function ReadyReplayPlayer({ log, onClose, portal = false }: { log: ReplayLog; onClose: () => void; portal?: boolean }) {
  const steps = useMemo(() => flattenReplay(log), [log])
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(() => !readReducedMotion() && steps.length > 0)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const timelineRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(false)
  const scrollOwnerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => {
      setReducedMotion(media.matches)
      if (media.matches) setPlaying(false)
    }
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      const nextHidden = typeof document !== 'undefined' && document.hidden
      setHidden(nextHidden)
      // Visibility recovery is intentionally paused. The user chooses when to
      // resume, so a background tab cannot silently skip a section of replay.
      if (nextHidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    const markOwner = () => {
      const owner = timelineRef.current?.closest<HTMLElement>('[data-modal-body]')
        ?? document.querySelector<HTMLElement>('.replay-player [data-modal-body]')
      if (!owner) return
      scrollOwnerRef.current = owner
      owner.dataset.replayScrollOwner = 'true'
    }
    markOwner()
    const frame = requestAnimationFrame(markOwner)
    const timer = window.setTimeout(markOwner, 160)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      if (scrollOwnerRef.current) delete scrollOwnerRef.current.dataset.replayScrollOwner
    }
  }, [])

  useEffect(() => {
    setCursor((current) => clampReplayCursor(current, steps.length))
    if (steps.length === 0 || reducedMotion || hidden) setPlaying(false)
  }, [hidden, reducedMotion, steps.length])

  const projection = useMemo(() => projectReplay(log, cursor), [log, cursor])
  const atEnd = cursor >= steps.length
  const currentStep = cursor > 0 ? steps[cursor - 1] : null

  useEffect(() => {
    if (!followRef.current || hidden) return
    const sync = () => {
      const timeline = timelineRef.current
      if (!timeline) return
      const owner = timeline.closest<HTMLElement>('[data-modal-body]') ?? timeline
      // Some embedded/headless WebViews ignore scroll during the first layout
      // pass; assigning the owner directly keeps footer controls reachable.
      owner.scrollTop = owner.scrollHeight
      owner.scrollTo({ top: owner.scrollHeight, behavior: 'auto' })
    }
    sync()
    const frame = requestAnimationFrame(() => {
      sync()
      followRef.current = false
    })
    const timer = window.setTimeout(() => {
      sync()
      followRef.current = false
    }, 160)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [cursor, hidden, reducedMotion])

  useEffect(() => {
    if (!playing || hidden || reducedMotion || cursor >= steps.length) return
    const timer = window.setTimeout(() => {
      followRef.current = true
      setCursor((current) => clampReplayCursor(current + 1, steps.length))
    }, BASE_STEP_MS / speed)
    return () => window.clearTimeout(timer)
  }, [cursor, hidden, playing, reducedMotion, speed, steps.length])

  useEffect(() => {
    if (cursor >= steps.length) setPlaying(false)
  }, [cursor, steps.length])

  const stepBy = useCallback((delta: number) => {
    setPlaying(false)
    followRef.current = delta > 0
    setCursor((current) => clampReplayCursor(current + delta, steps.length))
  }, [steps.length])

  const restart = useCallback(() => {
    setPlaying(false)
    followRef.current = false
    setCursor(0)
  }, [])

  const togglePlay = useCallback(() => {
    audio.play('select')
    if (atEnd) {
      followRef.current = true
      setCursor(0)
      setPlaying(!hidden && !reducedMotion && steps.length > 0)
      return
    }
    followRef.current = true
    setPlaying((current) => !current)
  }, [atEnd, hidden, reducedMotion, steps.length])

  const seek = useCallback((value: number) => {
    setPlaying(false)
    followRef.current = false
    setCursor(clampReplayCursor(value, steps.length))
  }, [steps.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const editing = target?.matches('input, textarea, select')
      if (editing) return
      if (event.key === ' ' && target?.closest('button, a')) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepBy(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepBy(1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        restart()
      } else if (event.key === 'End') {
        event.preventDefault()
        setPlaying(false)
        followRef.current = true
        setCursor(steps.length)
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        restart()
      } else if (event.key === ' ') {
        event.preventDefault()
        togglePlay()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [restart, stepBy, steps.length, togglePlay])

  const transportControls = (
    <>
      <div className="replay-controls" data-replay-controls aria-label="回放播放控制">
        <button type="button" className="btn btn--ghost btn--sm" data-replay-step-back onClick={() => stepBy(-1)} disabled={cursor === 0}>⏮ 上一步</button>
        <button type="button" className="btn btn--primary btn--sm" data-replay-toggle onClick={togglePlay} disabled={steps.length === 0} aria-pressed={playing}>{atEnd ? '🔁 重播' : playing ? '⏸ 暫停' : '▶ 播放'}</button>
        <button type="button" className="btn btn--ghost btn--sm" data-replay-step-forward onClick={() => stepBy(1)} disabled={atEnd}>下一步 ⏭</button>
        <button type="button" className="btn btn--ghost btn--sm" data-replay-restart onClick={restart} disabled={steps.length === 0}>↺ 重新開始</button>
        <div className="replay-speed" role="group" aria-label="播放速度" data-replay-speed-controls>
          {SPEEDS.map((value) => (
            <button type="button" key={value} className={'btn btn--sm ' + (speed === value ? 'btn--primary' : 'btn--ghost')} data-replay-speed-option={value} aria-pressed={speed === value} onClick={() => { setSpeed(value); if (playing) followRef.current = true }}>{value}×</button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost btn--sm replay-exit" data-replay-exit onClick={onClose}>退出回放</button>
      </div>
      <label className="replay-progress-control">
        <span>回放進度 {cursor}/{steps.length}</span>
        <input
          type="range"
          min={0}
          max={steps.length}
          step={1}
          value={cursor}
          onChange={(event) => seek(Number(event.currentTarget.value))}
          disabled={steps.length === 0}
          aria-label="回放進度"
          data-replay-scrubber
        />
      </label>
      <div className="replay-progress" data-replay-progress role="progressbar" aria-label="回放完成度" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={cursor}>
        <div className="replay-progress__fill" style={{ width: (steps.length ? (cursor / steps.length) * 100 : 0) + '%' }} />
      </div>
    </>
  )

  const replayState = hidden ? 'hidden' : reducedMotion ? 'reduced-motion' : steps.length === 0 ? 'empty' : atEnd ? 'complete' : playing ? 'playing' : 'paused'
  const headerOutcome = finalOutcomeLabel(log.header.outcome)
  const description = headerOutcome + '　·　事件 ' + cursor + '/' + steps.length + (currentStep ? '　·　第 ' + (currentStep.turnIndex + 1) + ' 回合' : '')

  return (
    <ModalSurface
      title="🎬 回放"
      description={description}
      onClose={onClose}
      className="replay-player"
      portal={portal}
      footer={transportControls}
    >
      <div
        className="replay-player__content"
        data-replay-player
        data-replay-battle-id={log.header.battleId}
        data-replay-state={replayState}
        data-replay-cursor={cursor}
        data-replay-event-count={steps.length}
        data-replay-turn={currentStep ? currentStep.turnIndex + 1 : 0}
        data-replay-playing={playing ? 'true' : 'false'}
        data-replay-speed={speed}
        data-replay-visibility={hidden ? 'hidden' : 'visible'}
        data-replay-reduced-motion={reducedMotion ? 'true' : 'false'}
      >
        <div className="replay-player__identity" data-replay-participants>
          <span>{log.header.snapshot.filter((unit) => unit.side === 'player').map((unit) => unit.displayName).join('、') || '我方資料未記錄'}</span>
          <span aria-hidden="true">VS</span>
          <span>{log.header.snapshot.filter((unit) => unit.side === 'foe').map((unit) => unit.displayName).join('、') || '對手資料未記錄'}</span>
          <span className="replay-player__outcome" data-replay-outcome={projection.outcome ?? 'pending'}>{outcomeLabel(projection.outcome)}</span>
        </div>

        <div className="replay-stage" data-replay-stage>
          <TeamColumn side="foe" label="對手" projection={projection} />
          <TeamColumn side="player" label="我方" projection={projection} />
        </div>

        <ReplayField projection={projection} />
        <ReplayTimeline log={log} steps={steps} cursor={cursor} timelineRef={timelineRef} />
      </div>
    </ModalSurface>
  )
}
