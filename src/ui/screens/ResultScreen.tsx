import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { buildBattlePokemon } from '@/game/stats'
import { attemptCapture } from '@/game/battle/engine'
import { PokemonSprite } from '@/ui/components/PokemonSprite'

function Pokeball({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <defs>
        <linearGradient id="pb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5161" />
          <stop offset="1" stopColor="#c81e2c" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="29" fill="#f4f6ff" stroke="#11131a" strokeWidth="3" />
      <path d="M5 30a27 27 0 0 1 54 0z" fill="url(#pb)" stroke="#11131a" strokeWidth="3" />
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
  const success = useRef<boolean>(wild ? attemptCapture(wild) : false)
  const [stage, setStage] = useState<Stage>('throw')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    const t1 = setTimeout(() => setStage('wobble'), 650)
    const t2 = setTimeout(() => {
      setStage('result')
      onCaptured(success.current)
    }, 2500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onCaptured])

  if (!wild) return null
  const caught = success.current

  return (
    <div className="center" style={{ flex: 1, gap: 18 }}>
      <motion.div className="eyebrow"
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        戰鬥勝利！
      </motion.div>

      <div style={{ position: 'relative', width: 'min(60vw,260px)', height: 'min(60vw,260px)' }}>
        <div className="platform" />
        {/* 寶可夢：被收服時於 result 階段淡出 */}
        <AnimatePresence>
          {!(stage === 'result' && caught) && (
            <motion.div
              style={{ position: 'absolute', inset: 0 }}
              animate={stage === 'throw' ? { opacity: 1 } : { opacity: 0.25, scale: 0.9 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ duration: 0.3 }}
            >
              <PokemonSprite src={wild.artworkUrl} alt={wild.nameZh} shiny={wild.shiny} />
            </motion.div>
          )}
        </AnimatePresence>

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
            <Pokeball size={72} />
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
      <div className="h-sub">換一隻屬性相剋的寶可夢再挑戰看看</div>
    </div>
  )
}

export function ResultScreen() {
  const { context, send } = useGame()
  const isWin = context.outcome === 'win'
  const [captureDone, setCaptureDone] = useState(!isWin)

  return (
    <div className="col" style={{ flex: 1 }}>
      {isWin
        ? <WinView onCaptured={(ok) => { send({ type: 'SET_CAPTURED', captured: ok }); setCaptureDone(true) }} />
        : <LoseView />}

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
