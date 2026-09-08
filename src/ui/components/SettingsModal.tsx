import { motion } from 'framer-motion'
import { useSettings } from '@/store/settingsStore'
import type { GraphicsPreference, InteractMode, JuiceLevel } from '@/game/settings'
import { audio } from '@/audio/audioEngine'

/** M22 增強互動性三態（plan/22 §1.2, §5.4）：mode 派生強度，不做使用者滑桿。 */
const INTERACT_OPTIONS: { id: InteractMode; label: string; hint: string }[] = [
  { id: 'off', label: '關', hint: '預設；點一下就好' },
  { id: 'lite', label: '輕度', hint: '滑動丟球、長按蓄力' },
  { id: 'arcade', label: '機台', hint: '畫圈封印、節奏點擊' },
]

/** EXT.1 打擊感強度三態（plan/EXT.1 §3）：升級爽感／減量／回到 M22 純閃光。 */
const JUICE_OPTIONS: { id: JuiceLevel; label: string; hint: string }[] = [
  { id: 'full', label: '完整', hint: '預設；傷害數字＋頓格＋動態' },
  { id: 'reduced', label: '減量', hint: '只留浮傷數字、不頓格' },
  { id: 'off', label: '關', hint: '回到最單純的閃光' },
]

const GRAPHICS_OPTIONS: { id: GraphicsPreference; label: string; hint: string }[] = [
  { id: 'auto', label: '自動', hint: '依 M23 renderer 預設使用平衡' },
  { id: 'balanced', label: '平衡', hint: '穩定畫質與效能' },
  { id: 'high', label: '高畫質', hint: '較高細節，DPR 上限 1.5' },
  { id: 'compatibility', label: '相容模式', hint: '使用輕量 DOM 戰鬥場景' },
]

/** 玩家可調整的操作與回饋偏好。 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings((s) => s.settings)
  const setInteractMode = useSettings((s) => s.setInteractMode)
  const setReplayRecording = useSettings((s) => s.setReplayRecording)
  const setAttackInputVariant = useSettings((s) => s.setAttackInputVariant)
  const setJuice = useSettings((s) => s.setJuice)
  const setHaptics = useSettings((s) => s.setHaptics)
  const setGraphicsPreference = useSettings((s) => s.setGraphicsPreference)
  const setScannerEnabled = useSettings((s) => s.setScannerEnabled)
  const interactMode = settings.prefs.enhancedInteractivity.mode
  const recordReplays = settings.prefs.recordReplays
  const attackVariant = settings.prefs.attackInputVariant
  const juice = settings.prefs.juice
  const haptics = settings.prefs.haptics
  const graphicsPreference = settings.prefs.graphicsPreference
  const scannerEnabled = settings.prefs.scannerEnabled

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-card__head">
          <div>
            <div className="h-title" style={{ fontSize: 24 }}>⚙️ 設定</div>
            <div className="h-sub">調整操作與回饋偏好；變更會立即保存，畫面品質從下一場戰鬥生效。</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* M22 增強互動性（UX 偏好，非戰鬥模組）：三態 selector + 兒童向說明 */}
          <div className="interact-pref">
            <div className="interact-pref__head">
              <span className="mod-row__icon">🕹</span>
              <div className="mod-row__text">
                <div className="mod-row__label">增強互動性</div>
                <div className="mod-row__desc">
                  讓集氣、丟球這些步驟多出身體動作（滑動／畫圈／長按／節奏）。預設關；切換後從下一個互動步驟生效。
                </div>
              </div>
            </div>
            <div className="interact-seg" role="group" aria-label="增強互動性程度">
              {INTERACT_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  className={`interact-seg__btn ${interactMode === o.id ? 'interact-seg__btn--on' : ''}`}
                  aria-pressed={interactMode === o.id}
                  onClick={() => { if (interactMode !== o.id) { audio.play('select'); setInteractMode(o.id) } }}
                >
                  <span className="interact-seg__label">{o.label}</span>
                  <span className="interact-seg__hint">{o.hint}</span>
                </button>
              ))}
            </div>
            {/* M22.g 攻擊輸入變體：僅在開啟增強互動時顯示（off＝沿用連打、不顯示避免混淆） */}
            {interactMode !== 'off' && (
              <div className="interact-seg interact-seg--sub" role="group" aria-label="攻擊輸入方式" style={{ marginTop: 8 }}>
                {([['mash', '連打蓄力', '預設；快速點擊集氣'], ['rhythm', '節奏點擊', '跟著節拍按']] as const).map(([id, label, hint]) => (
                  <button
                    key={id}
                    className={`interact-seg__btn ${attackVariant === id ? 'interact-seg__btn--on' : ''}`}
                    aria-pressed={attackVariant === id}
                    onClick={() => { if (attackVariant !== id) { audio.play('select'); setAttackInputVariant(id) } }}
                  >
                    <span className="interact-seg__label">⚔ {label}</span>
                    <span className="interact-seg__hint">{hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* EXT.1 打擊感 / 觸覺回饋（UX 偏好，純 display；預設 完整 + 震動開） */}
          <div className="settings-divider">🎇 打擊感與回饋</div>
          <div className="interact-pref">
            <div className="interact-pref__head">
              <span className="mod-row__icon">💥</span>
              <div className="mod-row__text">
                <div className="mod-row__label">打擊感強度</div>
                <div className="mod-row__desc">
                  攻擊命中時的浮動傷害數字、效果絕佳圖示、會心強調與「頓一下」的重擊感。「關」＝回到最單純的閃光。
                </div>
              </div>
            </div>
            <div className="interact-seg" role="group" aria-label="打擊感強度">
              {JUICE_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  className={`interact-seg__btn ${juice === o.id ? 'interact-seg__btn--on' : ''}`}
                  aria-pressed={juice === o.id}
                  onClick={() => { if (juice !== o.id) { audio.play('select'); setJuice(o.id) } }}
                >
                  <span className="interact-seg__label">{o.label}</span>
                  <span className="interact-seg__hint">{o.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div
            className={`mod-row ${haptics ? 'mod-row--on' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={haptics}
            onClick={() => { audio.play('select'); setHaptics(!haptics) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                audio.play('select')
                setHaptics(!haptics)
              }
            }}
          >
            <span className="mod-row__icon">📳</span>
            <div className="mod-row__text">
              <div className="mod-row__label">觸覺回饋（震動）</div>
              <div className="mod-row__desc">命中／會心／捕獲時手機輕震一下（需裝置支援，iPad 多半無效＝自動忽略）。預設開；下一個回饋事件生效。</div>
            </div>
            <span className={`switch ${haptics ? 'switch--on' : ''}`}>
              <span className="switch__knob" />
            </span>
          </div>

          <div className="settings-divider">🖥️ 戰鬥畫面</div>
          <div className="interact-pref">
            <div className="interact-pref__head">
              <span className="mod-row__icon">🎨</span>
              <div className="mod-row__text">
                <div className="mod-row__label">畫面品質</div>
                <div className="mod-row__desc">
                  只影響戰鬥 renderer 的畫質成本；預設自動會交給 M23 的平衡策略。設定立即保存，下次進入戰鬥時套用。
                </div>
              </div>
            </div>
            <div className="interact-seg interact-seg--graphics" role="group" aria-label="戰鬥畫面品質">
              {GRAPHICS_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`interact-seg__btn ${graphicsPreference === option.id ? 'interact-seg__btn--on' : ''}`}
                  aria-pressed={graphicsPreference === option.id}
                  data-settings-preference="graphicsPreference"
                  data-settings-value={option.id}
                  onClick={() => { if (graphicsPreference !== option.id) { audio.play('select'); setGraphicsPreference(option.id) } }}
                >
                  <span className="interact-seg__label">{option.label}</span>
                  <span className="interact-seg__hint">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div
            className={`mod-row ${scannerEnabled ? 'mod-row--on' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={scannerEnabled}
            data-settings-preference="scannerEnabled"
            onClick={() => { audio.play('select'); setScannerEnabled(!scannerEnabled) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                audio.play('select')
                setScannerEnabled(!scannerEnabled)
              }
            }}
          >
            <span className="mod-row__icon">📷</span>
            <div className="mod-row__text">
              <div className="mod-row__label">顯示掃卡工具</div>
              <div className="mod-row__desc">預設關。開啟後「更多」才顯示掃卡；只有你明確選擇掃卡時才載入相機功能並請求權限。</div>
            </div>
            <span className={`switch ${scannerEnabled ? 'switch--on' : ''}`} aria-hidden="true">
              <span className="switch__knob" />
            </span>
          </div>

          <div className="settings-divider">🎬 戰鬥回放</div>
          <div
            className={`mod-row ${recordReplays ? 'mod-row--on' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={recordReplays}
            onClick={() => { audio.play('select'); setReplayRecording(!recordReplays) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                audio.play('select')
                setReplayRecording(!recordReplays)
              }
            }}
          >
            <span className="mod-row__icon">🎬</span>
            <div className="mod-row__text">
              <div className="mod-row__label">錄製戰鬥回放</div>
              <div className="mod-row__desc">把每場戰鬥存成可重播的紀錄（從 Title「🎬 回放」觀看／匯出文字戰報）。最多保留最近 50 場。預設關；下一場戰鬥開始時生效。</div>
            </div>
            <span className={`switch ${recordReplays ? 'switch--on' : ''}`}>
              <span className="switch__knob" />
            </span>
          </div>
        </div>

        <div className="model-foot">
          這些偏好只影響操作、回饋、戰鬥畫面與掃卡入口，不影響 Mobie 存檔；預設值會在缺少合法設定時使用。
        </div>
      </motion.div>
    </motion.div>
  )
}
