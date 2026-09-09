import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { buildBattleMobie } from '@/game/stats'
import { getBall } from '@/game/battle/engine'
import { audio } from '@/audio/audioEngine'
import { haptic } from '@/input/haptics'
import { INTENSITY_BY_MODE, type InteractMode } from '@/game/settings'
import { SwipeThrow, CircleSeal } from '@/ui/components/CaptureGestures'
import { isBossFloor, getAscension } from '@/game/tower'
import { getSpecies } from '@/game/data/species'
import { captureTargetOf } from '@/game/hunt'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { MobCard } from '@/ui/components/MobCard'
import { EvolutionOverlay } from '@/ui/components/EvolutionOverlay'
import type { CaptureDecision } from '@/game/resultSettlement'
import type { GameEvent } from '@/game/machine/gameMachine'
import { useOverlayController } from '@/ui/shell/OverlayController'
import { useResultSettlementProjection } from '@/store/resultSettlementProjection'

// 收服用 3D 舞台（同 BattleStage 走 three），lazy 載入
const CaptureStage = lazy(() => import('@/scene/r3f/CaptureStage'))
const TeamModal = lazy(() => import('@/ui/components/TeamModal').then((m) => ({ default: m.TeamModal })))

function Pokeball({ size = 64, color = '#ff5161' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
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
  duplicateConverted,
  interactionMode,
}: {
  onCaptured: (ok: boolean) => void
  decision: CaptureDecision
  duplicateConverted: boolean
  interactionMode: InteractMode
}) {
  const { context } = useGame()
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
  // M22 捕獲增強互動 mode（off＝現狀一字不差）。掛載時讀一次，戰中不變。
  const capMode = interactionMode
  const enhanced = capMode !== 'off'

  const [stage, setStage] = useState<Stage>(enhanced ? 'aim' : 'throw')
  const [sealRound, setSealRound] = useState(0) // 「再搏一下」純演出寬限：最多重畫一次
  const finishedRef = useRef(false)
  // onCaptured 走 ref：結算時 roster 更新會讓父層 re-render（onCaptured 重建），
  // 計時器 effect 必須只跑一次、且不因依賴變動被 cleanup 清掉，否則會卡在 throw 階段。
  const onCapturedRef = useRef(onCaptured)
  onCapturedRef.current = onCaptured

  // 揭曉（只跑一次）：caught 預先決定，這裡只演出收尾 + 通知父層。
  const reveal = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    setStage('result')
    if (successRef.current) { audio.play('capture'); haptic('capture') } // EXT.1.a：捕獲揭曉節慶式連震
    onCapturedRef.current(successRef.current)
  }, [])

  // off：維持原自動流程（throw→wobble@650→result@2500），DOM 不出現任何手勢 wrapper（零回歸）。
  useEffect(() => {
    if (enhanced) return
    const t1 = setTimeout(() => setStage('wobble'), 650)
    const t2 = setTimeout(() => reveal(), 2500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [enhanced, reveal])

  // 增強：丟球後自動推進（lite 直接 wobble→reveal；arcade 進 seal 由畫圈推進）。
  useEffect(() => {
    if (!enhanced) return
    if (stage === 'throw') {
      const t = setTimeout(() => setStage(capMode === 'arcade' ? 'seal' : 'wobble'), 600)
      return () => clearTimeout(t)
    }
    if (stage === 'wobble') {
      const t = setTimeout(() => reveal(), 1500)
      return () => clearTimeout(t)
    }
  }, [enhanced, stage, capMode, reveal])

  // 畫圈封印完成：注定逃脫時給一次「再搏一下」（純演出、不改 caught），否則揭曉。
  const onSealed = useCallback(() => {
    if (!successRef.current && sealRound === 0) { setSealRound(1); return }
    reveal()
  }, [sealRound, reveal])

  if (!wild) return null
  const caught = successRef.current
  const wobbling = stage === 'wobble' || stage === 'seal'

  return (
    <div className="center" style={{ flex: 1, gap: 18 }}>
      <motion.div className="eyebrow"
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        戰鬥勝利！　<span style={{ color: ball.color }}>🎯 {ball.nameZh}</span>
      </motion.div>

      <div style={{ position: 'relative', width: 'min(64vw,300px)', height: 'min(64vw,300px)' }}>
        {/* 野生 Mobie artwork billboard 舞台，收服成功時縮沉「進球」。 */}
        <Suspense fallback={null}>
          <CaptureStage
            artworkUrl={wild.artworkUrl}
            shiny={wild.shiny}
            vanish={stage === 'result' && caught}
          />
        </Suspense>

        {/* 寶貝球 */}
        {stage !== 'result' || caught ? (
          <motion.div
            style={{ position: 'absolute', left: '50%', top: '38%', x: '-50%' }}
            initial={{ y: 160, scale: 0.4, opacity: 0, rotate: -40 }}
            animate={
              stage === 'aim'
                ? { y: 128, scale: 0.82, opacity: 1, rotate: 0 }
                : stage === 'throw'
                  ? { y: 0, scale: 1, opacity: 1, rotate: 0 }
                  : wobbling
                    ? { rotate: [0, -18, 16, -12, 8, 0], y: 0, scale: 1, opacity: 1 }
                    : { y: 0, scale: 1, opacity: 1 }
            }
            transition={wobbling
              ? { duration: 1.6, times: [0, 0.2, 0.45, 0.65, 0.85, 1], repeat: stage === 'seal' ? Infinity : 0 }
              : { type: 'spring', stiffness: 140, damping: 12 }}
          >
            <Pokeball size={72} color={ball.color} />
          </motion.div>
        ) : null}

        {/* M22 增強互動手勢 overlay（off 不渲染＝DOM 零新增 wrapper） */}
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

        {/* 收服成功星光 */}
        <AnimatePresence>
          {stage === 'result' && caught && (
            <motion.div
              style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 40 }}
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            >
              ✦✦✦
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {stage === 'result' && (
          <motion.div key={caught ? 'ok' : 'no'} className="col center" style={{ gap: 6 }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="h-title" style={{ fontSize: 30, color: caught ? 'var(--good)' : 'var(--text)' }}>
              {caught ? '收服成功！' : '可惜，逃脫了！'}
            </div>
            <div className="h-sub">
              {caught
                ? duplicateConverted
                  ? `${wild.nameZh} 已轉化為孵化蛋`
                  : `${wild.nameZh} 加入了你的隊伍`
                : `${wild.nameZh} 掙脫了寶貝球`}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function LoseView() {
  const { context } = useGame()
  const player = useMemo(
    () => (context.playerTeam[0] ? buildBattleMobie(context.playerTeam[0]) : null),
    [context.playerTeam],
  )
  return (
    <div className="center" style={{ flex: 1, gap: 16 }}>
      <motion.div className="eyebrow" style={{ color: 'var(--bad)' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}>戰鬥失敗</motion.div>
      {player && (
        <motion.div style={{ width: 'min(48vw,200px)', height: 'min(48vw,200px)', filter: 'grayscale(0.7)' }}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 0.7, y: 0 }}>
          <MobieSprite src={player.artworkUrl} alt={player.nameZh} flip />
        </motion.div>
      )}
      <div className="h-title" style={{ fontSize: 30 }}>你被擊敗了…</div>
      <div className="h-sub">雖敗猶榮，仍獲得了一些經驗。換隻屬性相剋的，或先去競技場練等再來！</div>
    </div>
  )
}

/** 競技場（mode='arena'）勝利：不可捕獲，純得經驗的勝利畫面。 */
function ArenaWinView() {
  const { context } = useGame()
  const lead = useMemo(
    () => (context.playerTeam[0] ? buildBattleMobie(context.playerTeam[0]) : null),
    [context.playerTeam],
  )
  return (
    <div className="center" style={{ flex: 1, gap: 16 }}>
      <motion.div className="eyebrow" style={{ color: 'var(--good)' }}
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>競技勝利！</motion.div>
      {lead && (
        <motion.div style={{ width: 'min(52vw,220px)', height: 'min(52vw,220px)' }}
          initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 140, damping: 13 }}>
          <MobieSprite src={lead.artworkUrl} alt={lead.nameZh} />
        </motion.div>
      )}
      <div className="h-title" style={{ fontSize: 28 }}>漂亮的一戰！</div>
      <div className="h-sub">競技場切磋只得經驗、不可捕獲。想收服就去野外區域吧！</div>
    </div>
  )
}

/** M11 連勝塔結算畫面：突破/敗北 + 樓層 + 難度階；無捕獲。 */
function TowerView({ isWin }: { isWin: boolean }) {
  const { context } = useGame()
  const t = context.tower!
  const lead = useMemo(() => (context.playerTeam[0] ? buildBattleMobie(context.playerTeam[0]) : null), [context.playerTeam])
  const asc = getAscension(t.ascension)
  return (
    <div className="center" style={{ flex: 1, gap: 14 }}>
      <motion.div className="eyebrow" style={{ color: isWin ? 'var(--good)' : 'var(--bad)' }}
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>🗼 連勝塔 · {asc.name}</motion.div>
      {lead && (
        <motion.div style={{ width: 'min(48vw,200px)', height: 'min(48vw,200px)' }}
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 140, damping: 13 }}>
          <MobieSprite src={lead.artworkUrl} alt={lead.nameZh} />
        </motion.div>
      )}
      {isWin ? (
        <>
          <div className="h-title" style={{ fontSize: 28 }}>第 {t.floor} 層突破！{isBossFloor(t.floor) ? ' 🏆 BOSS' : ''}</div>
          <div className="h-sub">繼續攻向第 {t.floor + 1} 層，或見好就收結算。</div>
        </>
      ) : (
        <>
          <div className="h-title" style={{ fontSize: 28 }}>遠征結束 · 到達第 {t.floor} 層</div>
          <div className="h-sub">已結算本場經驗與 SP。下次挑戰更高樓層！</div>
        </>
      )}
    </div>
  )
}

export function ResultScreen() {
  const { context, send } = useGame()
  const controller = useOverlayController()
  const settlement = useResultSettlementProjection(context)
  const {
    isWin,
    tower,
    canCapture,
    status: settlementStatus,
    projection,
    identity: settlementIdentity,
    captureDecision,
    captureReceipt,
    capturedUnit,
    capturedMobie: capturedMon,
    duplicateConverted: dupConverted,
    results: lastResults,
    evolutions: lastEvolutions,
    captureMode,
    retry: retrySettlement,
    markLeft,
  } = settlement
  const [captureDone, setCaptureDone] = useState(!canCapture)

  // The gesture state is presentation-only.  A new logical Result resets its
  // reveal gate while the durable projection remains owned by the coordinator.
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

  // 收服回呼只 completes the presentation.  Canonical capture state has
  // already been committed (or durably marked) by the projection owner.
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

  const openCapturedCard = () => {
    if (!capturedMon) return
    controller.push({
      id: `mobie-detail:${capturedMon.speciesId}`,
      policy: 'escape-and-backdrop',
      content: <MobCard mon={capturedMon} owner ownerExp={capturedUnit?.exp} revealed onClose={controller.pop} />,
    })
  }

  return (
    <div
      className="col"
      style={{ flex: 1 }}
      data-result-settlement-status={settlementStatus}
      data-result-settlement-attempt={projection.attempt}
      aria-busy={settlementStatus === 'running'}
    >
      {tower
        ? <TowerView isWin={isWin} />
        : canCapture
          ? captureDecision
            ? <WinView
                onCaptured={onCaptured}
                decision={captureDecision}
                duplicateConverted={dupConverted}
                interactionMode={captureMode}
              />
            : <div className="center" style={{ flex: 1 }} role="status" aria-live="polite">正在準備收服結算…</div>
          : isWin
            ? <ArenaWinView />
            : <LoseView />}

      {dupConverted && (
        <motion.div className="dup-note" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          🥚 已擁有此Mobie → 自動轉化為孵化蛋（前往 🥚 孵化所查看）
        </motion.div>
      )}

      {captureDone && capturedMon && (
        <motion.div
          className="capture-companion-actions"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="capture-companion-actions__copy">
            <span className="eyebrow">NEW COMPANION</span>
            <b>{capturedMon.nameZh} · Lv.{capturedMon.level} 已加入收藏</b>
          </div>
          <div className="row capture-companion-actions__buttons">
            <button
              className="btn btn--sm"
              aria-label="查看新夥伴"
              onClick={openCapturedCard}
            >
              🔎 查看新夥伴
            </button>
            <button
              className="btn btn--ghost btn--sm"
              aria-label="我的 Mobie"
              onClick={() => controller.open({
                id: 'team',
                policy: 'escape-and-backdrop',
                content: <TeamModal onClose={controller.close} />,
              })}
            >
              ✦ 我的 Mobie
            </button>
          </div>
        </motion.div>
      )}

      {lastResults.length > 0 && (
        <motion.div className="exp-summary" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          {!isWin && <div className="exp-summary__head">獲得經驗</div>}
          {lastResults.map((r) => (
            <div key={r.unit.id} className="exp-row">
              <span className="exp-row__name">{getSpecies(r.unit.speciesId).nameZh}</span>
              <span className="exp-row__exp">+{r.gained} EXP</span>
              {r.leveledUp && <span className="exp-row__up">Lv.{r.fromLevel}→{r.toLevel}！</span>}
            </div>
          ))}
        </motion.div>
      )}

      {settlementStatus === 'running' && (
        <div className="settlement-status" role="status" aria-live="polite" data-settlement-announcement>
          結算進行中，獎勵完成後才能繼續。<span data-result-cta-state="disabled">下一步操作暫時停用。</span>
        </div>
      )}

      {settlementStatus === 'error' && (
        <div className="settlement-error" role="alert">
          <span>{projection.error?.message ?? 'Result 結算失敗，請重試。'}</span>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn--sm"
              disabled={projection.error?.code === 'collision'}
              title={projection.error?.code === 'collision' ? '此結果識別碼已衝突，請返回並重新開始。' : undefined}
              onClick={retrySettlement}
            >
              重試結算
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => leaveResult({ type: 'TO_REGIONS' })}>
              回到區域
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {settlementStatus === 'settled' && captureDone && !showEvo && (
          <motion.div className="row center" style={{ gap: 12, justifyContent: 'center', paddingTop: 8 }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            {tower ? (
              <>
                {isWin && (
                  <button
                    className="btn"
                    onClick={() => leaveResult({ type: 'TOWER_CONTINUE' })}
                  >
                    ⬆ 攻向第 {tower.floor + 1} 層
                  </button>
                )}
                <button
                  className="btn btn--ghost"
                  onClick={() => leaveResult({ type: 'TOWER_QUIT' })}
                >
                  🏳 結束遠征
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn"
                  onClick={() => leaveResult({ type: 'PLAY_AGAIN' })}
                >
                  🔄 再戰一場
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={() => leaveResult({ type: 'TO_REGIONS' })}
                >
                  🗺 回到區域
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* M10 進化演出（捕獲流程結束後播放，full-screen overlay） */}
      <AnimatePresence>
        {showEvo && (
          <EvolutionOverlay evolutions={lastEvolutions} onDone={() => setEvoDone(true)} />
        )}
      </AnimatePresence>

    </div>
  )
}
