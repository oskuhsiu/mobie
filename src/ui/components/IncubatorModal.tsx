// M10 — 孵化頁。蛋列表 + 進度條 + 來源標籤 + 孵化（蛋裂→定格新Mobie + Grade 徽章）。
import { motion } from 'framer-motion'
import { useIncubator } from '@/store/incubatorStore'
import { isHatchable, type Egg } from '@/game/incubator'
import { getSpecies } from '@/game/data/species'
import { findMove } from '@/game/data/moves'
import { GradeBadge } from '@/ui/components/GradeBadge'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { GestureGate } from '@/ui/components/GestureGate'
import { useSettings } from '@/store/settingsStore'
import { interactModeOf } from '@/game/settings'
import { audio } from '@/audio/audioEngine'
import type { OwnedUnit } from '@/game/types'
import { ModalSurface } from '@/ui/shell/ModalSurface'
import { useOverlayController } from '@/ui/shell/OverlayController'

const SOURCE_LABEL: Record<Egg['source'], string> = { achievement: '成就', duplicate: '重複轉化', tower: '舊資料' }

export function IncubatorModal({ onClose }: { onClose: () => void }) {
  const eggs = useIncubator((s) => s.state.eggs)
  const hatch = useIncubator((s) => s.hatch)
  // M22.i：孵化前摩擦生熱（純演出）。off＝直接孵化；開啟＝來回摩擦蛋後才 hatch。
  const rubOn = useSettings((s) => interactModeOf(s.settings, 'hatch') !== 'off')
  const controller = useOverlayController()

  const doHatch = async (id: string) => {
    const u = await hatch(id)
    if (u) {
      audio.play('capture')
      controller.push({
        id: `hatch-reveal:${u.id}`,
        policy: 'escape-and-backdrop',
        content: <HatchReveal hatched={u} onClose={controller.pop} />,
      })
    }
  }
  const onHatchClick = (id: string) => {
    if (!rubOn) { void doHatch(id); return }
    controller.push({
      id: `hatch:${id}`,
      policy: 'explicit-action-only',
      content: (
        <GestureGate
          title="🔥 摩擦生熱"
          icon="🥚"
          hint="來回快速摩擦蛋殼，幫小生命破殼！"
          onComplete={() => { controller.pop(); void doHatch(id) }}
          onCancel={controller.pop}
        />
      ),
    })
  }

  return (
    <ModalSurface
      title="🥚 孵化所"
      description="蛋隨每場戰鬥累積進度；滿了即可孵化。來源：成就 / 重複捕獲"
      onClose={onClose}
      className="incubator-surface"
    >
      <div className="modal-surface__stack">
          {eggs.length === 0 && (
            <div className="h-sub" style={{ padding: 20, textAlign: 'center' }}>
              還沒有蛋。領取成就獎勵，或在野外收服已擁有的Mobie（自動轉化為蛋）來獲得！
            </div>
          )}
          {eggs.map((e) => {
            const ready = isHatchable(e)
            const pct = Math.round((e.progress / e.requiredProgress) * 100)
            return (
              <div key={e.id} className={`egg-row ${ready ? 'egg-row--ready' : ''}`}>
                <span className="egg-row__icon">{ready ? '🐣' : '🥚'}</span>
                <div className="egg-row__body">
                  <div className="egg-row__top">
                    <span className="egg-row__label">{e.label}</span>
                    <span className="egg-row__src">{SOURCE_LABEL[e.source]}</span>
                  </div>
                  <div className="egg-row__track"><div className="egg-row__fill" style={{ width: `${pct}%` }} /></div>
                  <div className="egg-row__prog">{e.progress} / {e.requiredProgress}</div>
                  {e.inheritedMoveId && findMove(e.inheritedMoveId) && (
                    <div className="egg-row__inherit">🧬 蛋招：{findMove(e.inheritedMoveId)!.nameZh}</div>
                  )}
                </div>
                <button className="btn btn--sm" disabled={!ready} onClick={() => ready && onHatchClick(e.id)}>
                  {ready ? '孵化' : '培育中'}
                </button>
              </div>
            )
          })}
      </div>

    </ModalSurface>
  )
}

function HatchReveal({ hatched, onClose }: { hatched: OwnedUnit; onClose: () => void }) {
  const species = getSpecies(hatched.speciesId)
  return (
    <ModalSurface title="🎉 孵化結果" description="新的夥伴已加入你的隊伍。" onClose={onClose} className="hatch-surface">
      <div className="hatch-reveal hatch-reveal--surface" onClick={onClose}>
        <motion.div className="hatch-reveal__mon"
          initial={{ scale: 0.4, opacity: 0, filter: 'brightness(5)' }}
          animate={{ scale: 1, opacity: 1, filter: 'brightness(1)' }}
          transition={{ type: 'spring', stiffness: 150, damping: 13 }}>
          <MobieSprite src={species.artworkUrl} alt={species.nameZh} shiny={hatched.shiny} />
        </motion.div>
        <div className="hatch-reveal__caption">
          孵出了 <b>{species.nameZh}</b>！　<GradeBadge indiv={hatched} speciesId={hatched.speciesId} />
        </div>
        <div className="h-sub">點擊關閉</div>
      </div>
    </ModalSurface>
  )
}
