import { motion } from 'framer-motion'
import { useSettings } from '@/store/settingsStore'
import { MODULE_IDS } from '@/game/settings'
import type { ModuleId } from '@/game/ext/seams'
import { audio } from '@/audio/audioEngine'

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
  evolution: {
    icon: '🧬',
    label: '進化',
    desc: 'Mobie到達進化等級時於戰後進化、變更種族並重算能力值（個體/道具保留，招式仍單一）。',
    available: true,
  },
  tower: { icon: '🗼', label: '連勝塔', desc: '連續戰鬥不回血的長線遠征模式。', available: false },
}

/**
 * 延伸系統設定面板：逐一開關可選式掛載模組（plan/09 §0.3）。
 * 預設全關＝純 M1.x 體驗；開啟後該模組的縫才生效（戰前 prep / 戰中 ext 由 store 重組）。
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings((s) => s.settings)
  const setModuleEnabled = useSettings((s) => s.setModuleEnabled)

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
        </div>

        <div className="model-foot">
          設定獨立存於 <b>mobie.settings.v1</b>，不影響Mobie存檔。關掉模組＝零殘留，回到純對戰。
        </div>
      </motion.div>
    </motion.div>
  )
}
