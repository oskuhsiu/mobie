import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useGame } from '@/app/GameProvider'
import { buildBattleMobie } from '@/game/stats'
import { useMeta } from '@/store/metaStore'
import { useAccidents } from '@/store/accidentStore'
import { useSkillPoints } from '@/store/skillPointsStore'
import type { BattleMobie } from '@/game/types'
import { lookupRegion } from '@/game/data/regionLookup'
import { rollEncounterAccidents, type SupplyOption } from '@/game/accidents'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'
import { IndividualInfo } from '@/ui/components/IndividualInfo'
import { MobCard } from '@/ui/components/MobCard'
import { GestureGate } from '@/ui/components/GestureGate'
import { useSettings } from '@/store/settingsStore'
import { interactModeOf } from '@/game/settings'
import { audio } from '@/audio/audioEngine'

export function EncounterScreen() {
  const { context, send } = useGame()
  // M22.h：遭遇前撥草（純演出）。off＝直接出戰；開啟＝撥開草叢手勢後才 ENGAGE。
  const grassOn = useSettings((s) => interactModeOf(s.settings, 'encounter') !== 'off')
  const [grassGate, setGrassGate] = useState(false)
  const engage = () => { if (grassOn) setGrassGate(true); else send({ type: 'ENGAGE' }) }
  const foes = useMemo(
    () => context.foeTeam.map(buildBattleMobie),
    [context.foeTeam],
  )
  // M16：點對手開資訊卡（對手＝基本面，深度遮罩待 M17 看穿）
  const [cardMon, setCardMon] = useState<BattleMobie | null>(null)
  const openCard = (m: BattleMobie) => { audio.play('select'); setCardMon(m) }
  // M11 野外意外：遭遇 roll（決定論）→ luckyBonus 自動加成 + 天降補給三選一 modal。
  const accidents = useMemo(() => {
    const region = context.regionId ? lookupRegion(context.regionId) : null
    return region ? rollEncounterAccidents(region, context.foeTeam) : { luckyExpMult: 1, supply: null }
  }, [context.regionId, context.foeTeam])
  const bossShiny = foes.length > 0 && foes[foes.length - 1].shiny
  const [supplyOpen, setSupplyOpen] = useState(false)
  // 圖鑑：遭遇即把對手隊伍全部記為「看過」（seen；尚未捕獲）；同時套用本場意外旗標。
  useEffect(() => {
    if (context.foeTeam.length === 0) return
    useMeta.getState().recordSeen(context.foeTeam.map((c) => c.speciesId))
    useAccidents.getState().reset()
    useAccidents.getState().setExpMult(accidents.luckyExpMult) // 幸運加碼（自動）
    if (accidents.supply) setSupplyOpen(true) // 天降補給：開場前三選一
  }, [context.foeTeam, accidents])

  const pickSupply = (opt: SupplyOption) => {
    audio.play('super')
    if (opt.kind === 'sp') useSkillPoints.getState().add(3)
    else if (opt.kind === 'exp') useAccidents.getState().setExpMult(Math.max(accidents.luckyExpMult, 1.5))
    else if (opt.kind === 'capture') useAccidents.getState().setCaptureMult(1.3)
    setSupplyOpen(false)
  }

  const wild = foes[0] ?? null
  if (!wild) return null

  return (
    <div className="col" style={{ flex: 1 }}>
      <button className="btn btn--ghost" style={{ alignSelf: 'flex-start', padding: '10px 18px' }}
        onClick={() => send({ type: 'BACK' })}>
        ← 返回
      </button>

      <div className="center" style={{ flex: 1, gap: 18 }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.6, y: -40 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 12 }}
          style={{ width: 'min(60vw, 300px)', height: 'min(60vw, 300px)', position: 'relative' }}
        >
          <div className="platform" />
          <MobieSprite src={wild.artworkUrl} alt={wild.nameZh} shiny={wild.shiny} />
        </motion.div>

        <motion.div
          className="col center" style={{ gap: 8 }}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
        >
          <div className="eyebrow">對手帶著 {foes.length} 隻Mobie出現了！</div>
          {/* M11 野外意外旗標：稀有閃光 boss / 幸運加碼 */}
          {(bossShiny || accidents.luckyExpMult > 1) && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {bossShiny && <span className="accident-tag accident-tag--rare">✦ 稀有閃光 boss！</span>}
              {accidents.luckyExpMult > 1 && <span className="accident-tag">🍀 幸運加碼 · 經驗 ×{accidents.luckyExpMult}</span>}
            </div>
          )}
          <div className="h-title" style={{ fontSize: 36 }}>
            {wild.nameZh} <span className="hpbar__lv">Lv.{wild.level}</span>
          </div>
          <TypeBadges types={wild.types} />
          <IndividualInfo mon={wild} detailed />
          <button className="btn btn--ghost btn--sm" onClick={() => openCard(wild)}>ⓘ 查看資訊卡</button>
          {/* 對手隊伍縮圖（最後一隻為 boss）；點開資訊卡 */}
          <div className="row" style={{ gap: 10, marginTop: 6 }}>
            {foes.map((f, i) => (
              <button
                key={i}
                onClick={() => openCard(f)}
                style={{
                  width: 46, height: 46, borderRadius: 12, padding: 3,
                  border: `1px solid ${i === foes.length - 1 ? 'var(--accent)' : 'var(--stroke)'}`,
                  background: 'rgba(0,0,0,0.3)',
                }}
                title={i === foes.length - 1 ? `${f.nameZh}（boss）` : f.nameZh}
              >
                <img src={f.artworkUrl} alt={f.nameZh} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </button>
            ))}
          </div>
        </motion.div>
      </div>

      <motion.button
        className="btn" style={{ alignSelf: 'center', fontSize: 19, padding: '16px 44px' }}
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
        whileTap={{ scale: 0.96 }}
        onClick={engage}
      >
        ⚔ 出戰
      </motion.button>

      {/* M22.h 撥草 gate（純演出，撥開或逾時即出戰） */}
      <AnimatePresence>
        {grassGate && (
          <GestureGate
            title="🌿 撥開草叢"
            icon="🌿"
            hint="來回撥動，撥開草叢找出對手！"
            onComplete={() => { setGrassGate(false); send({ type: 'ENGAGE' }) }}
            onCancel={() => setGrassGate(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cardMon && <MobCard mon={cardMon} owner={false} revealed={false} onClose={() => setCardMon(null)} />}
      </AnimatePresence>

      {/* M11 天降補給：開場前三選一（絕不戰鬥中途，守單招心流） */}
      <AnimatePresence>
        {supplyOpen && accidents.supply && (
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              className="modal-card" style={{ maxWidth: 420 }}
              initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
            >
              <div className="h-title" style={{ fontSize: 22 }}>📦 天降補給</div>
              <div className="h-sub" style={{ marginBottom: 10 }}>野外發現補給箱！三選一帶進這場戰鬥。</div>
              <div className="col" style={{ gap: 8 }}>
                {accidents.supply.map((opt) => (
                  <button key={opt.kind} className="supply-opt" onClick={() => pickSupply(opt)}>
                    <span className="supply-opt__icon">{opt.icon}</span>
                    <span className="col" style={{ gap: 2, alignItems: 'flex-start' }}>
                      <b>{opt.label}</b>
                      <span className="h-sub" style={{ fontSize: 12 }}>{opt.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
