import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('Ticket 06 production truth edges', () => {
  it('keeps module toggles, encounter styles, Scanner, and custom models out of reachable owners', () => {
    const settings = source('../../store/settingsStore.ts') + source('../../ui/components/SettingsModal.tsx')
    const encounter = source('../../ui/screens/EncounterScreen.tsx')
      + source('../../ui/screens/BattleScreen.tsx')
      + source('../../ui/components/MobCard.tsx')
    const tools = source('../../ui/components/ToolsMenu.tsx')
    const combatant = source('../../scene/r3f/MobieVisual.tsx')

    expect(settings).not.toMatch(/settings\.modules|setModuleEnabled|MODULE_IDS/)
    expect(encounter).not.toMatch(/encounterProfile|encounterTags|encounterSkills/)
    expect(tools).not.toMatch(/CardScannerModal|open\('scan'\)|掃卡/)
    expect(combatant).not.toMatch(/GLTFLoader|useModelUrl|modelStore|\.glb|\.gltf/)
  })
})
