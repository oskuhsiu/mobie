import { useGame } from '@/app/GameProvider'
import { useBootstrap } from '@/app/bootstrapCoordinator'
import { audio } from '@/audio/audioEngine'
import { ToolsMenu } from '@/ui/components/ToolsMenu'
import { detectDeviceLabel } from '@/ui/deviceLabel'
import { BootstrapStatus, TaskHeader, UtilityDock, bootstrapActionReason } from '@/ui/shell/AppShell'

// 裝置每個 session 不變，模組載入時算一次即可
const DEVICE_LABEL = detectDeviceLabel()

export function TitleScreen() {
  const { send } = useGame()
  const { snapshot } = useBootstrap()
  const ready = snapshot.status === 'ready'
  const actionReason = bootstrapActionReason(snapshot.status)

  return (
    <div className="center title-screen" style={{ flex: 1 }}>
      <TaskHeader
        className="title-screen__hero"
        eyebrow={
          <>
            <span>Personal Arcade</span>
            <span aria-label={`裝置 ${DEVICE_LABEL}`} data-device-label> · {DEVICE_LABEL}</span>
            <span data-app-version> · v{__APP_VERSION__}</span>
          </>
        }
        title={<>MOB<span style={{ color: 'var(--accent)' }}>IE</span></>}
        tagline="鎖定目標 · 親手決策 · 收服夥伴"
      />

      <BootstrapStatus />

      <button
        className="btn title-screen__adventure"
        aria-label="開始冒險"
        aria-describedby={actionReason ? 'bootstrap-action-reason' : undefined}
        title={actionReason ?? undefined}
        disabled={!ready}
        data-bootstrap-action="start-adventure"
        data-bootstrap-gated={!ready ? 'true' : undefined}
        onClick={() => { if (ready) { void audio.unlock(); send({ type: 'START' }) } }}
      >
        ▶ 開始冒險
      </button>

      {actionReason && <span id="bootstrap-action-reason" className="bootstrap-action-reason">{actionReason}</span>}

      <UtilityDock>
        <ToolsMenu />
      </UtilityDock>
    </div>
  )
}
