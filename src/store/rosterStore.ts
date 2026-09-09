import { create } from 'zustand'
import type { Card, OwnedUnit } from '@/game/types'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { getSpecies } from '@/game/data/species'
import { createOwnedUnit, type ExpResult } from '@/game/growth'
import { effectiveLearnedMoves, MOVE_SLOT_CAP } from '@/game/learnset'
import { MOVES } from '@/game/data/moves'
import { sanitizeRoster } from '@/game/rosterSanitize'
import { LocalStorageAdapter, type PersistenceAdapter } from '@/game/persistence'
import { bumpSaveMeta } from '@/game/save/saveMeta'
import { loadMetaStrict, saveMetaStateStrict, saveMetaStateWithSettlementMarkersStrict } from '@/game/meta'
import { useMeta } from '@/store/metaStore'
import {
  loadSkillPointsStrict,
  saveSkillPointsStrict,
  saveSkillPointsWithSettlementMarkersStrict,
  useSkillPoints,
} from '@/store/skillPointsStore'
import {
  calculateRosterGrowth,
  LocalStorageRosterGrowthPersistence,
  LocalStorageSkillPointsPersistence,
  LocalStorageMetaSettlementPersistence,
  LocalStorageSettlementJournal,
  MetaSettlementDestination,
  ResultSettlementCoordinator,
  RosterGrowthDestination,
  SkillPointsDestination,
  type ResultIdentity,
  type ResultSettlementPayload,
  type ResultSettlementReceipt,
} from '@/game/resultSettlement'

/** 一隻於本場戰後升級新領悟的招（M19.e，給結算「學會新招」提示）。 */
export interface MoveLearnEvent {
  unitId: string
  moveIds: number[]
}

/** 一隻於本場戰後進化（S6 postGrowth）的紀錄，給結算畫面演出。 */
export interface EvolutionEvent {
  unitId: string
  fromSpecies: number
  toSpecies: number
  atLevel: number
}

const adapter: PersistenceAdapter = new LocalStorageAdapter()

/** 預設 roster：由本地假卡 seed（id = cardId，與持久化一致） */
function defaultRoster(): OwnedUnit[] {
  return PLAYER_CARDS.map((c) => createOwnedUnit(c.cardId, c.speciesId, c.level, c))
}

interface RosterState {
  roster: OwnedUnit[]
  loaded: boolean
  /** 最近一場戰鬥的每隻成長結果（給結算畫面顯示） */
  lastResults: ExpResult[]
  /** 最近一場戰後進化（S6，給結算畫面演出），空＝無進化 */
  lastEvolutions: EvolutionEvent[]
  /** 最近一場升級新領悟的招（M19.e，給結算「學會新招」提示），空＝無 */
  lastMoveLearns: MoveLearnEvent[]
  /** 最近一場勝利新收服的Mobie（給結算畫面顯示），null=沒收服 */
  lastCaptured: OwnedUnit | null
  load: () => Promise<void>
  loadStrict: () => Promise<void>
  /**
   * 戰鬥結算：給參戰的 unitIds 依被擊敗隊伍等級加經驗、升級、存檔。
   * ratio 用來區分勝（1.0 全額）與敗（部分，例如 0.15）。
   * Fixed post-growth product rules run after level-up and record any evolution.
   */
  grantBattleExp: (unitIds: string[], foeLevels: number[], ratio?: number, identity?: ResultIdentity) => Promise<ExpResult[]>
  /** Result-owned roster growth/evolution destination. The identity is stable across remounts. */
  settleBattleResult: (identity: ResultIdentity, payload: ResultSettlementPayload) => Promise<ResultSettlementReceipt>
  /** Mark a Result as left so its durable marker becomes eligible for bounded retention. */
  markBattleResultLeft: (identity: ResultIdentity) => Promise<void>
  /** 收服一隻（由捕獲卡建 canonical OwnedUnit，加入並存檔；個體與戰鬥畫面一致） */
  captureUnit: (card: Card) => Promise<OwnedUnit | null>
  /** 直接加入一隻已建好的 canonical OwnedUnit（孵化用，id 去重）並存檔。 */
  addUnit: (unit: OwnedUnit) => Promise<OwnedUnit | null>
  /** 裝備/卸下持有道具（itemId=undefined 卸下），回傳原本裝備的 itemId（給背包對帳）；存檔。 */
  setHeldItem: (unitId: string, itemId: string | undefined) => Promise<string | undefined>
  /** M19.e 訓練所學招：把 moveId 併入該單位 canonical learnedMoveIds（物化完整已學集）；存檔。回 true=新學會。 */
  learnMove: (unitId: string, moveId: number) => Promise<boolean>
  /** M19.e 調整出戰 loadout：設 equippedMoveIds（過濾⊆已學∪slot0、截≤4、保證非空）；存檔。 */
  setEquippedMoves: (unitId: string, moveIds: number[]) => Promise<void>
  /** 匯入存檔：整批取代 roster（已 sanitize），存檔。meta 由匯入流程的 adoptMeta 設定，故此處不 bump。 */
  replaceAll: (units: OwnedUnit[]) => Promise<void>
  clearResults: () => void
}

export const useRoster = create<RosterState>((set, get) => {
  // The destination and coordinator live at store scope, outside React. A
  // Result remount therefore shares the same queue and durable markers.
  const strictSaveRoster = adapter.saveRosterStrict?.bind(adapter) ?? adapter.saveRoster.bind(adapter)
  const growthPersistence = new LocalStorageRosterGrowthPersistence({
    loadRoster: async () => {
      // Read the durable canonical roster for recovery. The in-memory
      // fallback keeps isolated UI tests and pre-bootstrap compatibility
      // callers useful when no persisted roster exists yet.
      const persisted = await adapter.loadRoster()
      return (persisted.length > 0 ? persisted : get().roster).map((unit) => ({ ...unit }))
    },
    saveRoster: strictSaveRoster,
  })
  const growthDestination = new RosterGrowthDestination(growthPersistence)
  const skillPointsPersistence = new LocalStorageSkillPointsPersistence({
    loadPoints: loadSkillPointsStrict,
    savePoints: async (points) => {
      saveSkillPointsStrict(points)
      // Keep the live wallet projection in sync after the canonical write;
      // the destination, not this projection, remains the exactly-once owner.
      useSkillPoints.setState({ sp: points })
    },
    savePointsWithMarkers: async (points, markers) => {
      saveSkillPointsWithSettlementMarkersStrict(points, markers)
      useSkillPoints.setState({ sp: points })
    },
  })
  const metaPersistence = new LocalStorageMetaSettlementPersistence({
    loadMeta: loadMetaStrict,
    saveMeta: async (meta) => {
      saveMetaStateStrict(meta)
      // Meta's canonical localStorage write is the authority. This update only
      // hydrates the existing Zustand projection for the current screen.
      useMeta.setState({ meta })
    },
    saveMetaWithMarkers: async (meta, markers) => {
      saveMetaStateWithSettlementMarkersStrict(meta, markers)
      useMeta.setState({ meta })
    },
  })
  const skillPointsDestination = new SkillPointsDestination(skillPointsPersistence)
  const metaDestination = new MetaSettlementDestination(metaPersistence)
  const settlementCoordinator = new ResultSettlementCoordinator(
    growthDestination,
    new LocalStorageSettlementJournal(),
    () => Date.now(),
    { skillPoints: skillPointsDestination, meta: metaDestination },
  )

  const publishGrowthReceipt = async (receipt: ResultSettlementReceipt): Promise<void> => {
    // Rehydrate from the canonical persistence boundary before publishing a
    // replayed receipt. Never replace live units with historical receipt
    // snapshots after a later item/move/growth edit.
    const persisted = await adapter.loadRoster()
    const roster = persisted.length > 0 ? persisted : get().roster
    set({
      roster,
      lastResults: receipt.results,
      lastEvolutions: receipt.evolutions,
      lastMoveLearns: receipt.moveLearns,
    })
  }

  const settleBattleResult = async (
    identity: ResultIdentity,
    payload: ResultSettlementPayload,
  ): Promise<ResultSettlementReceipt> => {
    const receipt = await settlementCoordinator.settle(identity, payload)
    await publishGrowthReceipt(receipt)
    // Only the first canonical apply bumps save metadata. A retry/re-mount
    // receives `already-applied` and must not manufacture a new save revision.
    if (receipt.status === 'applied') bumpSaveMeta(receipt.appliedAt)
    return receipt
  }

  const hydrateRoster = async (
    loadRoster: () => Promise<OwnedUnit[]>,
    saveRoster: (units: OwnedUnit[]) => Promise<void>,
    rejectCorruptPayload = false,
  ): Promise<void> => {
    set({ loaded: false })
    const saved = await loadRoster()
    // 載入邊界防護：丟棄壞項 / 夾合法範圍，擋「壞檔讓遊戲開不起來」的死迴圈
    const clean = sanitizeRoster(saved)
    if (clean.length === 0) {
      if (rejectCorruptPayload && saved.length > 0) throw new Error('讀取 Mobie 資料失敗：沒有可用的 canonical roster')
      const seeded = defaultRoster()
      await saveRoster(seeded)
      set({ roster: seeded, loaded: true })
    } else {
      if (clean.length !== saved.length) await saveRoster(clean) // 有丟棄壞項 → 修檔回寫
      set({ roster: clean, loaded: true })
    }
  }

  return {
    roster: defaultRoster(),
    loaded: false,
    lastResults: [],
    lastEvolutions: [],
    lastMoveLearns: [],
    lastCaptured: null,

    load: () => hydrateRoster(adapter.loadRoster.bind(adapter), adapter.saveRoster.bind(adapter)),
    loadStrict: () => hydrateRoster(
      adapter.loadRosterStrict?.bind(adapter) ?? adapter.loadRoster.bind(adapter),
      adapter.saveRosterStrict?.bind(adapter) ?? adapter.saveRoster.bind(adapter),
      true,
    ),

  grantBattleExp: async (unitIds, foeLevels, ratio = 1, identity) => {
    if (identity) {
      const receipt = await settleBattleResult(identity, { unitIds, foeLevels, ratio })
      return receipt.results
    }
    // Compatibility path for non-Result setup tools (for example the M24
    // baseline seeder). ResultScreen always supplies the stable identity and
    // therefore goes through the destination above.
    const calculated = calculateRosterGrowth(get().roster, { unitIds, foeLevels, ratio })
    const { results, evolutions, moveLearns, roster } = calculated
    set({ roster, lastResults: results, lastEvolutions: evolutions, lastMoveLearns: moveLearns })
    await adapter.saveRoster(roster)
    bumpSaveMeta(Date.now()) // 進度推進 → 存檔變新（供匯出/匯入新舊判斷）
    return results
  },

  settleBattleResult,

  markBattleResultLeft: (identity) => settlementCoordinator.markResultLeft(identity),

  captureUnit: async (card) => {
    // seed = cardId，與 buildBattleMobie 對野生卡的決定論個體一致 → 收服後個體不變
    // card 顯式給的 ivs/nature/shiny（自製/掃描卡）會覆寫 seed roll
    const unit = createOwnedUnit(card.cardId, card.speciesId, card.level, card)
    // 去重：同 id（同一次遭遇）不重複加入
    if (get().roster.some((u) => u.id === unit.id)) {
      set({ lastCaptured: null })
      return null
    }
    const roster = [...get().roster, unit]
    set({ roster, lastCaptured: unit })
    await adapter.saveRoster(roster)
    bumpSaveMeta(Date.now()) // 收服 → 存檔變新
    return unit
  },

  addUnit: async (unit) => {
    if (get().roster.some((u) => u.id === unit.id)) return null // id 去重（同一顆蛋不重複孵）
    const roster = [...get().roster, unit]
    set({ roster })
    await adapter.saveRoster(roster)
    bumpSaveMeta(Date.now())
    return unit
  },

  setHeldItem: async (unitId, itemId) => {
    let prev: string | undefined
    const roster = get().roster.map((u) => {
      if (u.id !== unitId) return u
      prev = u.heldItemId
      if (itemId) return { ...u, heldItemId: itemId }
      const { heldItemId: _drop, ...rest } = u // 卸下：移除欄位（保持 canonical 乾淨）
      return rest
    })
    set({ roster })
    await adapter.saveRoster(roster)
    bumpSaveMeta(Date.now())
    return prev
  },

  learnMove: async (unitId, moveId) => {
    if (!MOVES[moveId]) return false
    let learnedNew = false
    const roster = get().roster.map((u) => {
      if (u.id !== unitId) return u
      const species = getSpecies(u.speciesId)
      const current = effectiveLearnedMoves(u, species) // 物化完整已學集（含等級領悟）
      if (current.includes(moveId)) return u // 已會＝no-op
      learnedNew = true
      return { ...u, learnedMoveIds: [...new Set([...current, moveId])] }
    })
    if (!learnedNew) return false
    set({ roster })
    await adapter.saveRoster(roster)
    bumpSaveMeta(Date.now())
    return true
  },

  setEquippedMoves: async (unitId, moveIds) => {
    const roster = get().roster.map((u) => {
      if (u.id !== unitId) return u
      const species = getSpecies(u.speciesId)
      const allow = new Set<number>([...effectiveLearnedMoves(u, species), species.moveId])
      const equipped = [...new Set(moveIds.filter((id) => allow.has(id) && MOVES[id]))].slice(0, MOVE_SLOT_CAP)
      const finalEquipped = equipped.length > 0 ? equipped : [species.moveId] // 保證非空（至少 slot0）
      return { ...u, equippedMoveIds: finalEquipped }
    })
    set({ roster })
    await adapter.saveRoster(roster)
    bumpSaveMeta(Date.now())
  },

  replaceAll: async (units) => {
    const clean = sanitizeRoster(units)
    set({ roster: clean, lastResults: [], lastEvolutions: [], lastMoveLearns: [], lastCaptured: null })
    await adapter.saveRoster(clean)
  },

  clearResults: () => set({ lastResults: [], lastEvolutions: [], lastMoveLearns: [], lastCaptured: null }),
  }
})
