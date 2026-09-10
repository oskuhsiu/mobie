import type { ReactNode } from 'react'
import { useSettings } from '@/store/settingsStore'
import type { AttackInputVariant, GraphicsPreference, InteractMode, InteractSurface, JuiceLevel } from '@/game/settings'
import { audio } from '@/audio/audioEngine'
import { ModalSurface } from '@/ui/shell/ModalSurface'

/** M22 enhanced interaction is one UX preference; its surfaces stay a read-only
 * capability map so the settings page never invents gameplay switches. */
const INTERACT_OPTIONS: { id: InteractMode; label: string; hint: string }[] = [
  { id: 'off', label: '關閉', hint: '點一下就好' },
  { id: 'lite', label: '輕度', hint: '滑動、長按' },
  { id: 'arcade', label: '機台', hint: '畫圈、節奏' },
]

const ATTACK_OPTIONS: { id: AttackInputVariant; label: string; hint: string }[] = [
  { id: 'mash', label: '連打蓄力', hint: '快速點擊集氣' },
  { id: 'rhythm', label: '節奏點擊', hint: '跟著節拍按' },
]

const JUICE_OPTIONS: { id: JuiceLevel; label: string; hint: string }[] = [
  { id: 'full', label: '完整', hint: '傷害數字、頓格、動態' },
  { id: 'reduced', label: '減量', hint: '保留數字，減少干擾' },
  { id: 'off', label: '關閉', hint: '只保留基本閃光' },
]

const GRAPHICS_OPTIONS: { id: GraphicsPreference; label: string; hint: string }[] = [
  { id: 'auto', label: '自動', hint: '實際採平衡策略' },
  { id: 'high', label: '高畫質', hint: '提高細節成本' },
  { id: 'balanced', label: '平衡', hint: '畫質與效能均衡' },
  { id: 'compatibility', label: '相容', hint: '使用輕量戰鬥畫面' },
]

const INTERACT_SURFACE_LABELS: { id: InteractSurface; label: string }[] = [
  { id: 'capture', label: '捕捉' },
  { id: 'starStrike', label: '星擊' },
  { id: 'defense', label: '防禦' },
  { id: 'encounter', label: '遇敵' },
  { id: 'hatch', label: '孵化' },
  { id: 'tower', label: '塔樓' },
]

function PreferenceMeta({
  defaultValue,
  scope,
  effect,
}: {
  defaultValue: string
  scope: string
  effect: string
}) {
  return (
    <dl className="settings-pref-meta" aria-label="設定資訊">
      <div data-settings-meta="default"><dt>預設</dt><dd>{defaultValue}</dd></div>
      <div data-settings-meta="scope"><dt>範圍</dt><dd>{scope}</dd></div>
      <div data-settings-meta="effect"><dt>生效</dt><dd>{effect}</dd></div>
    </dl>
  )
}

function PreferenceHeading({ icon, title, description, descriptionId }: { icon: string; title: string; description: string; descriptionId?: string }) {
  return (
    <div className="settings-pref__heading">
      <span className="settings-pref__icon" aria-hidden="true">{icon}</span>
      <div className="settings-pref__copy">
        <h4 className="settings-pref__title">{title}</h4>
        <p id={descriptionId} className="settings-pref__description">{description}</p>
      </div>
    </div>
  )
}

function SettingsSection({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: string
  icon: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="settings-section" data-settings-section={id} aria-labelledby={`settings-section-${id}`}>
      <header className="settings-section__heading">
        <span className="settings-section__icon" aria-hidden="true">{icon}</span>
        <div>
          <h3 id={`settings-section-${id}`}>{title}</h3>
          <p>{description}</p>
        </div>
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  )
}

function PreferenceSwitch({
  id,
  icon,
  title,
  description,
  value,
  onChange,
  defaultValue,
  scope,
  effect,
}: {
  id: string
  icon: string
  title: string
  description: string
  value: boolean
  onChange: () => void
  defaultValue: string
  scope: string
  effect: string
}) {
  return (
    <article
      className={`settings-pref settings-pref--switch ${value ? 'settings-pref--on' : ''}`}
      data-settings-item={id}
      data-settings-state={value ? 'on' : 'off'}
      data-settings-default={defaultValue}
      data-settings-scope={scope}
      data-settings-effect={effect}
    >
      <button
        type="button"
        className="settings-switch"
        role="switch"
        aria-checked={value}
        aria-pressed={value}
        aria-label={`${title}：${value ? '開啟' : '關閉'}`}
        aria-describedby={`settings-description-${id}`}
        data-settings-preference={id}
        data-settings-value={value ? 'on' : 'off'}
        onClick={() => { audio.play('select'); onChange() }}
      >
        <span className="settings-pref__main">
          <PreferenceHeading icon={icon} title={title} description={description} descriptionId={`settings-description-${id}`} />
          <span className="settings-switch__status" aria-hidden="true">{value ? '開啟' : '關閉'}</span>
        </span>
        <span className={`switch ${value ? 'switch--on' : ''}`} aria-hidden="true">
          <span className="switch__knob" />
        </span>
      </button>
      <PreferenceMeta defaultValue={defaultValue} scope={scope} effect={effect} />
    </article>
  )
}

/** Formal Settings v2 surface. Every control below maps directly to a
 * persisted preference; fixed gameplay capabilities have no representation here. */
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
  const surfaces = settings.prefs.enhancedInteractivity.surfaces
  const recordReplays = settings.prefs.recordReplays
  const attackVariant = settings.prefs.attackInputVariant
  const juice = settings.prefs.juice
  const haptics = settings.prefs.haptics
  const graphicsPreference = settings.prefs.graphicsPreference
  const scannerEnabled = settings.prefs.scannerEnabled

  return (
    <ModalSurface
      title="⚙️ 設定"
      description="調整操作、顯示、資料與裝置偏好。變更會立即保存；各項生效時間標示在卡片下方。"
      onClose={onClose}
      className="settings-surface"
      footer={(
        <div className="settings-surface-footer">
          <p className="utility-foot" data-settings-footer>偏好只保存在這台裝置，不會改動 Mobie 進度；缺少合法值時會回到預設。</p>
          <button type="button" className="btn btn--ghost btn--sm" data-settings-done onClick={onClose}>完成</button>
        </div>
      )}
    >
      <div className="settings-shell" data-settings data-settings-schema-version="2">
        <div className="settings-shell__legend" role="note">
          <span className="settings-shell__legend-dot" aria-hidden="true">●</span>
          <span>每一項都是可保存的玩家偏好；金色邊框表示目前選擇。</span>
        </div>

        <div className="settings-grid">
          <SettingsSection id="operation" icon="🕹️" title="操作" description="選擇互動強度與攻擊輸入方式。">
            <article
              className="settings-pref"
              data-settings-item="enhancedInteractivity"
              data-settings-state={interactMode}
              data-settings-default="off"
              data-settings-scope="interactive-surfaces"
              data-settings-effect="next-interaction"
            >
              <PreferenceHeading
                icon="🕹️"
                title="增強互動性"
                description="讓捕捉、星擊與其他互動步驟多一點身體動作；關閉時沿用基本點擊。"
                descriptionId="settings-description-enhancedInteractivity"
              />
              <div className="interact-seg" role="group" aria-label="增強互動性程度">
                {INTERACT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`interact-seg__btn ${interactMode === option.id ? 'interact-seg__btn--on' : ''}`}
                    aria-pressed={interactMode === option.id}
                    aria-label={`${option.label}：${option.hint}`}
                    aria-describedby="settings-description-enhancedInteractivity"
                    data-settings-preference="enhancedInteractivity"
                    data-settings-value={option.id}
                    onClick={() => {
                      if (interactMode !== option.id) {
                        audio.play('select')
                        setInteractMode(option.id)
                      }
                    }}
                  >
                    <span className="interact-seg__label">{option.label}</span>
                    <span className="interact-seg__hint">{option.hint}</span>
                  </button>
                ))}
              </div>
              <div className="settings-surface-list" data-settings-surfaces aria-label="增強互動適用範圍">
                <span className="settings-surface-list__label">適用場景</span>
                <div className="settings-surface-list__chips">
                  {INTERACT_SURFACE_LABELS.map((surface) => (
                    <span
                      key={surface.id}
                      className={`settings-surface-chip ${surfaces[surface.id] ? 'settings-surface-chip--on' : ''}`}
                      data-settings-surface={surface.id}
                      data-settings-surface-enabled={surfaces[surface.id] ? 'true' : 'false'}
                    >
                      <span aria-hidden="true">{surfaces[surface.id] ? '✓' : '—'}</span> {surface.label}
                    </span>
                  ))}
                </div>
              </div>
              <PreferenceMeta defaultValue="關閉" scope="六個互動場景" effect="下一個互動步驟" />
            </article>

            {interactMode !== 'off' && (
              <article
                className="settings-pref"
                data-settings-item="attackInputVariant"
                data-settings-state={attackVariant}
                data-settings-default="mash"
                data-settings-scope="star-strike"
                data-settings-effect="next-attack"
              >
                <PreferenceHeading
                  icon="⚔️"
                  title="攻擊輸入方式"
                  description="增強互動開啟後，選擇星擊時使用的輸入方式。"
                  descriptionId="settings-description-attackInputVariant"
                />
                <div className="interact-seg interact-seg--attack" role="group" aria-label="攻擊輸入方式">
                  {ATTACK_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`interact-seg__btn ${attackVariant === option.id ? 'interact-seg__btn--on' : ''}`}
                      aria-pressed={attackVariant === option.id}
                      aria-label={`${option.label}：${option.hint}`}
                      aria-describedby="settings-description-attackInputVariant"
                      data-settings-preference="attackInputVariant"
                      data-settings-value={option.id}
                      onClick={() => {
                        if (attackVariant !== option.id) {
                          audio.play('select')
                          setAttackInputVariant(option.id)
                        }
                      }}
                    >
                      <span className="interact-seg__label">{option.label}</span>
                      <span className="interact-seg__hint">{option.hint}</span>
                    </button>
                  ))}
                </div>
                <PreferenceMeta defaultValue="連打蓄力" scope="星擊攻擊" effect="下一個攻擊步驟" />
              </article>
            )}
            {interactMode === 'off' && (
              <p className="settings-conditional-note" data-settings-attack-note>開啟增強互動後，這裡會出現攻擊輸入選擇。</p>
            )}
          </SettingsSection>

          <SettingsSection id="display" icon="🖥️" title="顯示與回饋" description="分開控制畫面成本、動態打擊感與觸覺。">
            <article
              className="settings-pref"
              data-settings-item="graphicsPreference"
              data-settings-state={graphicsPreference}
              data-settings-default="auto"
              data-settings-scope="battle-renderer"
              data-settings-effect="next-battle"
            >
              <PreferenceHeading
                icon="🎨"
                title="畫面品質"
                description="只影響戰鬥畫面的成本；自動會交給正式 renderer 的平衡策略。"
                descriptionId="settings-description-graphicsPreference"
              />
              <div className="interact-seg interact-seg--graphics" role="group" aria-label="戰鬥畫面品質">
                {GRAPHICS_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`interact-seg__btn ${graphicsPreference === option.id ? 'interact-seg__btn--on' : ''}`}
                    aria-pressed={graphicsPreference === option.id}
                    aria-label={`${option.label}：${option.hint}`}
                    aria-describedby="settings-description-graphicsPreference"
                    data-settings-preference="graphicsPreference"
                    data-settings-value={option.id}
                    onClick={() => {
                      if (graphicsPreference !== option.id) {
                        audio.play('select')
                        setGraphicsPreference(option.id)
                      }
                    }}
                  >
                    <span className="interact-seg__label">{option.label}</span>
                    <span className="interact-seg__hint">{option.hint}</span>
                  </button>
                ))}
              </div>
              <PreferenceMeta defaultValue="自動（實際平衡）" scope="戰鬥 renderer" effect="下一次進入戰鬥" />
            </article>

            <article
              className="settings-pref"
              data-settings-item="juice"
              data-settings-state={juice}
              data-settings-default="full"
              data-settings-scope="battle-feedback"
              data-settings-effect="next-feedback"
            >
              <PreferenceHeading
                icon="💥"
                title="打擊感強度"
                description="調整命中時的浮動傷害數字、特殊效果與停頓感，和畫面品質分開。"
                descriptionId="settings-description-juice"
              />
              <div className="interact-seg" role="group" aria-label="打擊感強度">
                {JUICE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`interact-seg__btn ${juice === option.id ? 'interact-seg__btn--on' : ''}`}
                    aria-pressed={juice === option.id}
                    aria-label={`${option.label}：${option.hint}`}
                    aria-describedby="settings-description-juice"
                    data-settings-preference="juice"
                    data-settings-value={option.id}
                    onClick={() => {
                      if (juice !== option.id) {
                        audio.play('select')
                        setJuice(option.id)
                      }
                    }}
                  >
                    <span className="interact-seg__label">{option.label}</span>
                    <span className="interact-seg__hint">{option.hint}</span>
                  </button>
                ))}
              </div>
              <PreferenceMeta defaultValue="完整" scope="戰鬥回饋" effect="下一個回饋事件" />
            </article>

            <PreferenceSwitch
              id="haptics"
              icon="📳"
              title="觸覺回饋"
              description="在支援的裝置上，命中、會心與捕捉時提供輕震。"
              value={haptics}
              onChange={() => setHaptics(!haptics)}
              defaultValue="開啟"
              scope="支援觸覺的裝置"
              effect="下一個回饋事件"
            />
          </SettingsSection>

          <SettingsSection id="data" icon="🗃️" title="資料" description="管理戰鬥紀錄在本機的保存方式。">
            <PreferenceSwitch
              id="recordReplays"
              icon="🎬"
              title="錄製戰鬥回放"
              description="將戰鬥事件保存為可重播紀錄，方便稍後查看與分享文字戰報。"
              value={recordReplays}
              onChange={() => setReplayRecording(!recordReplays)}
              defaultValue="關閉"
              scope="本機回放資料"
              effect="下一場戰鬥"
            />
            <p className="settings-section__note">最多保留最近 50 場；關閉後不會新增紀錄，既有回放仍可查看。</p>
          </SettingsSection>

          <SettingsSection id="device" icon="📱" title="裝置功能" description="控制需要裝置能力的入口；權限只在你明確使用時詢問。">
            <PreferenceSwitch
              id="scannerEnabled"
              icon="📷"
              title="顯示掃卡工具"
              description="開啟後，更多與卡庫才會提供掃卡入口；只在選取掃卡後才會嘗試相機。"
              value={scannerEnabled}
              onChange={() => setScannerEnabled(!scannerEnabled)}
              defaultValue="關閉"
              scope="更多、卡庫入口"
              effect="立即（關閉設定後）"
            />
            <p className="settings-section__note">關閉時不顯示掃卡按鈕，也不會請求相機權限。</p>
          </SettingsSection>
        </div>
      </div>
    </ModalSurface>
  )
}
