// M10 — 進化演出（結算畫面）。剪影→閃光→定格「XX 進化成 YY！」，依序播放本場每隻進化。
// 純展示層（讀已完成的 EvolutionEvent，roster 早已寫入進化後 speciesId）；可點擊跳過。
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
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
  const reducedMotion = useReducedMotion() ?? false
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const overlayRef = useRef<HTMLDivElement>(null)

  const ev = evolutions[idx]

  // 每隻：morph（剪影閃爍）→ revealed（定格 + audio）→ 下一隻 / 結束。
  // Result 必須保留可讀回條又快速回到合法 CTA，避免多隻進化把下一步鎖太久。
  useEffect(() => {
    if (!ev) return
    overlayRef.current?.focus({ preventScroll: true })
    setPhase('morph')
    audio.play('select')
    const morphMs = reducedMotion ? 0 : 700
    const revealMs = reducedMotion ? 260 : 900
    const t1 = setTimeout(() => { setPhase('revealed'); audio.play('victory') }, morphMs)
    const t2 = setTimeout(() => {
      if (idx + 1 < evolutions.length) setIdx(idx + 1)
      else onDoneRef.current()
    }, morphMs + revealMs)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [idx, ev, evolutions.length, reducedMotion])

  if (!ev) return null
  const from = getSpecies(ev.fromSpecies)
  const to = getSpecies(ev.toSpecies)
  const revealed = phase === 'revealed'

  const skip = () => {
    if (idx + 1 < evolutions.length) { setIdx(idx + 1); setPhase('morph') }
    else onDoneRef.current()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      overlayRef.current?.focus()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      skip()
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    skip()
  }

  return (
    <motion.div
      ref={overlayRef}
      className="evo-overlay" role="dialog" aria-modal="true" tabIndex={0} aria-label="進化演出，按 Enter 或空白鍵跳過" onClick={skip} onKeyDown={onKeyDown}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={reducedMotion ? { duration: 0 } : undefined}
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
              transition={reducedMotion ? { duration: 0 } : { duration: 0.7, repeat: 1 }}
            >
              <MobieSprite src={from.artworkUrl} alt={from.nameZh} />
            </motion.div>
          ) : (
            <motion.div
              key="to" className="evo-overlay__mon"
              initial={{ opacity: 0, scale: 0.6, filter: 'brightness(5)' }}
              animate={{ opacity: 1, scale: 1, filter: 'brightness(1)' }}
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 150, damping: 13 }}
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
