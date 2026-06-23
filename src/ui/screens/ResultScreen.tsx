import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { buildBattlePokemon } from '@/game/stats'
import { rollBall, getBall, captureChanceWithBall } from '@/game/battle/engine'
import { audio } from '@/audio/audioEngine'
import { useRoster } from '@/store/rosterStore'
import { getSpecies } from '@/game/data/species'
import { canCaptureIn } from '@/game/data/regionLookup'
import { PokemonSprite } from '@/ui/components/PokemonSprite'

// 收服用 3D 舞台（同 BattleStage 走 three），lazy 載入
const CaptureStage = lazy(() => import('@/scene/r3f/CaptureStage'))

/** 戰敗仍給的經驗比例（相對勝利全額）——讓每場都有累積，破解「要先贏才能變強」死結 */
const LOSS_EXP_RATIO = 0.15

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

type Stage = 'throw' | 'wobble' | 'result'

function WinView({ onCaptured }: { onCaptured: (ok: boolean) => void }) {
  const { context } = useGame()
  // 捕獲對象＝對手隊伍末隻（boss）
  const wild = useMemo(() => {
    const boss = context.foeTeam[context.foeTeam.length - 1]
    return boss ? buildBattlePokemon(boss) : null
  }, [context.foeTeam])
  // 捕獲球輪盤：轉出球種 → 套捕獲率係數
  const ball = useRef(getBall(rollBall()))
  const success = useRef<boolean>(
    wild ? Math.random() < captureChanceWithBall(wild, ball.current.mult) : false,
  )
  const [stage, setStage] = useState<Stage>('throw')
  // onCaptured 走 ref：結算時 roster 更新會讓父層 re-render（onCaptured 重建），
  // 計時器 effect 必須只跑一次、且不因依賴變動被 cleanup 清掉，否則會卡在 throw 階段。
  const onCapturedRef = useRef(onCaptured)
  onCapturedRef.current = onCaptured

  useEffect(() => {
    const t1 = setTimeout(() => setStage('wobble'), 650)
    const t2 = setTimeout(() => {
      setStage('result')
      if (success.current) audio.play('capture')
      onCapturedRef.current(success.current)
    }, 2500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  if (!wild) return null
  const caught = success.current

  return (
    <div className="center" style={{ flex: 1, gap: 18 }}>
      <motion.div className="eyebrow"
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        戰鬥勝利！　<span style={{ color: ball.current.color }}>🎯 {ball.current.nameZh}</span>
      </motion.div>

      <div style={{ position: 'relative', width: 'min(64vw,300px)', height: 'min(64vw,300px)' }}>
        {/* 野生寶可夢：3D 舞台（GLB/billboard），收服成功時縮沉「進球」 */}
        <Suspense fallback={null}>
          <CaptureStage
            speciesId={wild.speciesId}
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
              stage === 'throw'
                ? { y: 0, scale: 1, opacity: 1, rotate: 0 }
                : stage === 'wobble'
                  ? { rotate: [0, -18, 16, -12, 8, 0], y: 0, scale: 1, opacity: 1 }
                  : { y: 0, scale: 1, opacity: 1 }
            }
            transition={stage === 'wobble'
              ? { duration: 1.6, times: [0, 0.2, 0.45, 0.65, 0.85, 1] }
              : { type: 'spring', stiffness: 140, damping: 12 }}
          >
            <Pokeball size={72} color={ball.current.color} />
          </motion.div>
        ) : null}

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
              {caught ? `${wild.nameZh} 加入了你的隊伍` : `${wild.nameZh} 掙脫了寶貝球`}
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
    () => (context.playerTeam[0] ? buildBattlePokemon(context.playerTeam[0]) : null),
    [context.playerTeam],
  )
  return (
    <div className="center" style={{ flex: 1, gap: 16 }}>
      <motion.div className="eyebrow" style={{ color: 'var(--bad)' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}>戰鬥失敗</motion.div>
      {player && (
        <motion.div style={{ width: 'min(48vw,200px)', height: 'min(48vw,200px)', filter: 'grayscale(0.7)' }}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 0.7, y: 0 }}>
          <PokemonSprite src={player.artworkUrl} alt={player.nameZh} flip />
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
    () => (context.playerTeam[0] ? buildBattlePokemon(context.playerTeam[0]) : null),
    [context.playerTeam],
  )
  useEffect(() => { audio.play('victory') }, [])
  return (
    <div className="center" style={{ flex: 1, gap: 16 }}>
      <motion.div className="eyebrow" style={{ color: 'var(--good)' }}
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>競技勝利！</motion.div>
      {lead && (
        <motion.div style={{ width: 'min(52vw,220px)', height: 'min(52vw,220px)' }}
          initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 140, damping: 13 }}>
          <PokemonSprite src={lead.artworkUrl} alt={lead.nameZh} />
        </motion.div>
      )}
      <div className="h-title" style={{ fontSize: 28 }}>漂亮的一戰！</div>
      <div className="h-sub">競技場切磋只得經驗、不可捕獲。想收服就去野外區域吧！</div>
    </div>
  )
}

export function ResultScreen() {
  const { context, send } = useGame()
  const isWin = context.outcome === 'win'
  // 捕獲資格集中由 region.mode 決定（M6 模式 contract）：競技場勝利不進捕獲流程。
  const canCapture = isWin && canCaptureIn(context.regionId)
  const [captureDone, setCaptureDone] = useState(!canCapture)

  // 結算：給參戰隊伍加經驗、升級、存檔（只做一次）。勝全額、敗給部分（不白忙）。
  const grantBattleExp = useRoster((s) => s.grantBattleExp)
  const captureUnit = useRoster((s) => s.captureUnit)
  const lastResults = useRoster((s) => s.lastResults)
  const grantedRef = useRef(false)
  useEffect(() => {
    if (!context.outcome || grantedRef.current) return
    grantedRef.current = true
    void grantBattleExp(
      context.playerTeam.map((c) => c.cardId),
      context.foeTeam.map((c) => c.level),
      isWin ? 1 : LOSS_EXP_RATIO,
    )
  }, [isWin, context.outcome, context.playerTeam, context.foeTeam, grantBattleExp])

  // 收服回呼：穩定參照（避免 WinView 計時器 effect 因父層 re-render churn）
  const onCaptured = useCallback((ok: boolean) => {
    if (ok) {
      const boss = context.foeTeam[context.foeTeam.length - 1]
      if (boss) void captureUnit(boss) // 真的把 boss 加入並存檔到隊伍
    }
    send({ type: 'SET_CAPTURED', captured: ok })
    setCaptureDone(true)
  }, [context.foeTeam, captureUnit, send])

  return (
    <div className="col" style={{ flex: 1 }}>
      {canCapture
        ? <WinView onCaptured={onCaptured} />
        : isWin
          ? <ArenaWinView />
          : <LoseView />}

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

      <AnimatePresence>
        {captureDone && (
          <motion.div className="row center" style={{ gap: 12, justifyContent: 'center', paddingTop: 8 }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <button className="btn" onClick={() => send({ type: 'PLAY_AGAIN' })}>
              🔄 再戰一場
            </button>
            <button className="btn btn--ghost" onClick={() => send({ type: 'TO_REGIONS' })}>
              🗺 回到區域
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
