// M10 — 進化演出（結算畫面）。剪影→閃光→定格「XX 進化成 YY！」，依序播放本場每隻進化。
// 純展示層（讀已完成的 EvolutionEvent，roster 早已寫入進化後 speciesId）；可點擊跳過。
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { EvolutionEvent } from '@/store/rosterStore'
import { getSpecies } from '@/game/data/species'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { audio } from '@/audio/audioEngine'

type Phase = 'morph' | 'revealed'

export function EvolutionOverlay({ evolutions, onDone }: {
  evolutions: EvolutionEvent[]
  onDone: () => void
}) {
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('morph')
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const ev = evolutions[idx]

  // 每隻：morph（剪影閃爍 ~1.4s）→ revealed（定格 + audio ~1.7s）→ 下一隻 / 結束
  useEffect(() => {
    if (!ev) return
    setPhase('morph')
    audio.play('select')
    const t1 = setTimeout(() => { setPhase('revealed'); audio.play('victory') }, 1400)
    const t2 = setTimeout(() => {
      if (idx + 1 < evolutions.length) setIdx(idx + 1)
      else onDoneRef.current()
    }, 1400 + 1700)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [idx, ev, evolutions.length])

  if (!ev) return null
  const from = getSpecies(ev.fromSpecies)
  const to = getSpecies(ev.toSpecies)
  const revealed = phase === 'revealed'

  const skip = () => {
    if (idx + 1 < evolutions.length) { setIdx(idx + 1); setPhase('morph') }
    else onDoneRef.current()
  }

  return (
    <motion.div
      className="evo-overlay" role="button" tabIndex={0} onClick={skip}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="evo-overlay__stage">
        {/* 進化前剪影（白光淹沒）→ 進化後定格 */}
        <AnimatePresence mode="wait">
          {!revealed ? (
            <motion.div
              key="from" className="evo-overlay__mon evo-overlay__mon--morph"
              initial={{ opacity: 1, scale: 1 }}
              animate={{ filter: ['brightness(1)', 'brightness(6)', 'brightness(1)'], scale: [1, 1.06, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, repeat: 1 }}
            >
              <MobieSprite src={from.artworkUrl} alt={from.nameZh} />
            </motion.div>
          ) : (
            <motion.div
              key="to" className="evo-overlay__mon"
              initial={{ opacity: 0, scale: 0.6, filter: 'brightness(5)' }}
              animate={{ opacity: 1, scale: 1, filter: 'brightness(1)' }}
              transition={{ type: 'spring', stiffness: 150, damping: 13 }}
            >
              <MobieSprite src={to.artworkUrl} alt={to.nameZh} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="evo-overlay__caption">
        {revealed
          ? <span className="evo-overlay__done">{from.nameZh} 進化成了 <b>{to.nameZh}</b>！</span>
          : <span className="evo-overlay__hint">？？？ 正在進化…</span>}
      </div>
      {evolutions.length > 1 && (
        <div className="evo-overlay__page">{idx + 1} / {evolutions.length}　<span className="evo-overlay__skip">點擊跳過</span></div>
      )}
    </motion.div>
  )
}
