// M10 — 孵化頁。蛋列表 + 進度條 + 來源標籤 + 孵化（蛋裂→定格新Mobie + Grade 徽章）。
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useIncubator } from '@/store/incubatorStore'
import { isHatchable, type Egg } from '@/game/incubator'
import { getSpecies } from '@/game/data/species'
import { GradeBadge } from '@/ui/components/GradeBadge'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { audio } from '@/audio/audioEngine'
import type { OwnedUnit } from '@/game/types'

const SOURCE_LABEL: Record<Egg['source'], string> = { achievement: '成就', duplicate: '重複轉化', tower: '連勝塔' }

export function IncubatorModal({ onClose }: { onClose: () => void }) {
  const eggs = useIncubator((s) => s.state.eggs)
  const hatch = useIncubator((s) => s.hatch)
  const [hatched, setHatched] = useState<OwnedUnit | null>(null)

  const doHatch = async (id: string) => {
    const u = await hatch(id)
    if (u) { audio.play('capture'); setHatched(u) }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-card__head">
          <div>
            <div className="h-title" style={{ fontSize: 24 }}>🥚 孵化所</div>
            <div className="h-sub">蛋隨每場戰鬥累積進度；滿了即可孵化。來源：成就 / 重複捕獲 / 連勝塔</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                </div>
                <button className="btn btn--sm" disabled={!ready} onClick={() => ready && doHatch(e.id)}>
                  {ready ? '孵化' : '培育中'}
                </button>
              </div>
            )
          })}
        </div>

        {/* 孵化定格 reveal */}
        <AnimatePresence>
          {hatched && (() => {
            const sp = getSpecies(hatched.speciesId)
            return (
              <motion.div className="hatch-reveal" onClick={() => setHatched(null)}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <motion.div className="hatch-reveal__mon"
                  initial={{ scale: 0.4, opacity: 0, filter: 'brightness(5)' }}
                  animate={{ scale: 1, opacity: 1, filter: 'brightness(1)' }}
                  transition={{ type: 'spring', stiffness: 150, damping: 13 }}>
                  <MobieSprite src={sp.artworkUrl} alt={sp.nameZh} shiny={hatched.shiny} />
                </motion.div>
                <div className="hatch-reveal__caption">
                  孵出了 <b>{sp.nameZh}</b>！　<GradeBadge indiv={hatched} speciesId={hatched.speciesId} />
                </div>
                <div className="h-sub">已加入你的隊伍。點擊關閉</div>
              </motion.div>
            )
          })()}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}
