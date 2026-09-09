import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('production truth edges', () => {
  it('keeps fixed module toggles and encounter styles out while gating Scanner behind Settings v2', () => {
    const settings = source('../../store/settingsStore.ts') + source('../../ui/components/SettingsModal.tsx')
    const encounter = source('../../ui/screens/EncounterScreen.tsx')
      + source('../../ui/screens/BattleScreen.tsx')
      + source('../../ui/components/MobCard.tsx')
    const tools = source('../../ui/components/ToolsMenu.tsx')
    const combatant = source('../../scene/r3f/MobieVisual.tsx')

    expect(settings).not.toMatch(/settings\.modules|setModuleEnabled|MODULE_IDS/)
    expect(encounter).not.toMatch(/encounterProfile|encounterTags|encounterSkills/)
    expect(tools).toContain("import('@/ui/components/CardScannerModal')")
    expect(tools).toContain('scannerEnabled')
    expect(tools).toContain("open('scanner'")
    expect(combatant).not.toMatch(/GLTFLoader|useModelUrl|modelStore|\.glb|\.gltf/)
  })

  it('keeps the battle host, boot gate, and compatibility graph Three-free', () => {
    const battleScreen = source('../../ui/screens/BattleScreen.tsx')
    const host = source('../../scene/battle/host/BattleSceneHost.tsx')
    const probe = source('../../scene/battle/host/capabilityProbe.ts')
    const compatibility = source('../../scene/battle/compat/CompatibilityBattleScene.tsx')
    const gate = source('../../ui/battle/BattleRenderGate.tsx')
    const rendererCss = source('../../ui/styles/battleRenderer.css')
    const nextEntry = source('../../scene/battle/next/NextBattleScene.tsx')

    for (const owner of [host, probe, compatibility, gate]) {
      expect(owner).not.toMatch(/from ['"](?:three|@react-three)|import\(['"](?:three|@react-three)/)
    }
    expect(battleScreen).toContain("from '@/scene/battle/host/BattleSceneHost'")
    expect(battleScreen).not.toMatch(/import\(['"]@\/scene\/r3f\/BattleStage/)
    expect(nextEntry).toContain("from '@/scene/r3f/BattleStage'")
    expect(compatibility).toContain('data-renderer-paused')
    expect(rendererCss).toMatch(/data-renderer-paused=.*animation-play-state:\s*paused/s)
  })
})
