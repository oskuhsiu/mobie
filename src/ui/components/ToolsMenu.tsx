import { lazy, Suspense, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { audio } from '@/audio/audioEngine'
import { useMeta } from '@/store/metaStore'
import { useIncubator } from '@/store/incubatorStore'
import { claimableCount } from '@/game/achievements'
import { isHatchable } from '@/game/incubator'

// 工具 overlay 較重（jsqr/qrcode/three），lazy 載入避免拖慢開場/區域選擇
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

/**
 * 共用工具列：掃卡 / 卡庫 / 隊伍 / 招式 / 夥伴技能 / 圖鑑 / 成就 / 孵化所 / 3D 模型 / 存檔 / 設定。
 * Title 與 RegionSelect（遊戲中樞）共用——避免「開始遊戲後這些功能就找不到」。
 */
export function ToolsMenu() {
  const [overlay, setOverlay] = useState<Overlay>('none')
  const open = (o: Overlay) => { void audio.unlock(); setOverlay(o) }
  const claimable = useMeta((s) => claimableCount(s.meta))
  const hatchable = useIncubator((s) => s.state.eggs.some(isHatchable))

  return (
    <>
      <motion.div
        className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
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
    </>
  )
}
