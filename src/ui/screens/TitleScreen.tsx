import { lazy, Suspense, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { audio } from '@/audio/audioEngine'
import { useMeta } from '@/store/metaStore'
import { useIncubator } from '@/store/incubatorStore'
import { claimableCount } from '@/game/achievements'
import { isHatchable } from '@/game/incubator'
import { detectDeviceLabel } from '@/ui/deviceLabel'

// 裝置每個 session 不變，模組載入時算一次即可
const DEVICE_LABEL = detectDeviceLabel()

// Title 工具 overlay 較重（jsqr/qrcode/three），lazy 載入避免拖慢開場
const ModelManagerModal = lazy(() => import('@/ui/components/ModelManagerModal').then((m) => ({ default: m.ModelManagerModal })))
const CardScannerModal = lazy(() => import('@/ui/components/CardScannerModal').then((m) => ({ default: m.CardScannerModal })))
const CardLibraryModal = lazy(() => import('@/ui/components/CardLibraryModal').then((m) => ({ default: m.CardLibraryModal })))
const SaveManagerModal = lazy(() => import('@/ui/components/SaveManagerModal').then((m) => ({ default: m.SaveManagerModal })))
const SettingsModal = lazy(() => import('@/ui/components/SettingsModal').then((m) => ({ default: m.SettingsModal })))
const TeamModal = lazy(() => import('@/ui/components/TeamModal').then((m) => ({ default: m.TeamModal })))
const MoveTrainerModal = lazy(() => import('@/ui/components/MoveTrainerModal').then((m) => ({ default: m.MoveTrainerModal })))
const PartnerSkillModal = lazy(() => import('@/ui/components/PartnerSkillModal').then((m) => ({ default: m.PartnerSkillModal })))
const DexModal = lazy(() => import('@/ui/components/DexModal').then((m) => ({ default: m.DexModal })))
const AchievementsModal = lazy(() => import('@/ui/components/AchievementsModal').then((m) => ({ default: m.AchievementsModal })))
const IncubatorModal = lazy(() => import('@/ui/components/IncubatorModal').then((m) => ({ default: m.IncubatorModal })))

type Overlay = 'none' | 'models' | 'scan' | 'library' | 'save' | 'settings' | 'team' | 'moves' | 'partner' | 'dex' | 'achievements' | 'incubator'

export function TitleScreen() {
  const { send } = useGame()
  const [overlay, setOverlay] = useState<Overlay>('none')
  const open = (o: Overlay) => { void audio.unlock(); setOverlay(o) }
  const claimable = useMeta((s) => claimableCount(s.meta))
  const hatchable = useIncubator((s) => s.state.eggs.some(isHatchable))

  return (
    <div className="center" style={{ flex: 1, gap: 28 }}>
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.05, type: 'spring', stiffness: 120, damping: 14 }}
        className="col"
        style={{ alignItems: 'center', gap: 10 }}
      >
        <div className="eyebrow">Personal Arcade · {DEVICE_LABEL}</div>
        <div
          className="h-title"
          style={{ fontSize: 'clamp(40px, 9vw, 88px)', lineHeight: 1, textAlign: 'center' }}
        >
          MOB<span style={{ color: 'var(--accent)' }}>IE</span>
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

      <motion.div
        className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
      >
        <button className="btn btn--ghost btn--sm" onClick={() => open('scan')}>📷 掃卡</button>
        <button className="btn btn--ghost btn--sm" onClick={() => open('library')}>🗂 卡庫</button>
        <button className="btn btn--ghost btn--sm" onClick={() => open('team')}>🎒 隊伍</button>
        <button className="btn btn--ghost btn--sm" onClick={() => open('moves')}>📖 招式</button>
        <button className="btn btn--ghost btn--sm" onClick={() => open('partner')}>✨ 夥伴技能</button>
        <button className="btn btn--ghost btn--sm" onClick={() => open('dex')}>📚 圖鑑</button>
        <button className="btn btn--ghost btn--sm" onClick={() => open('achievements')}>
          🏆 成就{claimable > 0 && <span className="title-dot">{claimable}</span>}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => open('incubator')}>
          🥚 孵化所{hatchable && <span className="title-dot">!</span>}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => open('models')}>🧩 3D 模型</button>
        <button className="btn btn--ghost btn--sm" onClick={() => open('save')}>☁️ 存檔</button>
        <button className="btn btn--ghost btn--sm" onClick={() => open('settings')}>⚙️ 設定</button>
      </motion.div>

      <Suspense fallback={null}>
        <AnimatePresence>
          {overlay === 'models' && <ModelManagerModal onClose={() => setOverlay('none')} />}
          {overlay === 'scan' && <CardScannerModal onClose={() => setOverlay('none')} />}
          {overlay === 'library' && <CardLibraryModal onClose={() => setOverlay('none')} />}
          {overlay === 'save' && <SaveManagerModal onClose={() => setOverlay('none')} />}
          {overlay === 'settings' && <SettingsModal onClose={() => setOverlay('none')} />}
          {overlay === 'team' && <TeamModal onClose={() => setOverlay('none')} />}
          {overlay === 'moves' && <MoveTrainerModal onClose={() => setOverlay('none')} />}
          {overlay === 'partner' && <PartnerSkillModal onClose={() => setOverlay('none')} />}
          {overlay === 'dex' && <DexModal onClose={() => setOverlay('none')} />}
          {overlay === 'achievements' && <AchievementsModal onClose={() => setOverlay('none')} />}
          {overlay === 'incubator' && <IncubatorModal onClose={() => setOverlay('none')} />}
        </AnimatePresence>
      </Suspense>
    </div>
  )
}
