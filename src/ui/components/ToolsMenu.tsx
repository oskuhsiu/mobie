import { lazy, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBootstrap } from '@/app/bootstrapCoordinator'
import { audio } from '@/audio/audioEngine'
import { useMeta } from '@/store/metaStore'
import { useIncubator } from '@/store/incubatorStore'
import { useSettings } from '@/store/settingsStore'
import { claimableCount } from '@/game/achievements'
import { isHatchable } from '@/game/incubator'
import { bootstrapActionReason } from '@/ui/shell/AppShell'
import { useOverlayController, type OverlayDismissPolicy } from '@/ui/shell/OverlayController'

// 工具 overlay 較重（qrcode/camera），lazy 載入避免拖慢開場/區域選擇
const CardLibraryModal = lazy(() => import('@/ui/components/CardLibraryModal').then((m) => ({ default: m.CardLibraryModal })))
const SaveManagerModal = lazy(() => import('@/ui/components/SaveManagerModal').then((m) => ({ default: m.SaveManagerModal })))
const SettingsModal = lazy(() => import('@/ui/components/SettingsModal').then((m) => ({ default: m.SettingsModal })))
const TeamModal = lazy(() => import('@/ui/components/TeamModal').then((m) => ({ default: m.TeamModal })))
const MoveTrainerModal = lazy(() => import('@/ui/components/MoveTrainerModal').then((m) => ({ default: m.MoveTrainerModal })))
const PartnerSkillModal = lazy(() => import('@/ui/components/PartnerSkillModal').then((m) => ({ default: m.PartnerSkillModal })))
const DexModal = lazy(() => import('@/ui/components/DexModal').then((m) => ({ default: m.DexModal })))
const AchievementsModal = lazy(() => import('@/ui/components/AchievementsModal').then((m) => ({ default: m.AchievementsModal })))
const IncubatorModal = lazy(() => import('@/ui/components/IncubatorModal').then((m) => ({ default: m.IncubatorModal })))
const ReplayListModal = lazy(() => import('@/ui/components/ReplayListModal').then((m) => ({ default: m.ReplayListModal })))
const CardScannerModal = lazy(() => import('@/ui/components/CardScannerModal').then((m) => ({ default: m.CardScannerModal })))

type Overlay = 'library' | 'scanner' | 'save' | 'settings' | 'team' | 'moves' | 'partner' | 'dex' | 'achievements' | 'incubator' | 'replays'
const DATA_OVERLAYS: Overlay[] = ['library', 'scanner', 'save', 'team', 'moves', 'partner', 'dex', 'achievements', 'incubator']
const DEFAULT_POLICY: OverlayDismissPolicy = 'escape-and-backdrop'

/**
 * 共用工具列：第一層只放「我的 Mobie」與「更多」，所有 modal 由 AppShell 的
 * OverlayController 管理，避免 Title、Region、Result 各自留下 overlay。
 */
export function ToolsMenu() {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const controller = useOverlayController()
  const { snapshot } = useBootstrap()
  const dataReady = snapshot.status === 'ready'
  const dataReason = bootstrapActionReason(snapshot.status)
  const claimable = useMeta((s) => dataReady ? claimableCount(s.meta) : 0)
  const hatchable = useIncubator((s) => dataReady && s.state.eggs.some(isHatchable))
  const scannerEnabled = useSettings((s) => s.settings.prefs.scannerEnabled)

  const focusFirstLegal = () => {
    const first = moreMenuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
    first?.focus()
  }

  useEffect(() => {
    if (!moreOpen) return
    const frame = requestAnimationFrame(focusFirstLegal)
    const timer = window.setTimeout(focusFirstLegal, 360)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMoreOpen(false)
      requestAnimationFrame(() => moreButtonRef.current?.focus())
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [moreOpen])

  const dataGate = (label: string) => ({
    disabled: !dataReady,
    'aria-describedby': dataReason ? 'bootstrap-action-reason' : undefined,
    'data-bootstrap-gated': !dataReady ? 'true' : undefined,
    title: dataReason ? `${label}：${dataReason}` : undefined,
  })

  const open = (id: Overlay, content: ReactNode, policy: OverlayDismissPolicy = DEFAULT_POLICY) => {
    if (!dataReady && DATA_OVERLAYS.includes(id)) return
    void audio.unlock()
    const invoker = moreOpen ? moreButtonRef.current : undefined
    setMoreOpen(false)
    controller.open({ id, policy, content }, { invoker })
  }
  const openLibraryFromScanner = () => {
    controller.open({
      id: 'library',
      policy: DEFAULT_POLICY,
      content: <CardLibraryModal onClose={controller.close} />,
    }, { invoker: moreButtonRef.current })
  }
  const toggleMore = () => { void audio.unlock(); setMoreOpen((openNow) => !openNow) }

  return (
    <div className="tools-menu" data-tools-menu data-tools-menu-state={moreOpen ? 'open' : 'closed'}>
      <div className="row tools-menu-primary">
        <button
          {...dataGate('我的 Mobie')}
          aria-label="我的 Mobie"
          data-tool="team"
          className="btn btn--ghost tools-menu-primary__mobies"
          onClick={() => open('team', <TeamModal onClose={controller.close} />)}
        >✨ 我的 Mobie</button>
        <button
          ref={moreButtonRef}
          aria-label="更多"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-controls="tools-menu-more"
          className="btn btn--ghost tools-menu-primary__more"
          onClick={toggleMore}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            toggleMore()
          }}
        >
          更多 {moreOpen ? '▴' : '▾'}
        </button>
      </div>

      <AnimatePresence>
        {moreOpen && (
          <motion.div
            ref={moreMenuRef}
            id="tools-menu-more"
            className="tools-menu-more"
            role="menu"
            aria-label="更多工具"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onAnimationComplete={focusFirstLegal}
          >
            <section className="tools-menu-more__group" aria-labelledby="tools-menu-growth-heading">
              <h2 id="tools-menu-growth-heading">成長與收藏</h2>
              <div className="tools-menu-more__items">
                <button {...dataGate('卡庫')} data-tool="library" className="btn btn--ghost btn--sm" onClick={() => open('library', <CardLibraryModal onClose={controller.close} />)}>🗂 卡庫</button>
                <button {...dataGate('招式訓練所')} data-tool="moves" className="btn btn--ghost btn--sm" onClick={() => open('moves', <MoveTrainerModal onClose={controller.close} />)}>📖 招式</button>
                <button {...dataGate('夥伴技能')} data-tool="partner" className="btn btn--ghost btn--sm" onClick={() => open('partner', <PartnerSkillModal onClose={controller.close} />)}>✨ 夥伴技能</button>
                <button {...dataGate('圖鑑')} data-tool="dex" className="btn btn--ghost btn--sm" onClick={() => open('dex', <DexModal onClose={controller.close} />)}>📚 圖鑑</button>
                <button {...dataGate('成就')} data-tool="achievements" className="btn btn--ghost btn--sm" onClick={() => open('achievements', <AchievementsModal onClose={controller.close} />)}>
                  🏆 成就{claimable > 0 && <span className="title-dot">{claimable}</span>}
                </button>
                <button {...dataGate('孵化所')} data-tool="incubator" className="btn btn--ghost btn--sm" onClick={() => open('incubator', <IncubatorModal onClose={controller.close} />)}>
                  🥚 孵化所{hatchable && <span className="title-dot">!</span>}
                </button>
              </div>
            </section>
            <section className="tools-menu-more__group" aria-labelledby="tools-menu-data-heading">
              <h2 id="tools-menu-data-heading">資料與設定</h2>
              <div className="tools-menu-more__items">
                <button data-tool="replays" className="btn btn--ghost btn--sm" onClick={() => open('replays', <ReplayListModal onClose={controller.close} />)}>🎬 回放</button>
                {scannerEnabled && <button {...dataGate('掃卡')} className="btn btn--ghost btn--sm" data-tool="scanner" onClick={() => open('scanner', <CardScannerModal onClose={controller.close} onBackToLibrary={openLibraryFromScanner} />)}>📷 掃卡</button>}
                <button {...dataGate('存檔')} data-tool="save" className="btn btn--ghost btn--sm" onClick={() => open('save', <SaveManagerModal onClose={controller.close} />)}>☁️ 存檔</button>
                <button data-tool="settings" className="btn btn--ghost btn--sm" onClick={() => open('settings', <SettingsModal onClose={controller.close} />)}>⚙️ 設定</button>
              </div>
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
