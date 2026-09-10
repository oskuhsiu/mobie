// M10 — 孵化 store（mobie.incubator.v1）。獨立 slice；孵化才產 canonical OwnedUnit（一次性、決定論）。
// 來源：成就領取（addRewardEgg）/ 重複捕獲轉化（addDuplicateEgg）。Tower 不產蛋；舊 tower source 只為相容讀取。
// 進度：每場戰鬥推進（advance）。孵化＝移蛋 + 入 roster + 登錄圖鑑。

import { create } from 'zustand'
import {
  loadIncubator, loadIncubatorStrict, saveIncubatorState, defaultIncubator,
  saveIncubatorStateWithHatchOutboxStrict,
  addEgg, advanceAll, isHatchable,
  type IncubatorState,
} from '@/game/incubator'
import type { AchievementReward } from '@/game/achievements'
import { useRoster } from '@/store/rosterStore'
import { useMeta } from '@/store/metaStore'
import { bumpSaveMeta } from '@/game/save/saveMeta'
import { loadMetaStrict, saveMetaStateStrict, saveMetaStateWithHatchMarkersStrict } from '@/game/meta'
import {
  HatchCoordinator,
  HatchMetaDestination,
  HatchRosterDestination,
  LocalStorageHatchIncubatorPersistence,
  LocalStorageHatchMetaPersistence,
  LocalStorageHatchRosterPersistence,
  type HatchReceipt,
  type HatchRecovery,
} from '@/game/incubatorHatch'

interface IncubatorStore {
  state: IncubatorState
  loaded: boolean
  loadError: string | null
  hatchBusy: string | null
  hatchErrors: Record<string, string>
  lastHatch: HatchReceipt | null
  load: () => void
  /** Cold boot variant: storage errors propagate to the bootstrap coordinator for Retry. */
  loadStrict: () => void
  /** 成就獎勵 → 蛋（plan/10 §3.3 發獎 action 的副作用入口）。 */
  addRewardEgg: (reward: AchievementReward) => void
  /** 重複捕獲轉化（overflow policy）→ 同種蛋；絕不刪既有個體（plan/10 §5.3.1）。
   *  inheritedMoveId（M12.c）＝父母傳的蛋招，孵化時若該種族可學才生效。 */
  addDuplicateEgg: (speciesId: number, label?: string, inheritedMoveId?: number) => void
  /** 每場有效戰鬥完成 → 推進所有蛋的孵化進度。 */
  advance: (amount: number) => void
  /** Compatibility projection: return only the canonical unit after a hatch. */
  hatch: (eggId: string) => Promise<import('@/game/types').OwnedUnit | null>
  /** Detailed Ticket 41 receipt used by the reveal and reconciliation evidence. */
  hatchWithReceipt: (eggId: string) => Promise<HatchReceipt | null>
  /** Reload/remount recovery for pending hatch outboxes. */
  reconcileHatches: () => Promise<HatchRecovery>
}

export const useIncubator = create<IncubatorStore>((set, get) => {
  const persist = (state: IncubatorState) => { saveIncubatorState(state); set({ state }) }
  const persistHatchState = (state: IncubatorState) => set({ state })
  const hatchCoordinator = new HatchCoordinator({
    incubator: new LocalStorageHatchIncubatorPersistence({
      loadState: loadIncubatorStrict,
      saveStateWithHatchOutbox: (state) => {
        // The canonical incubator write owns the outbox/egg boundary. The
        // live Zustand projection is updated only after that write succeeds.
        saveIncubatorStateWithHatchOutboxStrict(state)
        persistHatchState(state)
      },
    }),
    roster: new HatchRosterDestination(new LocalStorageHatchRosterPersistence(
      undefined,
      undefined,
      (roster) => { useRoster.setState({ roster }) },
    )),
    meta: new HatchMetaDestination(new LocalStorageHatchMetaPersistence(
      {
        loadMeta: loadMetaStrict,
        saveMeta: saveMetaStateStrict,
        saveMetaWithHatchMarkers: saveMetaStateWithHatchMarkersStrict,
      },
      undefined,
      (meta) => { useMeta.setState({ meta }) },
    )),
  })
  const hydrate = (load: () => IncubatorState): void => {
    set({ loaded: false, loadError: null })
    try {
      set({ state: load(), loaded: true, loadError: null })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      set({ loaded: false, loadError: message })
      throw cause
    }
  }
  return {
    state: defaultIncubator(),
    loaded: false,
    loadError: null,
    hatchBusy: null,
    hatchErrors: {},
    lastHatch: null,

    load: () => hydrate(loadIncubator),

    loadStrict: () => hydrate(loadIncubatorStrict),

    addRewardEgg: (reward) => {
      if (reward.kind !== 'egg') return
      persist(addEgg(get().state, { source: 'achievement', speciesPool: reward.speciesPool, label: reward.label }))
    },

    addDuplicateEgg: (speciesId, label = '重複轉化蛋', inheritedMoveId) => {
      persist(addEgg(get().state, { source: 'duplicate', speciesPool: [speciesId], label, inheritedMoveId }))
    },

    advance: (amount) => {
      const next = advanceAll(get().state, amount)
      if (next !== get().state) persist(next)
    },

    hatchWithReceipt: async (eggId) => {
      const egg = get().state.eggs.find((candidate) => candidate.id === eggId)
      const settled = get().state.hatchOutbox?.find((entry) => entry.eggId === eggId && entry.status === 'settled')
      const pending = get().state.hatchOutbox?.find((entry) => entry.eggId === eggId && entry.status === 'pending')
      if (!egg && !settled && !pending) return null
      if (egg && !isHatchable(egg) && !pending) return null
      set({ hatchBusy: eggId, hatchErrors: { ...get().hatchErrors, [eggId]: '' } })
      try {
        const receipt = await hatchCoordinator.hatchOnce(eggId)
        const nextErrors = { ...get().hatchErrors }
        delete nextErrors[eggId]
        set({ lastHatch: receipt, hatchErrors: nextErrors })
        if (receipt.status === 'applied') bumpSaveMeta(receipt.appliedAt)
        return receipt
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        set({ hatchErrors: { ...get().hatchErrors, [eggId]: message } })
        throw cause
      } finally {
        set({ hatchBusy: null })
      }
    },

    hatch: async (eggId) => (await get().hatchWithReceipt(eggId))?.unit ?? null,

    reconcileHatches: async () => {
      const recovery = await hatchCoordinator.recoverPending()
      const nextErrors = { ...get().hatchErrors }
      for (const error of recovery.errors) nextErrors[error.eggId] = error.message
      if (recovery.errors.length === 0) delete nextErrors['*']
      if (recovery.receipts.length > 0) {
        const latest = recovery.receipts.at(-1)!
        set({ lastHatch: latest })
        for (const receipt of recovery.receipts) delete nextErrors[receipt.eggId]
      }
      set({ hatchErrors: nextErrors })
      for (const receipt of recovery.receipts) if (receipt.status === 'applied') bumpSaveMeta(receipt.appliedAt)
      return recovery
    },
  }
})
