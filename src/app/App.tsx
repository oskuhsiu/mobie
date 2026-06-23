import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GameProvider, useGame } from '@/app/GameProvider'
import { useRoster } from '@/store/rosterStore'
import { useMeta } from '@/store/metaStore'
import { useIncubator } from '@/store/incubatorStore'
import { lookupRegion } from '@/game/data/regionLookup'
import { TitleScreen } from '@/ui/screens/TitleScreen'
import { RegionSelectScreen } from '@/ui/screens/RegionSelectScreen'
import { EncounterScreen } from '@/ui/screens/EncounterScreen'
import { CardSelectScreen } from '@/ui/screens/CardSelectScreen'
import { BattleScreen } from '@/ui/screens/BattleScreen'
import { ResultScreen } from '@/ui/screens/ResultScreen'

const fade = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 1.02 },
  transition: { duration: 0.3, ease: 'easeOut' as const },
}

function Stage() {
  const game = useGame()
  const { value, context } = game

  // 依區域主題化背景
  const region = context.regionId ? lookupRegion(context.regionId) : null
  const themed = ['encounter', 'cardSelect', 'battle', 'result'].includes(value) && region
  const bg = themed
    ? `radial-gradient(120% 100% at 50% 0%, ${region.gradient[0]} 0%, ${region.gradient[1]} 55%, #060a1c 100%)`
    : 'radial-gradient(120% 100% at 50% 0%, #1a2150 0%, #0b1026 60%, #060a1c 100%)'

  return (
    <div className="app" style={{ background: bg, transition: 'background 0.6s ease' }}>
      <AnimatePresence mode="wait">
        <motion.div key={value} className="screen" {...fade}>
          {value === 'title' && <TitleScreen />}
          {value === 'regionSelect' && <RegionSelectScreen />}
          {value === 'encounter' && <EncounterScreen />}
          {value === 'cardSelect' && <CardSelectScreen />}
          {value === 'battle' && <BattleScreen />}
          {value === 'result' && <ResultScreen />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export function App() {
  // 開場載入持久化 roster（localStorage；空則 seed 預設並存檔），再用 roster 回填圖鑑 meta + 載入孵化所
  useEffect(() => {
    void useRoster.getState().load().then(() => useMeta.getState().load(useRoster.getState().roster))
    useIncubator.getState().load()
  }, [])
  return (
    <GameProvider>
      <Stage />
    </GameProvider>
  )
}
