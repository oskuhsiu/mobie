// M10 — 圖鑑/成就 meta store（mobie.meta.v1）。在 canonical 事件點（看到/收服/勝利/進化）更新 meta，
// 獨立 store、**不寫 roster**（plan/10 §3.2）。claim 走 durable outbox 與明確 action。

import { create } from 'zustand'
import type { OwnedUnit } from '@/game/types'
import {
  loadMeta,
  saveMetaState,
  defaultMeta,
  addRegistered,
  addSeen,
  bumpStat,
  currentlyOwnedSpecies,
  loadMetaStrict,
  saveMetaStateStrict,
  type MetaState,
} from '@/game/meta'
import {
  AchievementClaimCoordinator,
  AchievementClaimError,
  AchievementEggDestination,
  AchievementSpDestination,
  ACHIEVEMENT_CLAIM_EGG_MIRROR_KEY,
  ACHIEVEMENT_CLAIM_META_MIRROR_KEY,
  ACHIEVEMENT_CLAIM_SP_MIRROR_KEY,
  type AchievementClaimResult,
} from '@/game/achievementClaim'
import {
  loadIncubatorStrict,
  saveIncubatorStateWithAchievementClaimsStrict,
} from '@/game/incubator'
import { useIncubator } from '@/store/incubatorStore'
import {
  loadSkillPointAchievementClaimsStrict,
  loadSkillPointsStrict,
  saveSkillPointsWithAchievementClaimsStrict,
  useSkillPoints,
} from '@/store/skillPointsStore'

interface MetaStore {
  meta: MetaState
  loaded: boolean
  /** 載入 meta，並用當前 roster 回填 registered（起始隊伍/既有收藏計入「已捕」）。 */
  load: (roster: OwnedUnit[]) => void
  /** Cold boot variant: storage errors propagate to the bootstrap coordinator for Retry. */
  loadStrict: (roster: OwnedUnit[]) => void
  /** 遭遇/看到一批物種（未登錄者記為 seen）。 */
  recordSeen: (speciesIds: number[]) => void
  /** 收服一隻：registered + captures(+shiny)。 */
  recordCapture: (speciesId: number, shiny: boolean) => void
  /** 勝利：依 mode 累加 wins / arenaWins。 */
  recordWin: (mode: 'arena' | 'wild') => void
  /** 進化：登錄進化後物種 + evolutions 計數。 */
  recordEvolutions: (events: { toSpecies: number }[]) => void
  /** 領取成就獎勵（durable outbox + per-boundary applyOnce）。 */
  claimAchievement: (id: string) => Promise<AchievementClaimResult | null>
  /** Reload/remount recovery for pending claim outboxes. */
  reconcileAchievementClaims: () => Promise<{ attempted: number; completed: number; errors: Array<{ achievementId: string; message: string; code?: string }> }>
  claimBusy: string | null
  claimErrors: Record<string, string>
}

export const useMeta = create<MetaStore>((set, get) => {
  const saveClaimMirror = (key: string, value: unknown): void => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* Canonical envelope remains the authority when the evidence mirror fails. */
    }
  }

  // 共用提交：meta 無變動（同參照）則略過存檔（純更新函數無新增時回原物件）
  const commit = (meta: MetaState) => {
    if (meta === get().meta) return
    saveMetaState(meta)
    set({ meta })
  }
  const hydrate = (
    roster: OwnedUnit[],
    read: () => MetaState,
    write: (meta: MetaState) => void,
  ): void => {
    set({ loaded: false })
    const meta = addRegistered(read(), [...currentlyOwnedSpecies(roster)])
    write(meta)
    set({ meta, loaded: true })
  }

  const persistClaimMeta = (meta: MetaState): void => {
    saveMetaStateStrict(meta)
    saveClaimMirror(ACHIEVEMENT_CLAIM_META_MIRROR_KEY, meta.achievementClaims ?? [])
    set({ meta })
  }

  const claimCoordinator = new AchievementClaimCoordinator({
    meta: {
      loadMeta: async () => loadMetaStrict(),
      savePending: async (meta) => { persistClaimMeta(meta) },
      saveFinal: async (meta) => { persistClaimMeta(meta) },
    },
    egg: new AchievementEggDestination({
      loadState: async () => loadIncubatorStrict(),
      loadMarkers: async () => (await loadIncubatorStrict()).achievementClaims ?? [],
      savePending: async (state, markers, operationId) => {
        const completed = markers.map((marker) => marker.claimOperationId === operationId
          ? { ...marker, canonicalApplied: true }
          : marker)
        const next = { ...state, achievementClaims: completed }
        saveIncubatorStateWithAchievementClaimsStrict(next, completed)
        saveClaimMirror(ACHIEVEMENT_CLAIM_EGG_MIRROR_KEY, completed)
        useIncubator.setState({ state: next })
      },
      saveMarkers: async (markers) => {
        const state = await loadIncubatorStrict()
        const next = { ...state, achievementClaims: markers }
        saveIncubatorStateWithAchievementClaimsStrict(next, markers)
        saveClaimMirror(ACHIEVEMENT_CLAIM_EGG_MIRROR_KEY, markers)
        useIncubator.setState({ state: next })
      },
    }),
    sp: new AchievementSpDestination({
      loadPoints: async () => loadSkillPointsStrict(),
      loadMarkers: async () => loadSkillPointAchievementClaimsStrict(),
      savePending: async (points, markers, operationId) => {
        const completed = markers.map((marker) => marker.claimOperationId === operationId
          ? { ...marker, canonicalApplied: true }
          : marker)
        saveSkillPointsWithAchievementClaimsStrict(points, completed)
        saveClaimMirror(ACHIEVEMENT_CLAIM_SP_MIRROR_KEY, completed)
        useSkillPoints.setState({ sp: points })
      },
      saveMarkers: async (markers) => {
        const points = await loadSkillPointsStrict()
        saveSkillPointsWithAchievementClaimsStrict(points, markers)
        saveClaimMirror(ACHIEVEMENT_CLAIM_SP_MIRROR_KEY, markers)
      },
    }),
  })
  return {
    meta: defaultMeta(),
    loaded: false,
    claimBusy: null,
    claimErrors: {},

    load: (roster) => hydrate(roster, loadMeta, saveMetaState),

    loadStrict: (roster) => hydrate(roster, loadMetaStrict, saveMetaStateStrict),

    recordSeen: (speciesIds) => commit(addSeen(get().meta, speciesIds)),

    recordCapture: (speciesId, shiny) => {
      let meta = bumpStat(addRegistered(get().meta, [speciesId]), 'captures')
      if (shiny) meta = bumpStat(meta, 'shinies')
      commit(meta)
    },

    recordWin: (mode) => commit(bumpStat(get().meta, mode === 'arena' ? 'arenaWins' : 'wins')),

    recordEvolutions: (events) => {
      if (events.length === 0) return
      const meta = bumpStat(addRegistered(get().meta, events.map((e) => e.toSpecies)), 'evolutions', events.length)
      commit(meta)
    },

    claimAchievement: async (id) => {
      set({ claimBusy: id, claimErrors: { ...get().claimErrors, [id]: '' } })
      try {
        const result = await claimCoordinator.claimOnce(id)
        const nextErrors = { ...get().claimErrors }
        delete nextErrors[id]
        delete nextErrors['*']
        set({ meta: result.meta, claimErrors: nextErrors })
        return result
      } catch (cause) {
        if (cause instanceof AchievementClaimError && (cause.code === 'locked' || cause.code === 'claimed')) {
          // The modal can be stale after another tab/remount claimed the same
          // item. Refresh the canonical projection before returning the legacy
          // null result so the UI cannot keep offering a stale action.
          try { set({ meta: loadMetaStrict() }) } catch { /* preserve the current recoverable error state */ }
          return null
        }
        const message = cause instanceof Error ? cause.message : String(cause)
        set({ claimErrors: { ...get().claimErrors, [id]: message } })
        throw cause
      } finally {
        set({ claimBusy: null })
      }
    },

    reconcileAchievementClaims: async () => {
      const recovery = await claimCoordinator.recoverPending()
      const nextErrors = { ...get().claimErrors }
      if (recovery.errors.length > 0) {
        for (const error of recovery.errors) nextErrors[error.achievementId] = error.message
        set({ claimErrors: nextErrors })
      }
      else if (nextErrors['*']) {
        delete nextErrors['*']
        set({ claimErrors: nextErrors })
      }
      return recovery
    },
  }
})
