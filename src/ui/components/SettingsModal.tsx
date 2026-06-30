import { motion } from 'framer-motion'
import { useSettings } from '@/store/settingsStore'
import { MODULE_IDS, type InteractMode, type JuiceLevel } from '@/game/settings'
import type { ModuleId } from '@/game/ext/seams'
import { audio } from '@/audio/audioEngine'

/** M22 增強互動性三態（plan/22 §1.2, §5.4）：mode 派生強度，不做使用者滑桿。 */
const INTERACT_OPTIONS: { id: InteractMode; label: string; hint: string }[] = [
  { id: 'off', label: '關', hint: '點一下就好，最單純' },
  { id: 'lite', label: '輕度', hint: '滑動丟球、長按蓄力' },
  { id: 'arcade', label: '機台', hint: '畫圈封印、節奏點擊' },
]

/** EXT.1 打擊感強度三態（plan/EXT.1 §3）：升級爽感／減量／回到 M22 純閃光。 */
const JUICE_OPTIONS: { id: JuiceLevel; label: string; hint: string }[] = [
  { id: 'full', label: '完整', hint: '傷害數字＋頓格＋動態（推薦）' },
  { id: 'reduced', label: '減量', hint: '只留浮傷數字、不頓格' },
  { id: 'off', label: '關', hint: '回到最單純的閃光' },
]

/** 各模組的 UI 文案 + 是否已實作（未實作的在設定頁標「敬請期待」、不可開）。 */
interface ModuleMeta {
  icon: string
  label: string
  desc: string
  available: boolean
}

const MODULE_META: Record<ModuleId, ModuleMeta> = {
  synergy: {
    icon: '🤝',
    label: '隊伍羈絆',
    desc: '依組隊條件給全隊加成（多樣陣容 / 同屬共鳴 / 世代羈絆），選卡時即時顯示。',
    available: true,
  },
  heldItems: {
    icon: '🎒',
    label: '持有道具',
    desc: '每隻可裝一個被動道具：強化能力值 / 提升傷害 / 回合末回血。在「隊伍」頁裝備。',
    available: true,
  },
  abilities: {
    icon: '✨',
    label: '特性',
    desc: '依屬性的種族被動（絕境爆發 / 蠻力 / 疾風 / 神秘體 / 厚實），對戰雙方皆生效。',
    available: true,
  },
  chain: {
    icon: '🔗',
    label: '連鎖攻擊',
    desc: '普攻命中累積連鎖槽，集滿可發動連鎖：最多 3 隻隊友依序連續出擊（吃速度、目標倒下即截斷）。',
    available: true,
  },
  combo: {
    icon: '✨',
    label: '合體技',
    desc: '連鎖時若參與隊友符合配對（如火＋水）→ 升級成合體大招＋施放效果（灌注地形／全隊增益／敵方弱化），每組合每場一次。需搭配「連鎖攻擊」。',
    available: true,
  },
  evolution: {
    icon: '🧬',
    label: '進化',
    desc: 'Mobie到達進化等級時於戰後進化、變更種族並重算能力值（個體/道具保留，招式仍單一）。',
    available: true,
  },
  partnerSkills: {
    icon: '✨',
    label: '夥伴技能',
    desc: '訓練師自己的帳號級戰術工具：戰鬥中「🔍 看穿」對手底細、「📣 訓練師加油」灌注全隊士氣。在「夥伴技能」頁花 SP 解鎖。',
    available: true,
  },
  encounterSkills: {
    icon: '🃏',
    label: '對手技能標籤',
    desc: '野生對手依物種帶 0–2 個被動標籤（猛攻／擾亂／堅韌／馭場／合擊），微調其能力值並在遭遇/資訊卡顯示；對手 AI 仍只普通攻擊。',
    available: true,
  },
}

/**
 * 延伸系統設定面板：逐一開關可選式掛載模組（plan/09 §0.3）。
 * 預設全關＝純 M1.x 體驗；開啟後該模組的縫才生效（戰前 prep / 戰中 ext 由 store 重組）。
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings((s) => s.settings)
  const setModuleEnabled = useSettings((s) => s.setModuleEnabled)
  const setInteractMode = useSettings((s) => s.setInteractMode)
  const setReplayRecording = useSettings((s) => s.setReplayRecording)
  const setAttackInputVariant = useSettings((s) => s.setAttackInputVariant)
  const setJuice = useSettings((s) => s.setJuice)
  const setHaptics = useSettings((s) => s.setHaptics)
  const interactMode = settings.prefs.enhancedInteractivity.mode
  const recordReplays = settings.prefs.recordReplays
  const attackVariant = settings.prefs.attackInputVariant
  const juice = settings.prefs.juice
  const haptics = settings.prefs.haptics

  const toggle = (id: ModuleId, available: boolean) => {
    if (!available) return
    audio.play('select')
    setModuleEnabled(id, !settings.modules[id])
  }

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
            <div className="h-title" style={{ fontSize: 24 }}>⚙️ 延伸系統</div>
            <div className="h-sub">逐一開啟想玩的進階系統；預設全關＝最單純的對戰。</div>
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
                  讓集氣、丟球這些步驟多出身體動作（滑動／畫圈／長按／節奏），給小朋友更多參與感。預設「關」＝只要點一下。
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
                {([['mash', '連打蓄力', '快速點擊集氣'], ['rhythm', '節奏點擊', '跟著節拍按']] as const).map(([id, label, hint]) => (
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
            onClick={() => { audio.play('select'); setHaptics(!haptics) }}
          >
            <span className="mod-row__icon">📳</span>
            <div className="mod-row__text">
              <div className="mod-row__label">觸覺回饋（震動）</div>
              <div className="mod-row__desc">命中／會心／捕獲時手機輕震一下（需裝置支援，iPad 多半無效＝自動忽略）。預設開。</div>
            </div>
            <span className={`switch ${haptics ? 'switch--on' : ''}`}>
              <span className="switch__knob" />
            </span>
          </div>

          <div className="settings-divider">🧩 延伸系統模組</div>

          {MODULE_IDS.map((id) => {
            const meta = MODULE_META[id]
            const on = settings.modules[id] && meta.available
            return (
              <div
                key={id}
                className={`mod-row ${on ? 'mod-row--on' : ''} ${meta.available ? '' : 'mod-row--soon'}`}
                role="button"
                tabIndex={0}
                aria-disabled={!meta.available}
                onClick={() => toggle(id, meta.available)}
              >
                <span className="mod-row__icon">{meta.icon}</span>
                <div className="mod-row__text">
                  <div className="mod-row__label">
                    {meta.label}
                    {!meta.available && <span className="mod-row__soon">敬請期待</span>}
                  </div>
                  <div className="mod-row__desc">{meta.desc}</div>
                </div>
                <span className={`switch ${on ? 'switch--on' : ''} ${meta.available ? '' : 'switch--off'}`}>
                  <span className="switch__knob" />
                </span>
              </div>
            )
          })}

          <div className="settings-divider">🎬 戰鬥回放</div>
          <div
            className={`mod-row ${recordReplays ? 'mod-row--on' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => { audio.play('select'); setReplayRecording(!recordReplays) }}
          >
            <span className="mod-row__icon">🎬</span>
            <div className="mod-row__text">
              <div className="mod-row__label">錄製戰鬥回放</div>
              <div className="mod-row__desc">把每場戰鬥存成可重播的紀錄（從 Title「🎬 回放」觀看／匯出文字戰報）。最多保留最近 50 場。預設關＝不錄製。</div>
            </div>
            <span className={`switch ${recordReplays ? 'switch--on' : ''}`}>
              <span className="switch__knob" />
            </span>
          </div>
        </div>

        <div className="model-foot">
          設定獨立存於 <b>mobie.settings.v1</b>，不影響Mobie存檔。關掉模組＝零殘留，回到純對戰。
        </div>
      </motion.div>
    </motion.div>
  )
}
