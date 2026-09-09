import { lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
} from '@/game/resultSettlement'
import type { GameEvent, TowerRun } from '@/game/machine/gameMachine'
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

/** M11 連勝塔結算畫面：突破/敗北 + 樓層 + 難度階；無捕獲。 */
function TowerView({ isWin, tower }: { isWin: boolean; tower: TowerRun }) {
  const { context } = useGame()
  const lead = useMemo(() => (context.playerTeam[0] ? buildBattleMobie(context.playerTeam[0]) : null), [context.playerTeam])
  const asc = getAscension(tower.ascension)
  return (
    <div className="tower-result-hero center">
      <motion.div className="eyebrow" style={{ color: isWin ? 'var(--good)' : 'var(--bad)' }}
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>🗼 連勝塔 · {asc.name}</motion.div>
      {lead && (
        <motion.div className="tower-result-hero__art"
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 140, damping: 13 }}>
          <MobieSprite src={lead.artworkUrl} alt={lead.nameZh} />
        </motion.div>
      )}
      {isWin ? (
        <>
          <div className="h-title" style={{ fontSize: 28 }}>第 {tower.floor} 層突破！{isBossFloor(tower.floor) ? ' 🏆 BOSS' : ''}</div>
          <div className="h-sub">繼續攻向第 {tower.floor + 1} 層，或見好就收結算。</div>
        </>
      ) : (
        <>
          <div className="h-title" style={{ fontSize: 28 }}>遠征結束 · 到達第 {tower.floor} 層</div>
          <div className="h-sub">已結算本場經驗與 SP。下次挑戰更高樓層！</div>
        </>
      )}
    </div>
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
      description={status === 'idle' ? '等待 battle handoff 回條；收到結果後才會整理 EXP 與 SP。' : isWin ? '戰鬥回條已分開記錄 EXP 與 SP。' : '敗北仍保留已完成的戰鬥經驗；本場不發 SP。'}
    >
      <div className="result-reward-grid">
        <article className={`result-reward-card ${settled ? '' : 'result-reward-card--pending'}`} data-result-reward="exp" data-result-reward-status={status}>
          <div className="result-reward-card__label">戰鬥 EXP</div>
          <strong>{settled ? `+${expTotal} EXP` : '結算中…'}</strong>
          <span>{settled ? (results.length > 0 ? `${results.length} 位參戰夥伴各自收到回條。` : '本場沒有可顯示的 EXP 變更。') : '等待 roster 回條完成。'}</span>
        </article>
        <article className={`result-reward-card ${settled ? '' : 'result-reward-card--pending'}`} data-result-reward="sp" data-result-reward-status={status}>
          <div className="result-reward-card__label">帳號 SP</div>
          <strong>{settled ? `+${spDelta} SP` : '結算中…'}</strong>
          <span>{status === 'idle' ? '等待結果回條。' : isWin ? '可在招式訓練與夥伴技能使用。' : '敗北不增加技能點。'}</span>
        </article>
      </div>
      {settled && (
        <div className="result-reward-list exp-summary" role="list" aria-label="參戰夥伴 EXP 回條">
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
}: Pick<ResultSettlementViewModel, 'results' | 'moveLearns' | 'incubator' | 'status'>) {
  const settled = status === 'settled'
  const levelUps = results.filter((result) => result.leveledUp)
  const eggUpdates = incubator?.updates ?? []
  return (
    <ResultSection
      kind="progression"
      eyebrow="02 · Progression"
      title="成長進度"
      description="EXP、升級、招式學習與既有孵化進度各自呈現，互不覆蓋。"
    >
      {!settled ? (
        <div className="result-pending-card">正在整理參戰夥伴的成長回條…</div>
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
        ) : <div className="result-empty-copy">孵化蛋回條正在同步，請稍後到孵化所查看。</div>}
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
      description={canCapture ? '收服結果來自 projection 回條；演出只呈現已決定的結果。' : '本場不開放收服，仍完整保留進化回條。'}
    >
      <div className="result-evolution-summary" data-result-evolution-state={evolutions.length > 0 ? 'completed' : 'none'}>
        <div className="result-evolution-summary__head"><span>進化</span><b>{status === 'settled' ? evolutionText : '結算中…'}</b></div>
        {status === 'settled' && evolutions.length > 0 ? (
          <div className="result-evolution-summary__list" role="list" aria-label="進化回條">
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
        ) : <div className="result-pending-card" data-result-capture-state="pending">捕獲回條尚未可讀，請稍候。</div>
      ) : (
        <div className="result-no-capture" data-result-capture-state="unavailable">
          <span className="result-no-capture__icon" aria-hidden="true">{status === 'idle' ? '⏳' : isWin ? '⚔️' : '🛡️'}</span>
          <div>
            <strong>{status === 'idle' ? '等待戰鬥結果' : isWin && resultMode === 'arena' ? '競技場不開放捕獲' : '敗北不進入捕獲階段'}</strong>
            <p>{status === 'idle' ? 'battle handoff 尚未送達；目前沒有任何獎勵或下一步操作可提交。' : isWin && resultMode === 'arena' ? '這場只結算 EXP、SP 與既有進度；想收服夥伴請前往野外區域。' : '你被擊敗了；先整理隊伍與屬性，再從區域重新挑戰。'}</p>
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
}: {
  projection: ResultSettlementViewModel['projection']
  retry: () => void
  onBack: () => void
}) {
  return (
    <div className="result-error" role="alert" data-result-error>
      <div className="result-error__copy">
        <span className="eyebrow">Result recovery</span>
        <strong>{projection.error?.message ?? 'Result 結算失敗，請重試。'}</strong>
        <span>已完成的子回條會在重試時對帳，捕獲判定不會重新抽取。</span>
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
        <button className="btn btn--ghost btn--sm" data-result-error-back onClick={onBack}>回到區域</button>
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
      description={ready ? '選擇下一場，或回到區域查看其他目的地。' : '完成必要的回條與演出後，合法操作才會開啟。'}
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

function TowerResultBody({
  isWin,
  tower,
  status,
  projection,
  results,
  evolutions,
  showEvo,
  retry,
  onContinue,
  onQuit,
  onEvolutionDone,
}: {
  isWin: boolean
  tower: TowerRun
  status: ResultSettlementViewModel['status']
  projection: ResultSettlementViewModel['projection']
  results: ResultSettlementViewModel['results']
  evolutions: EvolutionReceipt[]
  showEvo: boolean
  retry: () => void
  onContinue: () => void
  onQuit: () => void
  onEvolutionDone: () => void
}) {
  return (
    <>
      <TowerView isWin={isWin} tower={tower} />
      {results.length > 0 && (
        <div className="exp-summary" data-result-tower-exp>
          <div className="exp-summary__head">獲得經驗</div>
          {results.map((result) => (
            <div key={result.unit.id} className="exp-row">
              <span className="exp-row__name">{getSpecies(result.unit.speciesId).nameZh}</span>
              <span className="exp-row__exp">+{result.gained} EXP</span>
              {result.leveledUp && <span className="exp-row__up">Lv.{result.fromLevel}→{result.toLevel}！</span>}
            </div>
          ))}
        </div>
      )}
      {status === 'running' && <div className="settlement-status" role="status" aria-live="polite" data-settlement-announcement>結算進行中，獎勵完成後才能繼續。<span data-result-cta-state="disabled">下一步操作暫時停用。</span></div>}
      {status === 'error' && <ResultErrorPanel projection={projection} retry={retry} onBack={onQuit} />}
      <AnimatePresence>
        {status === 'settled' && !showEvo && (
          <motion.div className="row center result-tower-actions" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            {isWin && <button className="btn" data-result-next="tower-continue" onClick={onContinue}>⬆ 攻向第 {tower.floor + 1} 層</button>}
            <button className="btn btn--ghost" data-result-next="tower-quit" onClick={onQuit}>🏳 結束遠征</button>
          </motion.div>
        )}
      </AnimatePresence>
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
    incubator,
    spReward,
    captureMode,
    retry: retrySettlement,
    markLeft,
  } = settlement
  const [captureDone, setCaptureDone] = useState(!canCapture)

  // Gesture state is presentation-only. A new logical Result resets its reveal
  // gate while the durable projection remains owned by the coordinator.
  const presentationIdentity = `${settlementIdentity?.resultId ?? ''}:${settlementIdentity?.resultFingerprint ?? ''}`
  const [mountedIdentity, setMountedIdentity] = useState(presentationIdentity)
  const [evoDone, setEvoDone] = useState(false)
  useEffect(() => {
    if (mountedIdentity === presentationIdentity) return
    setMountedIdentity(presentationIdentity)
    setCaptureDone(!canCapture)
    setEvoDone(false)
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
    void markLeft().catch(() => undefined).finally(() => send(event))
  }, [markLeft, send])

  const inspectRef = useRef<HTMLButtonElement>(null)
  const collectionRef = useRef<HTMLButtonElement>(null)

  if (tower) {
    return (
      <div
        className="result-screen result-screen--tower col"
        data-result
        data-result-mode="tower"
        data-result-outcome={outcome ?? 'pending'}
        data-result-settlement-status={settlementStatus}
        data-result-settlement-attempt={projection.attempt}
        aria-busy={settlementStatus === 'running'}
      >
        <TowerResultBody
          isWin={isWin}
          tower={tower}
          status={settlementStatus}
          projection={projection}
          results={lastResults}
          evolutions={lastEvolutions}
          showEvo={showEvo}
          retry={retrySettlement}
          onContinue={() => leaveResult({ type: 'TOWER_CONTINUE' })}
          onQuit={() => leaveResult({ type: 'TOWER_QUIT' })}
          onEvolutionDone={() => setEvoDone(true)}
        />
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
    ? 'battle handoff 尚未送達；結果回條完成後才會開放下一步。'
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
