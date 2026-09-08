import { useEffect, useState } from 'react'
import { GameProvider, useGame } from '@/app/GameProvider'
import type { GameEvent } from '@/game/machine/gameMachine'
import { createActor } from 'xstate'
import { useSettings } from '@/store/settingsStore'
import { lookupRegion } from '@/game/data/regionLookup'
import { TitleScreen } from '@/ui/screens/TitleScreen'
import { RegionSelectScreen } from '@/ui/screens/RegionSelectScreen'
import { EncounterScreen } from '@/ui/screens/EncounterScreen'
import { CardSelectScreen } from '@/ui/screens/CardSelectScreen'
import { BattleScreen } from '@/ui/screens/BattleScreen'
import { ResultScreen } from '@/ui/screens/ResultScreen'
import { TowerSetupScreen } from '@/ui/screens/TowerSetupScreen'
import { endRegisteredBattleLifecycle } from '@/presentation/battle/battleLifecycleBridge'
import { M23_BASELINE_SCENARIO_ID } from '@/dev/m23/contracts'
import { M24_BASELINE_SCENARIO_ID, M24_GAME_EVENT } from '@/dev/m24/contracts'
import {
  BootstrapProvider,
  ensureBootstrap,
  useBootstrapCoordinator,
} from '@/app/bootstrapCoordinator'
import { AppShell, ScreenViewport } from '@/ui/shell/AppShell'
import { gameMachine } from '@/game/machine/gameMachine'

// The browser app owns one route actor outside React component lifetime so a
// root remount cannot send the player back to Title or create a second machine.
const appGameActor = createActor(gameMachine).start()

export function Stage() {
  const game = useGame()
  const { value, context, send } = game
  const graphicsPreference = useSettings((s) => s.settings.prefs.graphicsPreference)
  const [devBattleMounted, setDevBattleMounted] = useState(true)

  useEffect(() => {
    if (
      !import.meta.env.DEV
      || new URLSearchParams(window.location.search).get('m24Scenario') !== M24_BASELINE_SCENARIO_ID
    ) return
    const onGameEvent = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object' || typeof (detail as { type?: unknown }).type !== 'string') return
      if ((detail as { type: string }).type === 'END_BATTLE') endRegisteredBattleLifecycle('unmount')
      send(detail as GameEvent)
    }
    window.addEventListener(M24_GAME_EVENT, onGameEvent)
    return () => window.removeEventListener(M24_GAME_EVENT, onGameEvent)
  }, [send])

  useEffect(() => {
    if (
      !import.meta.env.DEV
      || new URLSearchParams(window.location.search).get('m23Scenario') !== M23_BASELINE_SCENARIO_ID
    ) return
    const unmount = () => {
      endRegisteredBattleLifecycle('unmount')
      setDevBattleMounted(false)
    }
    const remount = () => setDevBattleMounted(true)
    window.addEventListener('mobie:m23-unmount-battle', unmount)
    window.addEventListener('mobie:m23-remount-battle', remount)
    return () => {
      window.removeEventListener('mobie:m23-unmount-battle', unmount)
      window.removeEventListener('mobie:m23-remount-battle', remount)
    }
  }, [])

  // 依區域主題化背景
  const region = context.regionId ? lookupRegion(context.regionId) : null
  const themed = ['encounter', 'cardSelect', 'battle', 'result'].includes(value) && region
  const bg = themed
    ? `radial-gradient(120% 100% at 50% 0%, ${region.gradient[0]} 0%, ${region.gradient[1]} 55%, #060a1c 100%)`
    : 'radial-gradient(120% 100% at 50% 0%, #1a2150 0%, #0b1026 60%, #060a1c 100%)'

  return (
    <AppShell background={bg} route={value}>
      {/* Keep transitions local: scaling this full-screen layer forces gradients, blur and WebGL to re-rasterize together. */}
      <ScreenViewport>
        {value === 'title' && <TitleScreen />}
        {value === 'regionSelect' && <RegionSelectScreen />}
        {value === 'towerSetup' && <TowerSetupScreen />}
        {value === 'encounter' && <EncounterScreen />}
        {value === 'cardSelect' && <CardSelectScreen />}
        {value === 'battle' && devBattleMounted && <BattleScreen graphicsPreference={graphicsPreference} />}
        {value === 'result' && <ResultScreen />}
      </ScreenViewport>
    </AppShell>
  )
}

export function App() {
  const bootstrap = useBootstrapCoordinator()

  useEffect(() => {
    void ensureBootstrap()
  }, [])

  return (
    <BootstrapProvider snapshot={bootstrap.snapshot}>
      <GameProvider actor={appGameActor}>
        <Stage />
      </GameProvider>
    </BootstrapProvider>
  )
}
