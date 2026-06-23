import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { audio } from '@/audio/audioEngine'
import { ModelManagerModal } from '@/ui/components/ModelManagerModal'

export function TitleScreen() {
  const { send } = useGame()
  const [showModels, setShowModels] = useState(false)

  return (
    <div className="center" style={{ flex: 1, gap: 28 }}>
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.05, type: 'spring', stiffness: 120, damping: 14 }}
        className="col"
        style={{ alignItems: 'center', gap: 10 }}
      >
        <div className="eyebrow">Personal Arcade · iPad</div>
        <div
          className="h-title"
          style={{ fontSize: 'clamp(40px, 9vw, 88px)', lineHeight: 1, textAlign: 'center' }}
        >
          MEZA<span style={{ color: 'var(--accent)' }}>STAR</span>
          <div style={{ fontSize: 'clamp(14px,2.4vw,20px)', color: 'var(--text-dim)', fontWeight: 700, marginTop: 8 }}>
            掃卡 · 對戰 · 收服
          </div>
        </div>
      </motion.div>

      <motion.div
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        style={{ fontSize: 88, filter: 'drop-shadow(0 10px 24px rgba(255,81,97,0.5))' }}
      >
        ⚡
      </motion.div>

      <motion.button
        className="btn"
        style={{ fontSize: 20, padding: '18px 48px' }}
        whileTap={{ scale: 0.96 }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        onClick={() => { void audio.unlock(); send({ type: 'START' }) }}
      >
        ▶ 開始遊戲
      </motion.button>

      <motion.button
        className="btn btn--ghost btn--sm"
        whileTap={{ scale: 0.96 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        onClick={() => { void audio.unlock(); setShowModels(true) }}
      >
        🧩 3D 模型
      </motion.button>

      <AnimatePresence>
        {showModels && <ModelManagerModal onClose={() => setShowModels(false)} />}
      </AnimatePresence>
    </div>
  )
}
