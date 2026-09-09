import { zipSync, strToU8 } from 'fflate'
import { putCards, listCards } from '@/game/cardLibrary'
import { loadMeta } from '@/game/save/saveMeta'
import { crc32Bytes } from '@/game/crc32'
import { useIncubator } from '@/store/incubatorStore'
import { useMeta } from '@/store/metaStore'
import { usePlayerSkills } from '@/store/playerSkillsStore'
import { useRoster } from '@/store/rosterStore'
import { useRun } from '@/store/runStore'
import { useSkillPoints } from '@/store/skillPointsStore'
import { useBattleStore } from '@/store/battleStore'
import type { GameEvent, Outcome } from '@/game/machine/gameMachine'
import type { BattleRuntimeError } from '@/store/battleStore'
import {
  M24_BASELINE_SCENARIO_ID,
  M24_BASELINE_SEED,
  M24_GAME_EVENT,
} from './contracts'

const BASELINE_CARD = { cardId: 'M24-BASELINE-25', speciesId: 25, level: 22, shiny: true } as const

export interface M24BaselineDriverOptions {
  scenarioId: typeof M24_BASELINE_SCENARIO_ID
  seed: string
  viewport: { width: number; height: number }
}

export interface M24SeedSnapshot {
  roster: number
  cards: number
  registeredSpecies: number
  seenSpecies: number
  eggs: number
  readyEggs: number
  skillPoints: number
  learnedPartnerSkills: string[]
  bestFloor: number
}

export interface M24BaselineDriver {
  readonly active: true
  options: M24BaselineDriverOptions
  configure: (options?: Partial<M24BaselineDriverOptions>) => M24BaselineDriverOptions
  ready: () => boolean
  seedContent: (options?: { learnedPartnerSkills?: string[] }) => Promise<M24SeedSnapshot>
  prepareArtworkFailure: () => void
  prepareBattleChoice: () => void
  prepareBattleError: () => void
  prepareRecordedWin: () => void
  makeOlderSave: () => Promise<number[]>
  makeMalformedLegacySave: () => Promise<number[]>
  endBattle: (outcome: Outcome) => void
  sendGameEvent: (event: GameEvent) => void
  snapshot: () => M24SeedSnapshot & { battle: boolean }
  dispose: () => void
}

declare global {
  interface Window {
    __MOBIE_M24_BASELINE__?: M24BaselineDriver
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function queryOptions(): Partial<M24BaselineDriverOptions> {
  const query = new URLSearchParams(window.location.search)
  if (query.get('m24Scenario') !== M24_BASELINE_SCENARIO_ID) return {}
  const width = Number(query.get('width'))
  const height = Number(query.get('height'))
  return {
    scenarioId: M24_BASELINE_SCENARIO_ID,
    ...(query.get('seed') ? { seed: query.get('seed')! } : {}),
    ...(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
      ? { viewport: { width, height } }
      : {}),
  }
}

function dispatchGameEvent(event: GameEvent): void {
  window.dispatchEvent(new CustomEvent<GameEvent>(M24_GAME_EVENT, { detail: event }))
}

export function installM24BaselineDriver(): M24BaselineDriver {
  window.__MOBIE_M24_BASELINE__?.dispose()

  let options: M24BaselineDriverOptions = {
    scenarioId: M24_BASELINE_SCENARIO_ID,
    seed: M24_BASELINE_SEED,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    ...queryOptions(),
  }
  let seeded = false
  let resultSerial = 0
  let cardCount = 0

  const storesReady = () => useRoster.getState().loaded && useMeta.getState().loaded && useIncubator.getState().loaded

  const snapshot = (): M24SeedSnapshot & { battle: boolean } => {
    const roster = useRoster.getState().roster
    const meta = useMeta.getState().meta
    const incubator = useIncubator.getState().state
    return {
      roster: roster.length,
      cards: cardCount,
      registeredSpecies: meta.registered.length,
      seenSpecies: meta.seen.length,
      eggs: incubator.eggs.length,
      readyEggs: incubator.eggs.filter((egg) => egg.progress >= egg.requiredProgress).length,
      skillPoints: useSkillPoints.getState().sp,
      learnedPartnerSkills: [...usePlayerSkills.getState().learnedSkillIds],
      bestFloor: useRun.getState().bestFloor,
      battle: Boolean(useBattleStore.getState().battle),
    }
  }

  const configure = (patch: Partial<M24BaselineDriverOptions> = {}): M24BaselineDriverOptions => {
    if (patch.scenarioId !== undefined && patch.scenarioId !== M24_BASELINE_SCENARIO_ID) {
      throw new Error(`Unknown M24 baseline scenario: ${patch.scenarioId}`)
    }
    const viewport = patch.viewport ?? options.viewport
    positiveInteger(viewport.width, 'viewport.width')
    positiveInteger(viewport.height, 'viewport.height')
    if (patch.seed !== undefined && !patch.seed.trim()) throw new Error('seed must not be empty')
    options = { ...options, ...patch, viewport: { ...viewport } }
    driver.options = { ...options, viewport: { ...options.viewport } }
    document.documentElement.dataset.m24Scenario = options.scenarioId
    document.documentElement.dataset.m24Seed = options.seed
    return { ...options, viewport: { ...options.viewport } }
  }

  const seedContent = async (seedOptions: { learnedPartnerSkills?: string[] } = {}): Promise<M24SeedSnapshot> => {
    if (seeded) return snapshot()
    if (!storesReady()) throw new Error('M24 stores are not loaded yet')

    // Keep the baseline grounded in the product's real default data. The extra card,
    // egg, meta progress, and growth are persisted through their real store/I/O APIs.
    cardCount = (await listCards()).length
    const roster = useRoster.getState().roster
    if (roster.length > 0) {
      await useRoster.getState().grantBattleExp(
        roster.slice(0, 3).map((unit) => unit.id),
        [12, 14, 16],
      )
      useRoster.getState().clearResults()
    }
    await putCards([BASELINE_CARD])
    cardCount += 1
    useMeta.getState().recordSeen([25, 500, 501, 502, 503, 66, 74, 92, 133])
    useMeta.getState().recordCapture(25, true)
    useMeta.getState().recordWin('wild')
    useMeta.getState().recordWin('arena')
    useSkillPoints.getState().add(12)
    // The default M24 baseline keeps its historical learned rally fixture. A
    // ticket-specific journey can request a clean locked account and exercise
    // the real unlock transaction through the modal instead.
    const learnedPartnerSkills = seedOptions.learnedPartnerSkills ?? ['rally']
    usePlayerSkills.setState({ learnedSkillIds: [], loaded: true, loadError: null })
    try { localStorage.removeItem('mobie.playerskills.v1') } catch { /* private mode */ }
    for (const skillId of learnedPartnerSkills) usePlayerSkills.getState().learn(skillId)
    useRun.getState().recordFloor(2)

    const incubator = useIncubator.getState()
    if (!incubator.state.eggs.some((egg) => egg.label === 'M24 基準蛋')) {
      incubator.addDuplicateEgg(4, 'M24 基準蛋')
      incubator.advance(8)
    }
    seeded = true
    return snapshot()
  }

  const prepareArtworkFailure = (): void => {
    const current = useBattleStore.getState()
    if (!current.battle) throw new Error('A live battle is required before preparing artwork failure')
    const battle = structuredClone(current.battle)
    const activeIndex = battle.player.activeIndex
    battle.player.members[activeIndex] = {
      ...battle.player.members[activeIndex],
      artworkUrl: '/__m24__/missing-artwork.png',
    }
    useBattleStore.setState({ battle })
  }

  const prepareBattleChoice = (): void => {
    if (!useBattleStore.getState().battle) throw new Error('A live battle is required before preparing player choice')
    // Renderer/intro timing is deliberately outside this non-battle baseline.
    // Release the real command deck through the existing store state so a slow
    // headless compositor cannot hide route/content evidence indefinitely.
    useBattleStore.setState({ phase: 'playerChoice', intentPresentation: null, battleError: null })
  }

  const prepareBattleError = (): void => {
    if (!useBattleStore.getState().battle) throw new Error('A live battle is required before preparing battle error')
    const error: BattleRuntimeError = {
      kind: 'resolve',
      message: '戰鬥處理發生錯誤，請重新開始本場戰鬥。',
      detail: 'M24 baseline controlled error state',
      requestId: 1,
    }
    useBattleStore.setState({ phase: 'error', battleError: error, presentation: null, intentPresentation: null })
  }

  const prepareRecordedWin = (): void => {
    const current = useBattleStore.getState()
    if (!current.battle) throw new Error('A live battle is required before preparing recorded win')
    const battle = structuredClone(current.battle)
    const activeIndex = battle.foe.activeIndex
    battle.foe.members = battle.foe.members.map((member, index) => index === activeIndex
      ? { ...member, maxHp: 1, currentHp: 1, def: 1 }
      : { ...member, currentHp: 0 })
    useBattleStore.setState({ battle, phase: 'playerChoice', intentPresentation: null, battleError: null })
  }

  const buildLegacySave = async (modelBytes: Uint8Array, checksumModelBytes = modelBytes): Promise<number[]> => {
    const cards = await listCards()
    const meta = { ...loadMeta(), updatedAt: 0, revision: 0 }
    const rosterBytes = strToU8(JSON.stringify(useRoster.getState().roster))
    const cardsBytes = strToU8(JSON.stringify(cards))
    const manifest = {
      schemaVersion: meta.schemaVersion,
      profileName: meta.profileName,
      updatedAt: meta.updatedAt,
      revision: meta.revision,
      includesModels: true,
      counts: { roster: useRoster.getState().roster.length, cards: cards.length, models: 1 },
      checksum: crc32Bytes([rosterBytes, cardsBytes, checksumModelBytes]),
    }
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'roster.json': rosterBytes,
      'cards.json': cardsBytes,
      'models/25.gltf': modelBytes,
    })
    return Array.from(bytes)
  }
  const makeOlderSave = () => buildLegacySave(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x22]))
  const makeMalformedLegacySave = () => {
    const validBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x22])
    return buildLegacySave(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x23]), validBytes)
  }

  const endBattle = (outcome: Outcome): void => {
    resultSerial += 1
    dispatchGameEvent({
      type: 'END_BATTLE',
      resultId: `${options.seed}:result:${resultSerial}`,
      resultFingerprint: `${options.seed}:fingerprint:${resultSerial}`,
      outcome,
    })
  }

  const driver: M24BaselineDriver = {
    active: true,
    options,
    configure,
    ready: storesReady,
    seedContent,
    prepareArtworkFailure,
    prepareBattleChoice,
    prepareBattleError,
    prepareRecordedWin,
    makeOlderSave,
    makeMalformedLegacySave,
    endBattle,
    sendGameEvent: dispatchGameEvent,
    snapshot,
    dispose: () => {
      if (window.__MOBIE_M24_BASELINE__ === driver) delete window.__MOBIE_M24_BASELINE__
    },
  }
  window.__MOBIE_M24_BASELINE__ = driver
  configure()
  return driver
}
