import { useGame } from '@/app/GameProvider'
import { audio } from '@/audio/audioEngine'
import { ToolsMenu } from '@/ui/components/ToolsMenu'
import { detectDeviceLabel } from '@/ui/deviceLabel'

// 裝置每個 session 不變，模組載入時算一次即可
const DEVICE_LABEL = detectDeviceLabel()

export function TitleScreen() {
  const { send } = useGame()

  return (
    <div className="center title-screen" style={{ flex: 1 }}>
      <div className="col title-screen__hero">
        <div className="eyebrow title-screen__eyebrow">Personal Arcade · {DEVICE_LABEL} · v{__APP_VERSION__}</div>
        <div className="h-title title-screen__logo">
          MOB<span style={{ color: 'var(--accent)' }}>IE</span>
          <div className="title-screen__loop">
            鎖定目標 · 親手決策 · 收服夥伴
          </div>
        </div>
      </div>

      <button
        className="btn title-screen__adventure"
        aria-label="開始冒險"
        onClick={() => { void audio.unlock(); send({ type: 'START' }) }}
      >
        ▶ 開始冒險
      </button>

      <ToolsMenu />
    </div>
  )
}
