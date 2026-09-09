import { lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { buildBattleMobie } from '@/game/stats'
import { getBall } from '@/game/battle/engine'
import { audio } from '@/audio/audioEngine'
import { haptic } from '@/input/haptics'
import { INTENSITY_BY_MODE, type InteractMode } from '@/game/settings'
import { SwipeThrow, CircleSeal } from '@/ui/components/CaptureGestures'
import { isBossFloor, getAscension } from '@/game/tower'
import { getSpecies } from '@/game/data/species'
import { findMove } from '@/game/data/moves'
import { captureTargetOf } from '@/game/hunt'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { MobCard } from '@/ui/components/MobCard'
import { EvolutionOverlay } from '@/ui/components/EvolutionOverlay'
import type {
  CaptureDecision,
  CaptureOutcome,
  CaptureSettlementReceipt,
  EvolutionReceipt,
  TowerProgressionReceipt,
} from '@/game/resultSettlement'
import type { GameEvent, Outcome, TowerRun } from '@/game/machine/gameMachine'
import { TaskHeader } from '@/ui/shell/AppShell'
import { useOverlayController, type OverlayControllerApi } from '@/ui/shell/OverlayController'
import {
  useResultSettlementProjection,
  type ResultSettlementViewModel,
} from '@/store/resultSettlementProjection'

// 收服結果使用 DOM artwork billboard；Result 不需因捕獲 presentation 啟動 WebGL。
// 這讓 artwork 失敗、WebGL 不可用和瀏覽器縮放都沿用同一個可讀 fallback。
const TeamModal = lazy(() => import('@/ui/components/TeamModal').then((m) => ({ default: m.TeamModal })))

function Pokeball({ size = 64, color = '#ff5161' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="#f4f6ff" stroke="#11131a" strokeWidth="3" />
      <path d="M5 30a27 27 0 0 1 54 0z" fill={color} stroke="#11131a" strokeWidth="3" />
      <rect x="4" y="29" width="56" height="6" fill="#11131a" />
      <circle cx="32" cy="32" r="9" fill="#f4f6ff" stroke="#11131a" strokeWidth="3" />
      <circle cx="32" cy="32" r="3.6" fill="#cdd3f0" />
    </svg>
  )
}

type Stage = 'aim' | 'throw' | 'wobble' | 'seal' | 'result'

function WinView({
  onCaptured,
  decision,
  captureOutcome,
  duplicateConverted,
  interactionMode,
}: {
  onCaptured: (ok: boolean) => void
  decision: CaptureDecision
  captureOutcome: CaptureOutcome | null
  duplicateConverted: boolean
  interactionMode: InteractMode
}) {
  const { context } = useGame()
  const reducedMotion = useReducedMotion() ?? false
  // 所有狩獵畫面共用同一個 featured/capture target contract。
  const wild = useMemo(() => {
    const boss = captureTargetOf(context.foeTeam)
    return boss ? buildBattleMobie(boss) : null
  }, [context.foeTeam])
  // Ball roulette and the capture roll are decided by the Result child
  // coordinator. Gestures only advance this presentation.
  const ball = getBall(decision.ballId)
  const successRef = useRef(decision.caught)
  successRef.current = decision.caught
  const capMode = interactionMode
  const enhanced = capMode !== 'off'

  const [stage, setStage] = useState<Stage>(enhanced ? 'aim' : 'throw')
  const [sealRound, setSealRound] = useState(0)
  const finishedRef = useRef(false)
  // onCaptured 走 ref：結算時 roster 更新會讓父層 re-render，計時器不應被
  // callback identity 變動清掉，否則舞台會卡在 throw 階段。
  const onCapturedRef = useRef(onCaptured)
  onCapturedRef.current = onCaptured

  const reveal = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    setStage('result')
    if (successRef.current) { audio.play('capture'); haptic('capture') }
    onCapturedRef.current(successRef.current)
  }, [])

  // off：維持原自動流程；DOM 不出現任何手勢 wrapper。
  useEffect(() => {
    if (enhanced) return
    const t1 = setTimeout(() => setStage('wobble'), reducedMotion ? 0 : 650)
    const t2 = setTimeout(() => reveal(), reducedMotion ? 120 : 2500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [enhanced, reducedMotion, reveal])

  // 增強：丟球後自動推進（lite 直接 wobble→reveal；arcade 進 seal 由畫圈推進）。
  useEffect(() => {
    if (!enhanced) return
    if (stage === 'throw') {
      const t = setTimeout(() => setStage(capMode === 'arcade' ? 'seal' : 'wobble'), reducedMotion ? 0 : 600)
      return () => clearTimeout(t)
    }
    if (stage === 'wobble') {
      const t = setTimeout(() => reveal(), reducedMotion ? 120 : 1500)
      return () => clearTimeout(t)
    }
  }, [capMode, enhanced, reducedMotion, reveal, stage])

  // 畫圈封印完成：注定逃脫時給一次「再搏一下」（純演出、不改 caught）。
  const onSealed = useCallback(() => {
    if (!successRef.current && sealRound === 0) { setSealRound(1); return }
    reveal()
  }, [reveal, sealRound])

  if (!wild) {
    return <div className="result-capture-fallback" role="alert">找不到本場的收服目標；請返回區域重新開始。</div>
  }

  const caught = successRef.current
  const wobbling = stage === 'wobble' || stage === 'seal'
  const resolvedOutcome: CaptureOutcome = captureOutcome
    ?? (caught ? (duplicateConverted ? 'captured-duplicate-egg' : 'captured-new') : 'escaped')
  const outcomeCopy = resolvedOutcome === 'captured-duplicate-egg'
    ? `${wild.nameZh} 已擁有，這次捕獲已自動轉化為孵化蛋。`
    : resolvedOutcome === 'captured-new'
      ? `${wild.nameZh} 已加入你的收藏。`
      : `${wild.nameZh} 掙脫了寶貝球，這次沒有新增夥伴。`

  return (
    <div
      className="result-capture-stage"
      data-capture-stage
      data-capture-outcome={resolvedOutcome}
      aria-label={`收服演出：${wild.nameZh}`}
    >
      <div className="result-capture-stage__head">
        <span className="eyebrow">Capture presentation</span>
        <span className="result-capture-stage__ball" style={{ color: ball.color }}>🎯 {ball.nameZh}</span>
      </div>

      <div className="result-capture-stage__visual" aria-label={`${wild.nameZh} 收服目標`}>
        <MobieSprite
          src={wild.artworkUrl}
          alt={wild.nameZh}
          shiny={wild.shiny}
          className={stage === 'result' && caught ? 'result-capture-stage__target--captured' : undefined}
        />

        {stage !== 'result' || caught ? (
          <motion.div
            className="result-capture-stage__ball-art"
            initial={{ y: reducedMotion ? 0 : 160, scale: reducedMotion ? 1 : 0.4, opacity: 0, rotate: reducedMotion ? 0 : -40 }}
            animate={
              stage === 'aim'
                ? { y: reducedMotion ? 0 : 128, scale: reducedMotion ? 1 : 0.82, opacity: 1, rotate: 0 }
                : stage === 'throw'
                  ? { y: 0, scale: 1, opacity: 1, rotate: 0 }
                  : wobbling
                    ? { rotate: [0, -18, 16, -12, 8, 0], y: 0, scale: 1, opacity: 1 }
                    : { y: 0, scale: 1, opacity: 1 }
            }
            transition={reducedMotion
              ? { duration: 0 }
              : wobbling
                ? { duration: 1.6, times: [0, 0.2, 0.45, 0.65, 0.85, 1], repeat: stage === 'seal' ? Infinity : 0 }
                : { type: 'spring', stiffness: 140, damping: 12 }}
          >
            <Pokeball size={72} color={ball.color} />
          </motion.div>
        ) : null}

        {enhanced && stage === 'aim' && (
          <SwipeThrow mode={capMode} onThrow={() => setStage('throw')} />
        )}
        {enhanced && stage === 'seal' && (
          <CircleSeal
            key={sealRound}
            targetRad={INTENSITY_BY_MODE.arcade.circleTargetRad}
            onSealed={onSealed}
            label={sealRound === 0 ? '✦ 畫圈封印！' : '差一點…再搏一下！'}
          />
        )}

        <AnimatePresence>
          {stage === 'result' && caught && (
            <motion.div
              className="result-capture-stage__sparkles"
              initial={{ scale: reducedMotion ? 1 : 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reducedMotion ? { duration: 0 } : undefined}
              aria-hidden="true"
            >
              ✦✦✦
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {stage === 'result' && (
          <motion.div
            key={resolvedOutcome}
            className="result-capture-stage__result"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reducedMotion ? { duration: 0 } : undefined}
          >
            <div className={`result-capture-stage__result-title ${caught ? 'result-capture-stage__result-title--success' : ''}`}>
              {caught ? '收服成功！' : '可惜，逃脫了！'}
            </div>
            <div className="result-capture-stage__result-copy" data-result-outcome-copy>{outcomeCopy}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** M11 連勝塔 Result hero：只讀 XState 的 battle context，不產生任何進度副作用。 */
function TowerView({
  outcome,
  reason,
  tower,
}: {
  outcome: Outcome | null
  reason?: 'timeout'
  tower: TowerRun
}) {
  const isWin = outcome === 'win'
  const asc = getAscension(tower.ascension)
  const members = useMemo(() => tower.teamCards.map((card, index) => {
    try {
      return { card, index, mon: buildBattleMobie(card) }
    } catch {
      return { card, index, mon: null }
    }
  }), [tower.teamCards])
  const lead = members[0]?.mon
  const outcomeKey = !outcome ? 'pending' : reason === 'timeout' ? 'timeout' : isWin ? 'win' : 'lose'
  const title = !outcome
    ? '等待 Tower battle 結果'
    : reason === 'timeout'
      ? `第 ${tower.floor} 層時間到，${isWin ? '依剩餘 HP 判定突破' : '遠征結束'}`
      : isWin
        ? `第 ${tower.floor} 層突破！${isBossFloor(tower.floor) ? ' 🏆 BOSS' : ''}`
        : `第 ${tower.floor} 層止步，遠征結束`
  const description = !outcome
    ? '戰鬥結果尚未送達；獎勵整理完成前不能進入下一步。'
    : reason === 'timeout'
      ? `回合上限已到，勝負依剩餘 HP 判定；${isWin ? '你已突破本層。' : '本場遠征已結束。'}進度仍以已儲存的結果為準。`
      : isWin
        ? `已完成第 ${tower.floor} 層的 ${asc.name} 難度戰鬥，可以在獎勵整理完成後選擇第 ${tower.floor + 1} 層或結束遠征。`
        : '本場失敗會安全結束 run；已完成的 EXP、SP 與 Tower 進度仍會保留。'

  return (
    <section
      className="tower-result-hero"
      aria-labelledby="tower-result-hero-title"
      data-tower-result-hero
      data-tower-result-outcome={outcomeKey}
      data-tower-floor={tower.floor}
      data-tower-ascension={tower.ascension}
    >
      <div className="tower-result-hero__eyebrow eyebrow" style={{ color: !outcome ? 'var(--text-dim)' : isWin ? 'var(--good)' : 'var(--bad)' }}>
        🗼 連勝塔 · {asc.name} · 第 {tower.floor} 層
      </div>
      {lead && (
        <motion.div className="tower-result-hero__art" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 140, damping: 13 }}>
          <MobieSprite src={lead.artworkUrl} alt={lead.nameZh} />
        </motion.div>
      )}
      <h2 id="tower-result-hero-title" className="h-title tower-result-hero__title">{title}</h2>
      <p className="h-sub tower-result-hero__description">{description}</p>

      <div className="tower-result-facts" role="list" aria-label="Tower 本場資訊">
        <div role="listitem"><span>本場 stakes</span><strong>{!outcome ? '等待戰鬥結果' : isWin ? `突破第 ${tower.floor} 層` : `止步第 ${tower.floor} 層`}</strong></div>
        <div role="listitem"><span>隊伍順序</span><strong>1 → 2 → 3 固定沿用</strong></div>
        <div role="listitem"><span>捕獲規則</span><strong>連勝塔不開放捕獲</strong></div>
      </div>

      <ol className="tower-result-team" aria-label="本場 Tower 隊伍順序" data-tower-result-team>
        {members.map(({ card, index, mon }) => (
          <li key={card.cardId} data-tower-result-team-slot={index + 1}>
            <span className="tower-result-team__order">{index + 1}</span>
            {mon ? <span aria-hidden="true"><MobieSprite src={mon.artworkUrl} alt="" className="tower-result-team__sprite" /></span> : <span className="tower-result-team__fallback" aria-hidden="true">✦</span>}
            <span className="tower-result-team__name">{mon?.nameZh ?? `Mobie #${card.speciesId}`}</span>
            <span className="tower-result-team__level">Lv.{card.level}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ResultSection({
  kind,
  eyebrow,
  title,
  description,
  children,
}: {
  kind: string
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  const titleId = `result-${kind}-title`
  return (
    <section className={`result-section result-section--${kind}`} data-result-section={kind} aria-labelledby={titleId}>
      <header className="result-section__head">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h2 id={titleId}>{title}</h2>
        </div>
        <p>{description}</p>
      </header>
      <div className="result-section__body">{children}</div>
    </section>
  )
}

function RewardSection({
  results,
  skillPoints,
  spReward,
  status,
  isWin,
}: Pick<ResultSettlementViewModel, 'results' | 'skillPoints' | 'spReward' | 'status' | 'isWin'>) {
  const settled = status === 'settled'
  const expTotal = results.reduce((sum, result) => sum + result.gained, 0)
  const spDelta = skillPoints?.delta ?? spReward
  return (
    <ResultSection
      kind="rewards"
      eyebrow="01 · Rewards"
      title="本場獎勵"
      description={status === 'idle' ? '等待戰鬥結果；收到後才會整理 EXP 與 SP。' : isWin ? '戰鬥結果已分開記錄 EXP 與 SP。' : '敗北仍保留已完成的戰鬥經驗；本場不發 SP。'}
    >
      <div className="result-reward-grid">
        <article className={`result-reward-card ${settled ? '' : 'result-reward-card--pending'}`} data-result-reward="exp" data-result-reward-status={status}>
          <div className="result-reward-card__label">戰鬥 EXP</div>
          <strong>{settled ? `+${expTotal} EXP` : '結算中…'}</strong>
          <span>{settled ? (results.length > 0 ? `${results.length} 位參戰夥伴各自收到 EXP。` : '本場沒有可顯示的 EXP 變更。') : '等待 EXP 整理完成。'}</span>
        </article>
        <article className={`result-reward-card ${settled ? '' : 'result-reward-card--pending'}`} data-result-reward="sp" data-result-reward-status={status}>
          <div className="result-reward-card__label">帳號 SP</div>
          <strong>{settled ? `+${spDelta} SP` : '結算中…'}</strong>
          <span>{status === 'idle' ? '等待結果整理完成。' : isWin ? '可在招式訓練與夥伴技能使用。' : '敗北不增加技能點。'}</span>
        </article>
      </div>
      {settled && (
        <div className="result-reward-list exp-summary" role="list" aria-label="參戰夥伴 EXP 進度">
          {results.length > 0 ? results.map((result) => (
            <div className="result-reward-row" role="listitem" key={result.unit.id}>
              <span className="result-reward-row__name">{getSpecies(result.unit.speciesId).nameZh}</span>
              <span className="result-reward-row__exp">+{result.gained} EXP</span>
              <span className="result-reward-row__level">{result.leveledUp ? `Lv.${result.fromLevel} → Lv.${result.toLevel}` : `Lv.${result.toLevel} 維持`}</span>
            </div>
          )) : <div className="result-empty-copy" role="listitem">本場沒有可顯示的 EXP 變更。</div>}
        </div>
      )}
    </ResultSection>
  )
}

function ProgressionSection({
  results,
  moveLearns,
  incubator,
  status,
  eyebrow = '02 · Progression',
}: Pick<ResultSettlementViewModel, 'results' | 'moveLearns' | 'incubator' | 'status'> & { eyebrow?: string }) {
  const settled = status === 'settled'
  const levelUps = results.filter((result) => result.leveledUp)
  const eggUpdates = incubator?.updates ?? []
  return (
    <ResultSection
      kind="progression"
      eyebrow={eyebrow}
      title="成長進度"
      description="EXP、升級、招式學習與既有孵化進度各自呈現，互不覆蓋。"
    >
      {!settled ? (
        <div className="result-pending-card">正在整理參戰夥伴的成長進度…</div>
      ) : (
        <div className="result-progression-grid">
          <article className="result-progression-card" data-result-progression="levels">
            <div className="result-progression-card__head"><span>等級</span><b>{levelUps.length > 0 ? `${levelUps.length} 位升級` : '本場無升級'}</b></div>
            <div className="result-progression-card__list" role="list" aria-label="等級進度">
              {results.length > 0 ? results.map((result) => (
                <div key={result.unit.id} role="listitem">
                  <span>{getSpecies(result.unit.speciesId).nameZh}</span>
                  <strong>{result.leveledUp ? `Lv.${result.fromLevel} → Lv.${result.toLevel}` : `Lv.${result.toLevel}・距離下一級持續累積`}</strong>
                </div>
              )) : <span className="result-empty-copy">沒有可顯示的等級資料。</span>}
            </div>
          </article>

          <article className="result-progression-card" data-result-progression="moves">
            <div className="result-progression-card__head"><span>新招式</span><b>{moveLearns.length > 0 ? `${moveLearns.reduce((sum, item) => sum + item.moveIds.length, 0)} 招` : '沒有新招式'}</b></div>
            <div className="result-progression-card__list">
              {moveLearns.length > 0 ? moveLearns.flatMap((learn) => learn.moveIds.map((moveId) => (
                <div key={`${learn.unitId}:${moveId}`}><span>{getSpecies(results.find((result) => result.unit.id === learn.unitId)?.unit.speciesId ?? 1).nameZh}</span><strong>{findMove(moveId)?.nameZh ?? `招式 #${moveId}`}</strong></div>
              ))) : <span className="result-empty-copy">本場沒有新的招式學習。</span>}
            </div>
          </article>

          <article className="result-progression-card" data-result-progression="incubator">
            <div className="result-progression-card__head"><span>孵化進度</span><b>{incubator ? `+${incubator.amount} 點` : '沒有待培育的蛋'}</b></div>
            <div className="result-progression-card__list">
              {eggUpdates.length > 0 ? eggUpdates.map((update) => (
                <div key={update.eggId}><span>{update.eggId}</span><strong>{update.beforeProgress} → {update.afterProgress}</strong></div>
              )) : <span className="result-empty-copy">目前沒有既有蛋需要更新。</span>}
            </div>
          </article>
        </div>
      )}
    </ResultSection>
  )
}

function DuplicateEggSummary({ receipt }: { receipt: CaptureSettlementReceipt | null }) {
  const egg = receipt?.egg
  const speciesId = egg?.speciesPool[0] ?? receipt?.target.speciesId
  const species = speciesId ? getSpecies(speciesId) : null
  const pct = egg ? Math.min(100, Math.round((egg.progress / Math.max(1, egg.requiredProgress)) * 100)) : 0
  const inherited = egg?.inheritedMoveId ? findMove(egg.inheritedMoveId) : null
  return (
    <article className="result-duplicate-egg" data-result-duplicate-egg>
      <div className="result-duplicate-egg__icon" aria-hidden="true">🥚</div>
      <div className="result-duplicate-egg__body">
        <div className="result-duplicate-egg__title">重複捕獲 → 孵化蛋</div>
        <p>{species ? `你已經擁有 ${species.nameZh}，本次收服不會誤稱為新夥伴。` : '你已經擁有這個物種，本次收服已轉化為孵化蛋。'}</p>
        {egg ? (
          <>
            <div className="result-duplicate-egg__meta"><span>{egg.label}</span><span>{egg.progress} / {egg.requiredProgress}</span></div>
            <div className="result-duplicate-egg__track" role="progressbar" aria-label={`${egg.label} 孵化進度`} aria-valuenow={egg.progress} aria-valuemin={0} aria-valuemax={egg.requiredProgress}>
              <div style={{ width: `${pct}%` }} />
            </div>
            {inherited && <div className="result-duplicate-egg__move">🧬 蛋招：{inherited.nameZh}</div>}
          </>
        ) : <div className="result-empty-copy">孵化蛋進度正在同步，請稍後到孵化所查看。</div>}
      </div>
    </article>
  )
}

function CapturedNewActions({
  mon,
  unitExp,
  controller,
  inspectRef,
  collectionRef,
}: {
  mon: ReturnType<typeof buildBattleMobie>
  unitExp: number | undefined
  controller: OverlayControllerApi
  inspectRef: React.RefObject<HTMLButtonElement>
  collectionRef: React.RefObject<HTMLButtonElement>
}) {
  return (
    <div className="result-capture-new capture-companion-actions" data-result-capture-new>
      <div className="result-capture-new__copy">
        <span className="eyebrow">Captured new</span>
        <strong>{mon.nameZh} · Lv.{mon.level} 已加入收藏</strong>
        <span>可先查看這隻新夥伴的 MobCard，再回到結果繼續。</span>
      </div>
      <div className="result-capture-new__actions">
        <button
          ref={inspectRef}
          className="btn btn--sm"
          data-result-capture-detail
          aria-label="查看新夥伴"
          onClick={() => controller.push({
            id: `mobie-detail:${mon.speciesId}`,
            policy: 'escape-and-backdrop',
            content: <MobCard mon={mon} owner ownerExp={unitExp} revealed onClose={controller.pop} />,
          }, { restoreFocus: () => inspectRef.current })}
        >
          🔎 查看新夥伴
        </button>
        <button
          ref={collectionRef}
          className="btn btn--ghost btn--sm"
          data-result-my-mobies
          aria-label="我的 Mobie"
          onClick={() => controller.open({
            id: 'team',
            policy: 'escape-and-backdrop',
            content: <TeamModal onClose={controller.close} />,
          }, { restoreFocus: () => collectionRef.current })}
        >
          ✦ 我的 Mobie
        </button>
      </div>
    </div>
  )
}

function CaptureEvolutionSection({
  canCapture,
  resultMode,
  isWin,
  status,
  captureDecision,
  captureOutcome,
  captureReceipt,
  duplicateConverted,
  captureMode,
  onCaptured,
  captureDone,
  evolutions,
  capturedMobie: capturedMon,
  capturedUnit,
  controller,
  inspectRef,
  collectionRef,
}: Pick<ResultSettlementViewModel, 'canCapture' | 'resultMode' | 'isWin' | 'status' | 'captureDecision' | 'captureOutcome' | 'captureReceipt' | 'duplicateConverted' | 'captureMode' | 'evolutions' | 'capturedMobie' | 'capturedUnit'> & {
  onCaptured: (ok: boolean) => void
  captureDone: boolean
  controller: OverlayControllerApi
  inspectRef: React.RefObject<HTMLButtonElement>
  collectionRef: React.RefObject<HTMLButtonElement>
}) {
  const evolutionText = evolutions.length > 0 ? `${evolutions.length} 次進化已完成` : '本場沒有進化'
  return (
    <ResultSection
      kind="capture-evolution"
      eyebrow="03 · Capture / evolution"
      title="收服與進化"
      description={canCapture ? '收服結果以已儲存的判定為準；演出只呈現已決定的結果。' : '本場不開放收服，仍完整保留進化回條。'}
    >
      <div className="result-evolution-summary" data-result-evolution-state={evolutions.length > 0 ? 'completed' : 'none'}>
        <div className="result-evolution-summary__head"><span>進化</span><b>{status === 'settled' ? evolutionText : '結算中…'}</b></div>
        {status === 'settled' && evolutions.length > 0 ? (
          <div className="result-evolution-summary__list" role="list" aria-label="進化紀錄">
            {evolutions.map((evolution) => (
              <div key={`${evolution.unitId}:${evolution.toSpecies}`} role="listitem">
                <span>{getSpecies(evolution.fromSpecies).nameZh}</span>
                <strong>→ {getSpecies(evolution.toSpecies).nameZh} · Lv.{evolution.atLevel}</strong>
              </div>
            ))}
          </div>
        ) : status === 'settled' ? <p className="result-empty-copy">沒有進化的夥伴也會保留本場 EXP 與 SP。</p> : null}
      </div>

      {canCapture ? (
        status !== 'settled' ? (
          <div className="result-pending-card" data-result-capture-state="pending">正在準備固定的捕獲判定與收服演出…</div>
        ) : captureDecision ? (
          <>
            <WinView
              onCaptured={onCaptured}
              decision={captureDecision}
              captureOutcome={captureOutcome}
              duplicateConverted={duplicateConverted}
              interactionMode={captureMode}
            />
            {captureDone && captureOutcome === 'captured-new' && capturedMon && (
              <CapturedNewActions
                mon={capturedMon}
                unitExp={capturedUnit?.exp}
                controller={controller}
                inspectRef={inspectRef}
                collectionRef={collectionRef}
              />
            )}
            {captureDone && (captureOutcome === 'captured-duplicate-egg' || duplicateConverted) && <DuplicateEggSummary receipt={captureReceipt} />}
          </>
        ) : <div className="result-pending-card" data-result-capture-state="pending">捕獲判定尚未完成，請稍候。</div>
      ) : (
        <div className="result-no-capture" data-result-capture-state="unavailable">
          <span className="result-no-capture__icon" aria-hidden="true">{status === 'idle' ? '⏳' : isWin ? '⚔️' : '🛡️'}</span>
          <div>
            <strong>{status === 'idle' ? '等待戰鬥結果' : isWin && resultMode === 'arena' ? '競技場不開放捕獲' : '敗北不進入捕獲階段'}</strong>
            <p>{status === 'idle' ? '戰鬥結果尚未送達；目前沒有任何獎勵或下一步操作可提交。' : isWin && resultMode === 'arena' ? '這場只結算 EXP、SP 與既有進度；想收服夥伴請前往野外區域。' : '你被擊敗了；先整理隊伍與屬性，再從區域重新挑戰。'}</p>
          </div>
        </div>
      )}
    </ResultSection>
  )
}

function ResultErrorPanel({
  projection,
  retry,
  onBack,
  backRef,
}: {
  projection: ResultSettlementViewModel['projection']
  retry: () => void
  onBack: () => void
  backRef?: React.RefObject<HTMLButtonElement>
}) {
  return (
    <div className="result-error" role="alert" data-result-error>
      <div className="result-error__copy">
        <span className="eyebrow">Result recovery</span>
        <strong>{projection.error?.message ?? '結果整理失敗，請重試。'}</strong>
        <span>已完成的獎勵會在重試時對帳，捕獲判定不會重新抽取。</span>
      </div>
      <div className="result-error__actions">
        <button
          className="btn btn--sm"
          data-result-retry
          disabled={projection.error?.code === 'collision'}
          title={projection.error?.code === 'collision' ? '此結果識別碼已衝突，請返回並重新開始。' : undefined}
          onClick={retry}
        >
          重試結算
        </button>
        <button ref={backRef} className="btn btn--ghost btn--sm" data-result-error-back onClick={onBack}>回到區域</button>
      </div>
    </div>
  )
}

function NextActionSection({
  status,
  captureDone,
  showEvo,
  onNext,
  onRegions,
}: {
  status: ResultSettlementViewModel['status']
  captureDone: boolean
  showEvo: boolean
  onNext: () => void
  onRegions: () => void
}) {
  const ready = status === 'settled' && captureDone && !showEvo
  const reason = status === 'running'
    ? '結算完成後才能使用下一步。'
    : status === 'idle'
      ? '尚未收到戰鬥結果。'
      : !captureDone
        ? '收服演出完成後才能繼續。'
        : showEvo
          ? '進化演出完成後才能繼續。'
          : null
  return (
    <ResultSection
      kind="next"
      eyebrow="04 · Next action"
      title="下一步"
      description={ready ? '選擇下一場，或回到區域查看其他目的地。' : '完成必要的整理與演出後，合法操作才會開啟。'}
    >
      {ready ? (
        <div className="result-next__actions" data-result-next-actions>
          <button className="btn" data-result-next="play-again" onClick={onNext}>🔄 再戰一場</button>
          <button className="btn btn--ghost" data-result-next="regions" onClick={onRegions}>🗺 回到區域</button>
        </div>
      ) : (
        <div className="result-next__pending" data-result-cta-state={status === 'running' ? 'disabled' : 'presentation-pending'}>
          {reason ?? '下一步暫時不可用。'}
        </div>
      )}
    </ResultSection>
  )
}

function TowerProgressionSection({
  tower,
  receipt,
  receiptMatches,
  status,
}: {
  tower: TowerRun
  receipt: TowerProgressionReceipt | null
  receiptMatches: boolean
  status: ResultSettlementViewModel['status']
}) {
  return (
    <ResultSection
      kind="tower-progression"
      eyebrow="02 · Tower progression"
      title="連勝塔進度"
      description="最高樓層與 Ascension 解鎖只在進度儲存完成後顯示。"
    >
      {status !== 'settled' ? (
        <div className="result-pending-card" data-result-tower-receipt="pending">等待 Tower 進度儲存完成；完成前不能繼續下一層。</div>
      ) : !receipt ? (
        <div className="result-missing-receipt" role="alert" data-result-tower-receipt="missing">
          <strong>Tower 進度尚未完成儲存</strong>
          <span>目前只保留安全返回；請重試結果整理或回到 Region Hub，已完成的獎勵不會重複發放。</span>
        </div>
      ) : !receiptMatches ? (
        <div className="result-missing-receipt" role="alert" data-result-tower-receipt="stale">
          <strong>儲存的 Tower 進度與本場不一致</strong>
          <span>目前樓層 {tower.floor} 的結果已標記為過期，不能繼續下一層。</span>
        </div>
      ) : (
        <div className="result-tower-progression" data-result-tower-receipt="ready" data-result-tower-run-state={receipt.outcome === 'win' ? 'continue' : 'ended'}>
          <div className="result-tower-progression__grid" role="list" aria-label="Tower 已保存進度">
            <article role="listitem" data-result-tower-metric="floor">
              <span>本場樓層</span>
              <strong>第 {receipt.floor} 層</strong>
              <small>{receipt.outcome === 'win' ? '已突破，下一層會沿用這支隊伍重新開始。' : '本場止步，遠征已安全結束。'}</small>
            </article>
            <article role="listitem" data-result-tower-metric="best-floor">
              <span>歷史最高</span>
              <strong>第 {receipt.after.bestFloor} 層</strong>
              <small>只會向上保留，不受離開 Result 影響。</small>
            </article>
            <article role="listitem" data-result-tower-metric="ascension">
              <span>Ascension 解鎖</span>
              <strong>A{receipt.after.ascensionUnlocked} · {getAscension(receipt.after.ascensionUnlocked).name}</strong>
              <small>{receipt.after.ascensionUnlocked > receipt.before.ascensionUnlocked ? '本場解鎖新難度。' : '沒有新增難度，既有解鎖保持不變。'}</small>
            </article>
          </div>
        </div>
      )}
    </ResultSection>
  )
}

function TowerEvolutionSection({
  evolutions,
  receiptMatches,
  status,
}: {
  evolutions: EvolutionReceipt[]
  receiptMatches: boolean
  status: ResultSettlementViewModel['status']
}) {
  return (
    <ResultSection
      kind="tower-evolution"
      eyebrow="04 · Evolution"
      title="進化紀錄"
      description="進化只呈現已儲存的成長結果；演出完成後才能離開這場遠征。"
    >
      {status !== 'settled' ? (
        <div className="result-pending-card">正在整理進化進度…</div>
      ) : !receiptMatches ? (
        <div className="result-missing-receipt">進化進度與本場不一致，請安全返回區域。</div>
      ) : evolutions.length === 0 ? (
        <div className="result-empty-copy">本場沒有進化，已完成的 EXP 與 Tower 進度仍會保留。</div>
      ) : (
        <div className="result-evolution-summary__list" role="list" aria-label="Tower 進化紀錄">
          {evolutions.map((evolution) => (
            <div key={`${evolution.unitId}:${evolution.toSpecies}`} role="listitem">
              <span>{getSpecies(evolution.fromSpecies).nameZh}</span>
              <strong>→ {getSpecies(evolution.toSpecies).nameZh} · Lv.{evolution.atLevel}</strong>
            </div>
          ))}
        </div>
      )}
    </ResultSection>
  )
}

function TowerRecoveryPanel({
  title,
  copy,
  actionLabel,
  actionRef,
  onAction,
  disabled = false,
}: {
  title: string
  copy: string
  actionLabel: string
  actionRef: React.RefObject<HTMLButtonElement>
  onAction: () => void
  disabled?: boolean
}) {
  return (
    <div className="result-tower-recovery" role="alert" data-result-tower-recovery>
      <div>
        <span className="eyebrow">Tower Result recovery</span>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
      <button ref={actionRef} type="button" className="btn btn--ghost btn--sm" onClick={onAction} disabled={disabled}>{actionLabel}</button>
    </div>
  )
}

function TowerResultBody({
  outcome,
  reason,
  tower,
  status,
  projection,
  results,
  skillPoints,
  spReward,
  moveLearns,
  incubator,
  towerReceipt,
  receiptMatches,
  evolutions,
  showEvo,
  leaving,
  retry,
  onContinue,
  onQuit,
  onEvolutionDone,
  primaryActionRef,
}: {
  outcome: Outcome | null
  reason?: 'timeout'
  tower: TowerRun
  status: ResultSettlementViewModel['status']
  projection: ResultSettlementViewModel['projection']
  results: ResultSettlementViewModel['results']
  skillPoints: ResultSettlementViewModel['skillPoints']
  spReward: number
  moveLearns: ResultSettlementViewModel['moveLearns']
  incubator: ResultSettlementViewModel['incubator']
  towerReceipt: TowerProgressionReceipt | null
  receiptMatches: boolean
  evolutions: EvolutionReceipt[]
  showEvo: boolean
  leaving: boolean
  retry: () => void
  onContinue: () => void
  onQuit: () => void
  onEvolutionDone: () => void
  primaryActionRef: React.RefObject<HTMLButtonElement>
}) {
  const isWin = outcome === 'win'
  const canContinue = status === 'settled' && isWin && receiptMatches && !showEvo && !leaving
  return (
    <>
      <TowerView outcome={outcome} reason={reason} tower={tower} />
      <RewardSection results={results} skillPoints={skillPoints} spReward={spReward} status={status} isWin={isWin} />
      <TowerProgressionSection tower={tower} receipt={towerReceipt} receiptMatches={receiptMatches} status={status} />
      <ProgressionSection results={results} moveLearns={moveLearns} incubator={incubator} status={status} eyebrow="03 · Progression" />
      <TowerEvolutionSection evolutions={evolutions} receiptMatches={receiptMatches} status={status} />

      {status === 'running' && (
        <div className="settlement-status result-settlement-status" role="status" aria-live="polite" data-settlement-announcement>
          獎勵整理進行中，EXP、SP、孵化與 Tower 進度儲存完成前，下一層暫時停用。
        </div>
      )}
      {status === 'error' && <ResultErrorPanel projection={projection} retry={retry} onBack={onQuit} backRef={primaryActionRef} />}
      {status === 'idle' && (
        <TowerRecoveryPanel
          title="尚未收到 Tower 戰鬥結果"
          copy="目前沒有可用的結果資料；請安全返回 Region Hub 後重新開始遠征。"
          actionLabel="安全返回區域"
          actionRef={primaryActionRef}
          onAction={onQuit}
          disabled={leaving}
        />
      )}
      {status === 'settled' && !receiptMatches && (
        <TowerRecoveryPanel
          title="這場遠征暫時不能繼續"
          copy="Tower 進度尚未完成或與本場不一致；請重試結果整理，或安全返回，已完成的獎勵不會重複發放。"
          actionLabel="安全返回區域"
          actionRef={primaryActionRef}
          onAction={onQuit}
          disabled={leaving}
        />
      )}

      {!showEvo && status === 'settled' && receiptMatches && (
        <motion.div className="row center result-tower-actions" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} data-result-next-actions>
          {isWin && <button ref={primaryActionRef} type="button" className="btn" data-result-next="tower-continue" onClick={onContinue} disabled={!canContinue} aria-disabled={!canContinue}>⬆ 攻向第 {tower.floor + 1} 層</button>}
          <button ref={!isWin ? primaryActionRef : undefined} type="button" className="btn btn--ghost" data-result-next="tower-quit" onClick={onQuit} disabled={leaving}>🏳 結束遠征</button>
        </motion.div>
      )}
      {status === 'running' && (
        <TowerRecoveryPanel
          title="可以安全離開目前 Result"
          copy="離開後會安全完成已開始的獎勵整理，不會重複發放已完成的獎勵。"
          actionLabel="安全返回區域"
          actionRef={primaryActionRef}
          onAction={onQuit}
          disabled={leaving}
        />
      )}
      <AnimatePresence>
        {showEvo && <EvolutionOverlay evolutions={evolutions} onDone={onEvolutionDone} />}
      </AnimatePresence>
    </>
  )
}

export function ResultScreen() {
  const { context, send } = useGame()
  const controller = useOverlayController()
  const settlement = useResultSettlementProjection(context)
  const {
    isWin,
    outcome,
    tower,
    canCapture,
    resultMode,
    status: settlementStatus,
    projection,
    identity: settlementIdentity,
    captureDecision,
    captureOutcome,
    captureReceipt,
    capturedUnit,
    capturedMobie: capturedMon,
    duplicateConverted: dupConverted,
    results: lastResults,
    evolutions: lastEvolutions,
    moveLearns: lastMoveLearns,
    skillPoints,
    towerReceipt,
    incubator,
    spReward,
    captureMode,
    invalidTowerContext,
    retry: retrySettlement,
    markLeft,
  } = settlement
  const [captureDone, setCaptureDone] = useState(!canCapture)

  // Gesture state is presentation-only. A new logical Result resets its reveal
  // gate while the durable projection remains owned by the coordinator.
  const presentationIdentity = `${settlementIdentity?.resultId ?? ''}:${settlementIdentity?.resultFingerprint ?? ''}`
  const [mountedIdentity, setMountedIdentity] = useState(presentationIdentity)
  const [evoDone, setEvoDone] = useState(false)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (mountedIdentity === presentationIdentity) return
    setMountedIdentity(presentationIdentity)
    setCaptureDone(!canCapture)
    setEvoDone(false)
    setLeaving(false)
  }, [canCapture, mountedIdentity, presentationIdentity])
  const showEvo = settlementStatus === 'settled' && captureDone && !evoDone && lastEvolutions.length > 0

  const onCaptured = useCallback((ok: boolean) => {
    const captured = captureReceipt ? captureReceipt.outcome !== 'escaped' : ok
    send({ type: 'SET_CAPTURED', captured })
    setCaptureDone(true)
  }, [captureReceipt, send])

  const leavingRef = useRef(false)
  const leaveResult = useCallback((event: GameEvent) => {
    if (leavingRef.current) return
    leavingRef.current = true
    setLeaving(true)
    void markLeft().catch(() => undefined).finally(() => send(event))
  }, [markLeft, send])

  const inspectRef = useRef<HTMLButtonElement>(null)
  const collectionRef = useRef<HTMLButtonElement>(null)
  const towerActionRef = useRef<HTMLButtonElement>(null)

  // Result reuses the route viewport between Battle and Result. Reset its
  // scroll position for each logical result, then focus the first safe CTA so
  // keyboard and screen-reader users remain inside the current Tower flow.
  useLayoutEffect(() => {
    const viewport = document.querySelector<HTMLElement>('[data-screen-viewport]')
    viewport?.scrollTo?.({ top: 0, left: 0 })
  }, [presentationIdentity, tower])

  useLayoutEffect(() => {
    if (!tower) return
    const shouldFocus = invalidTowerContext
      || settlementStatus === 'idle'
      || settlementStatus === 'error'
      || (settlementStatus === 'settled' && !showEvo)
    if (!shouldFocus) return
    const focus = () => towerActionRef.current?.focus({ preventScroll: true })
    focus()
    queueMicrotask(focus)
  }, [invalidTowerContext, settlementStatus, showEvo, tower])

  useEffect(() => {
    if (!tower) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.body.dataset.overlayOpen === 'true') return
      event.preventDefault()
      leaveResult({ type: 'TOWER_QUIT' })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [leaveResult, tower])

  if (tower && invalidTowerContext) {
    return (
      <div
        className="result-screen result-screen--tower col"
        data-result
        data-result-mode="tower"
        data-result-outcome={outcome ?? 'pending'}
        data-result-tower-result-state="invalid"
        data-result-settlement-status={settlementStatus}
        data-result-settlement-attempt={projection.attempt}
      >
        <TaskHeader
          className="result-screen__header"
          eyebrow="Step 4 · Result · Tower"
          title="Tower 結果需要恢復"
          tagline="目前的樓層或隊伍資料已過期，沒有任何結果或獎勵會在這裡重新套用。"
        />
        <TowerRecoveryPanel
          title="找不到合法的遠征內容"
          copy="請返回 Region Hub 重新選擇遠征；已儲存的進度會保留，安全返回不會重複發放獎勵。"
          actionLabel="返回 Region Hub"
          actionRef={towerActionRef}
          onAction={() => leaveResult({ type: 'TOWER_QUIT' })}
          disabled={leaving}
        />
      </div>
    )
  }

  if (tower) {
    const towerTitle = !outcome
      ? '等待 Tower battle 結果'
      : context.battleResult?.reason === 'timeout'
        ? `第 ${tower.floor} 層時間到，${isWin ? '依 HP 判定突破' : '遠征結束'}`
        : isWin
          ? `第 ${tower.floor} 層突破`
          : `第 ${tower.floor} 層遠征結束`
    const towerTagline = !outcome
      ? '戰鬥結果尚未送達；獎勵整理完成後才會顯示下一步。'
      : context.battleResult?.reason === 'timeout'
        ? `回合上限判定本場結果；${isWin ? '你已依剩餘 HP 突破本層。' : '本場遠征已結束。'}進度仍以已儲存內容為準。`
        : isWin
          ? `固定隊伍已完成 ${getAscension(tower.ascension).name} 難度；獎勵整理完成後可攻向第 ${tower.floor + 1} 層，或結束遠征。`
          : '本場失敗會安全結束 run；已完成的 EXP、SP、孵化與解鎖進度會保留。'
    const receiptMatches = Boolean(
      towerReceipt
      && outcome
      && towerReceipt.outcome === outcome
      && towerReceipt.floor === tower.floor
      && towerReceipt.ascension === tower.ascension,
    )
    const towerReceiptState = !towerReceipt ? 'missing' : receiptMatches ? 'ready' : 'stale'
    const towerRunState = settlementStatus !== 'settled'
      ? 'pending'
      : receiptMatches && towerReceipt?.outcome === 'win'
        ? 'continue'
        : outcome
          ? 'ended'
          : 'pending'
    const continueTower = () => {
      if (settlementStatus !== 'settled' || !isWin || !receiptMatches || showEvo || leaving) return
      leaveResult({ type: 'TOWER_CONTINUE' })
    }
    const quitTower = () => leaveResult({ type: 'TOWER_QUIT' })
    return (
      <div
        className="result-screen result-screen--tower col"
        data-result
        data-result-mode="tower"
        data-result-outcome={outcome ?? 'pending'}
        data-result-reason={context.battleResult?.reason ?? 'natural'}
        data-result-tower-result-state={!outcome ? 'pending' : context.battleResult?.reason === 'timeout' ? 'timeout' : isWin ? 'win' : 'lose'}
        data-result-tower-run-state={towerRunState}
        data-result-tower-receipt={towerReceiptState}
        data-result-settlement-status={settlementStatus}
        data-result-settlement-attempt={projection.attempt}
        aria-busy={settlementStatus === 'running'}
      >
        <TaskHeader className="result-screen__header" eyebrow="Step 4 · Result · Tower" title={towerTitle} tagline={towerTagline} />
        <div className="result-summary" data-result-summary>
          <TowerResultBody
            outcome={outcome}
            reason={context.battleResult?.reason}
            tower={tower}
            status={settlementStatus}
            projection={projection}
            results={lastResults}
            skillPoints={skillPoints}
            spReward={spReward}
            moveLearns={lastMoveLearns}
            incubator={incubator}
            towerReceipt={towerReceipt}
            receiptMatches={receiptMatches}
            evolutions={lastEvolutions}
            showEvo={showEvo}
            leaving={leaving}
            retry={retrySettlement}
            onContinue={continueTower}
            onQuit={quitTower}
            onEvolutionDone={() => setEvoDone(true)}
            primaryActionRef={towerActionRef}
          />
        </div>
      </div>
    )
  }

  const modeLabel = resultMode === 'wild' ? '野外' : '競技場'
  const outcomeTitle = !outcome
    ? '等待戰鬥結果'
    : isWin
      ? resultMode === 'arena' ? '競技勝利！' : `${modeLabel}勝利`
      : '戰鬥失敗'
  const outcomeTagline = !outcome
    ? '戰鬥結果尚未送達；獎勵整理完成後才會開放下一步。'
    : isWin
      ? resultMode === 'wild' ? '先確認戰鬥獎勵，再完成收服與進化，最後選擇下一步。' : '競技場只結算實際 EXP、SP 與成長進度，不會進入捕獲。'
      : `這場${modeLabel}對戰已結束；已完成的 EXP 會保留，整理好隊伍後再挑戰。`

  return (
    <div
      className={`result-screen result-screen--${resultMode} col`}
      data-result
      data-result-mode={resultMode}
      data-result-outcome={outcome ?? 'pending'}
      data-result-capture-outcome={captureOutcome ?? 'pending'}
      data-result-evolution-count={lastEvolutions.length}
      data-result-settlement-status={settlementStatus}
      data-result-settlement-attempt={projection.attempt}
      aria-busy={settlementStatus === 'running'}
    >
      <TaskHeader
        className="result-screen__header"
        eyebrow={`Step 4 · Result · ${modeLabel}`}
        title={outcomeTitle}
        tagline={outcomeTagline}
      />

      <div className="result-summary" data-result-summary>
        <RewardSection results={lastResults} skillPoints={skillPoints} spReward={spReward} status={settlementStatus} isWin={isWin} />
        <ProgressionSection results={lastResults} moveLearns={lastMoveLearns} incubator={incubator} status={settlementStatus} />
        <CaptureEvolutionSection
          canCapture={canCapture}
          resultMode={resultMode}
          isWin={isWin}
          status={settlementStatus}
          captureDecision={captureDecision}
          captureOutcome={captureOutcome}
          captureReceipt={captureReceipt}
          duplicateConverted={dupConverted}
          captureMode={captureMode}
          onCaptured={onCaptured}
          captureDone={captureDone}
          evolutions={lastEvolutions}
          capturedMobie={capturedMon}
          capturedUnit={capturedUnit}
          controller={controller}
          inspectRef={inspectRef}
          collectionRef={collectionRef}
        />

        {settlementStatus === 'running' && (
          <div className="settlement-status result-settlement-status" role="status" aria-live="polite" data-settlement-announcement>
            結算進行中，獎勵完成後才能繼續。<span data-result-cta-state="disabled">下一步操作暫時停用。</span>
          </div>
        )}
        {settlementStatus === 'error' && (
          <ResultErrorPanel projection={projection} retry={retrySettlement} onBack={() => leaveResult({ type: 'TO_REGIONS' })} />
        )}

        <NextActionSection
          status={settlementStatus}
          captureDone={captureDone}
          showEvo={showEvo}
          onNext={() => leaveResult({ type: 'PLAY_AGAIN' })}
          onRegions={() => leaveResult({ type: 'TO_REGIONS' })}
        />
      </div>

      <AnimatePresence>
        {showEvo && <EvolutionOverlay evolutions={lastEvolutions} onDone={() => setEvoDone(true)} />}
      </AnimatePresence>
    </div>
  )
}
