// M14.d — 戰鬥回放播放器（純顯示層）。把 canonical 事件流逐一「播放」：
// 折疊 events 重建雙方 HP / active（所見即所存），右側文字戰報同步高亮。
// 禁玩家輸入，改放播放控制（播放/暫停/單步/倍速）。沿用 report.ts 投影器 + 既有 modal 樣式。

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { audio } from '@/audio/audioEngine'
import type { BattleEvent, Side } from '@/game/battle/reducer'
import type { ReplayLog, DisplayUnitSnapshot } from '@/game/replay/types'
import { eventToReportLine, makeReportCtx } from '@/game/replay/report'

interface Step {
  turnIndex: number
  event: BattleEvent
  line: string | null
}

interface UnitState {
  snap: DisplayUnitSnapshot
  hp: number
  fainted: boolean
}

const SPEEDS = [0.5, 1, 2, 4]
const BASE_STEP_MS = 900

/** 把 turns 攤平成逐 event 的播放步；同時用 report 投影器算好每步的中文戰報行。 */
function buildSteps(log: ReplayLog): Step[] {
  const ctx = makeReportCtx(log.header.snapshot)
  const steps: Step[] = []
  log.turns.forEach((turn, turnIndex) => {
    for (const event of turn.events) steps.push({ turnIndex, event, line: eventToReportLine(event, ctx) })
  })
  return steps
}

/** 折疊 events[0..cursor]，重建雙方每隻 HP / 倒下 + 各方 active index。 */
function foldState(snapshot: DisplayUnitSnapshot[], events: BattleEvent[]) {
  const units = new Map<string, UnitState>()
  for (const s of snapshot) units.set(s.instanceId, { snap: s, hp: s.initialHp, fainted: s.initialHp <= 0 })
  const active: Record<Side, number> = { player: 0, foe: 0 }
  const set = (side: Side, index: number, hp: number) => {
    const u = units.get(`${side}:${index}`)
    if (u) { u.hp = Math.max(0, hp); if (u.hp <= 0) u.fainted = true }
  }
  for (const e of events) {
    switch (e.type) {
      case 'damageApplied': if (!e.missed) set(e.targetSide, e.targetIndex, e.hpAfter); break
      case 'heal': set(e.side, e.index, e.hpAfter); break
      case 'statusApplied': if (e.hpAfter != null) set(e.side, e.index, e.hpAfter); break
      case 'wildAccident': if (e.kind === 'intrusion' && e.side != null && e.index != null && e.hpAfter != null) set(e.side, e.index, e.hpAfter); break
      case 'memberFainted': set(e.side, e.index, 0); break
      case 'activeChanged': active[e.side] = e.toIndex; break
    }
  }
  return { units, active }
}

function HpRow({ u, isActive }: { u: UnitState; isActive: boolean }) {
  const pct = Math.round((u.hp / u.snap.maxHp) * 100)
  const color = pct > 50 ? '#4ad66d' : pct > 20 ? '#f0b429' : '#e7503a'
  return (
    <div className={`replay-unit ${isActive ? 'replay-unit--active' : ''} ${u.fainted ? 'replay-unit--fainted' : ''}`}>
      <div className="replay-unit__name">
        {isActive && <span className="replay-unit__dot">▶</span>}
        {u.snap.shiny && <span title="異色">✦</span>} {u.snap.displayName} <span className="replay-unit__lv">Lv.{u.snap.level}</span>
      </div>
      <div className="replay-hpbar"><div className="replay-hpbar__fill" style={{ width: `${pct}%`, background: color }} /></div>
      <div className="replay-unit__hp">{u.hp}/{u.snap.maxHp}</div>
    </div>
  )
}

function TeamColumn({ side, label, units, active }: { side: Side; label: string; units: Map<string, UnitState>; active: number }) {
  const members = [0, 1, 2].map((i) => units.get(`${side}:${i}`)).filter((u): u is UnitState => !!u)
  return (
    <div className="replay-team">
      <div className="replay-team__label">{label}</div>
      {members.map((u) => <HpRow key={u.snap.instanceId} u={u} isActive={u.snap.slot === active} />)}
    </div>
  )
}

export function ReplayPlayerModal({ log, onClose }: { log: ReplayLog; onClose: () => void }) {
  const steps = useMemo(() => buildSteps(log), [log])
  // cursor = 已播放到第幾步（0 = 開場、steps.length = 全部播完）
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const logRef = useRef<HTMLDivElement>(null)

  // 折疊已播放的事件重建 HP/active（事件數至多數百、純函式 <1ms，每步重折即可，不必增量）。
  const { units, active } = useMemo(
    () => foldState(log.header.snapshot, steps.slice(0, cursor).map((s) => s.event)),
    [log, steps, cursor],
  )

  // 自動播放：playing 時每隔 (BASE_STEP_MS / speed) 推進一步；播完即停。
  useEffect(() => {
    if (!playing || cursor >= steps.length) return
    const t = setTimeout(() => setCursor((c) => Math.min(steps.length, c + 1)), BASE_STEP_MS / speed)
    return () => clearTimeout(t)
  }, [playing, cursor, speed, steps.length])

  // 播完自動暫停
  useEffect(() => { if (cursor >= steps.length) setPlaying(false) }, [cursor, steps.length])

  // 戰報側欄自動捲到最新行
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [cursor])

  const visibleLines = steps.slice(0, cursor).map((s) => s.line).filter((l): l is string => l !== null)
  const atEnd = cursor >= steps.length

  const togglePlay = () => {
    audio.play('select')
    if (atEnd) { setCursor(0); setPlaying(true) } // 播完再按＝重播
    else setPlaying((p) => !p)
  }
  const step = (d: number) => { setPlaying(false); setCursor((c) => Math.min(steps.length, Math.max(0, c + d))) }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="modal-card replay-player" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__head">
          <div>
            <div className="h-title" style={{ fontSize: 22 }}>🎬 回放</div>
            <div className="h-sub">{log.header.outcome === 'win' ? '勝利' : '落敗'}　·　{steps.length} 個事件</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        <div className="replay-stage">
          <TeamColumn side="foe" label="對手" units={units} active={active.foe} />
          <TeamColumn side="player" label="我方" units={units} active={active.player} />
        </div>

        <div className="replay-report" ref={logRef}>
          {visibleLines.length === 0 && <div className="replay-report__line replay-report__line--cur">▶ 按播放開始回放…</div>}
          {visibleLines.map((line, i) => (
            <div key={i} className={`replay-report__line ${i === visibleLines.length - 1 ? 'replay-report__line--cur' : ''}`}>{line}</div>
          ))}
        </div>

        <div className="replay-controls">
          <button className="btn btn--ghost btn--sm" onClick={() => step(-1)} disabled={cursor === 0}>⏮ 上一步</button>
          <button className="btn btn--primary btn--sm" onClick={togglePlay}>{atEnd ? '🔁 重播' : playing ? '⏸ 暫停' : '▶ 播放'}</button>
          <button className="btn btn--ghost btn--sm" onClick={() => step(1)} disabled={atEnd}>下一步 ⏭</button>
          <div className="replay-speed">
            {SPEEDS.map((s) => (
              <button key={s} className={`btn btn--sm ${speed === s ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setSpeed(s)}>{s}×</button>
            ))}
          </div>
        </div>
        <div className="replay-progress"><div className="replay-progress__fill" style={{ width: `${steps.length ? (cursor / steps.length) * 100 : 0}%` }} /></div>
      </motion.div>
    </motion.div>
  )
}
