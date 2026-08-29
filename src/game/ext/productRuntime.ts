import type { BattleMobie, OwnedUnit } from '@/game/types'
import type {
  BuildUnitHook,
  ChainRules,
  ExtBundle,
  ExtensionId,
  ExtensionModule,
  NamedModifier,
  PostGrowthHook,
  PreBattleHook,
} from './seams'
import type { ComboRules } from './combo'
import { SYNERGY_MODULE } from './synergy'
import { HELD_ITEMS_MODULE } from './items'
import { ABILITIES_MODULE } from './abilities'
import { CHAIN_MODULE } from './chain'
import { COMBO_MODULE } from './combo'
import { EVOLUTION_MODULE } from './evolution'

interface BattlePrep {
  buildUnitHooks: BuildUnitHook[]
  preBattleHooks: PreBattleHook[]
}

type ProductTurnExtensions = ExtBundle & {
  chain: ChainRules
  combo: ComboRules
}

const FIXED_EXTENSIONS: Readonly<Record<ExtensionId, ExtensionModule>> = {
  synergy: SYNERGY_MODULE,
  heldItems: HELD_ITEMS_MODULE,
  abilities: ABILITIES_MODULE,
  chain: CHAIN_MODULE,
  combo: COMBO_MODULE,
  evolution: EVOLUTION_MODULE,
}

function assembleProductRuntime() {
  const prep: BattlePrep = { buildUnitHooks: [], preBattleHooks: [] }
  const turnExtensions: ExtBundle = { damageHooks: [], turnEndTriggers: [] }
  const postGrowthHooks: PostGrowthHook[] = []

  for (const id of Object.keys(FIXED_EXTENSIONS) as ExtensionId[]) {
    const extension = FIXED_EXTENSIONS[id]
    if (extension.id !== id) throw new Error(`Fixed extension identity mismatch: ${id}`)
    const seams = extension.seams
    if (seams.buildUnit) prep.buildUnitHooks.push(seams.buildUnit)
    if (seams.preBattleModifiers) prep.preBattleHooks.push(seams.preBattleModifiers)
    if (seams.damageHook) turnExtensions.damageHooks.push(seams.damageHook)
    if (seams.turnEndTrigger) turnExtensions.turnEndTriggers.push(seams.turnEndTrigger)
    if (seams.chainResolve) turnExtensions.chain = seams.chainResolve
    if (seams.combo) turnExtensions.combo = seams.combo
    if (seams.postGrowth) postGrowthHooks.push(seams.postGrowth)
  }

  if (!turnExtensions.chain || !turnExtensions.combo || postGrowthHooks.length === 0) {
    throw new Error('Fixed battle product runtime is incomplete')
  }

  return {
    prep,
    turnExtensions: turnExtensions as ProductTurnExtensions,
    postGrowthHooks,
  }
}

function prepareTeam(
  team: readonly BattleMobie[],
  prep: BattlePrep,
  withSynergy: boolean,
): { team: BattleMobie[]; modifiers: NamedModifier[] } {
  let prepared = team.map((unit) => prep.buildUnitHooks.reduce((current, hook) => hook(current), unit))
  const modifiers = withSynergy
    ? prep.preBattleHooks.flatMap((hook) => hook(prepared))
    : []
  if (modifiers.length > 0) {
    prepared = prepared.map((unit) => modifiers.reduce(
      (current, modifier) => modifier.apply?.(current) ?? current,
      unit,
    ))
  }
  return { team: prepared, modifiers }
}

const assembled = assembleProductRuntime()

/** The only production authority for fixed battle capabilities. */
export const PRODUCT_RUNTIME = {
  turnExtensions: assembled.turnExtensions,

  prepareBattleTeams(player: readonly BattleMobie[], foe: readonly BattleMobie[]) {
    const preparedPlayer = prepareTeam(player, assembled.prep, true)
    const preparedFoe = prepareTeam(foe, assembled.prep, false)
    return {
      playerTeam: preparedPlayer.team,
      foeTeam: preparedFoe.team,
      playerModifiers: preparedPlayer.modifiers,
    }
  },

  previewPlayerSynergy(team: readonly BattleMobie[]): NamedModifier[] {
    return prepareTeam(team, assembled.prep, true).modifiers
  },

  applyPostGrowth(unit: OwnedUnit): OwnedUnit {
    return assembled.postGrowthHooks.reduce((current, hook) => hook(current), unit)
  },
} as const
