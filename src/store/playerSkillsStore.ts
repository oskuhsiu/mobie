// M17 / M24 — 玩家（訓練師）技能錢包（mobie.playerskills.v1，帳號級）。
//
// Partner 技能不掛 OwnedUnit，也不和怪物招式共用任何 canonical 欄位。SP 仍是
// `mobie.skillpoints.v1` 的單一帳號錢包；unlockWithSp 是兩個帳號 slice 之間的
// 最小交易邊界，先確認本機畫面沒有過期，再一次寫入 SP 與 learned ids。

import { create } from 'zustand'
import { getPartnerSkill, isPartnerSkillLearned } from '@/game/ext/partnerSkills'
import { bumpSaveMeta } from '@/game/save/saveMeta'
import {
  loadSkillPointsStrict,
  saveSkillPointsStrict,
  useSkillPoints,
} from '@/store/skillPointsStore'

export const PLAYER_SKILLS_KEY = 'mobie.playerskills.v1'

interface PersistShape {
  learnedSkillIds: string[]
}

function normalizeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function decode(raw: string | null): string[] | null {
  if (raw === null) return []
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Partial<PersistShape>
  if (!Array.isArray(record.learnedSkillIds)) return null
  if (record.learnedSkillIds.some((id) => typeof id !== 'string')) return null
  return normalizeIds(record.learnedSkillIds)
}

/** Soft read used at module initialisation and by legacy callers. */
export function loadPlayerSkills(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return decode(localStorage.getItem(PLAYER_SKILLS_KEY)) ?? []
  } catch {
    return []
  }
}

/** Strict read used by the account transaction and the explicit recovery action. */
export function loadPlayerSkillsStrict(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(PLAYER_SKILLS_KEY)
    const ids = decode(raw)
    if (ids === null) throw new Error('資料格式無效')
    return ids
  } catch (cause) {
    throw new Error(`讀取夥伴技能失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

function save(ids: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PLAYER_SKILLS_KEY, JSON.stringify({ learnedSkillIds: normalizeIds(ids) } satisfies PersistShape))
  } catch {
    /* 舊版相容呼叫不阻斷遊戲；需要可恢復錯誤時走 savePlayerSkillsStrict。 */
  }
}

/** Strict write used by unlockWithSp; errors must reach the UI for recovery. */
export function savePlayerSkillsStrict(ids: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PLAYER_SKILLS_KEY, JSON.stringify({ learnedSkillIds: normalizeIds(ids) } satisfies PersistShape))
  } catch (cause) {
    throw new Error(`保存夥伴技能失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

export type PartnerSkillUnlockErrorCode =
  | 'unknown-skill'
  | 'insufficient-sp'
  | 'busy'
  | 'storage-error'
  | 'stale-account'

/** Recoverable failure surfaced by the Partner Skills screen. */
export class PartnerSkillUnlockError extends Error {
  readonly code: PartnerSkillUnlockErrorCode

  constructor(code: PartnerSkillUnlockErrorCode, message: string) {
    super(message)
    this.name = 'PartnerSkillUnlockError'
    this.code = code
  }
}

export interface PartnerSkillUnlockResult {
  status: 'applied' | 'already-learned'
  skillId: string
  cost: number
  remainingSp: number
}

interface PlayerSkillsStore {
  learnedSkillIds: string[]
  loaded: boolean
  loadError: string | null
  /** Legacy idempotent write used by deterministic dev fixtures and old callers. */
  learn: (id: string) => void
  /** Re-read the account slice after a stale or storage failure. */
  reload: () => void
  /** Validate account snapshots, spend SP, and persist the learned skill once. */
  unlockWithSp: (id: string) => Promise<PartnerSkillUnlockResult>
}

function storageError(cause: unknown): PartnerSkillUnlockError {
  return new PartnerSkillUnlockError(
    'storage-error',
    `夥伴技能保存失敗：${cause instanceof Error ? cause.message : String(cause)}。目前 SP 與解鎖狀態未套用，請再試一次。`,
  )
}

function initialAccount(): { learnedSkillIds: string[]; loadError: string | null } {
  try {
    return { learnedSkillIds: loadPlayerSkillsStrict(), loadError: null }
  } catch (cause) {
    return { learnedSkillIds: [], loadError: cause instanceof Error ? cause.message : String(cause) }
  }
}

export const usePlayerSkills = create<PlayerSkillsStore>((set, get) => {
  // A store-level lock closes the keyboard-repeat/remount window before the
  // async caller can publish its result. The canonical snapshots below still
  // protect against another tab changing either account slice.
  let unlockBusy = false

  const initial = initialAccount()

  return {
    learnedSkillIds: initial.learnedSkillIds,
    loaded: true,
    loadError: initial.loadError,

    learn: (id) => {
      if (!getPartnerSkill(id) || get().learnedSkillIds.includes(id)) return
      const learnedSkillIds = [...get().learnedSkillIds, id]
      set({ learnedSkillIds, loaded: true, loadError: null })
      save(learnedSkillIds)
    },

    reload: () => {
      try {
        const learnedSkillIds = loadPlayerSkillsStrict()
        const sp = loadSkillPointsStrict()
        useSkillPoints.setState({ sp })
        set({ learnedSkillIds, loaded: true, loadError: null })
      } catch (cause) {
        set({ loaded: false, loadError: cause instanceof Error ? cause.message : String(cause) })
      }
    },

    unlockWithSp: async (id) => {
      if (unlockBusy) {
        throw new PartnerSkillUnlockError('busy', '另一個夥伴技能操作正在保存，請稍候。')
      }
      const skill = getPartnerSkill(id)
      if (!skill) throw new PartnerSkillUnlockError('unknown-skill', '找不到這個夥伴技能，請重新載入技能目錄。')

      unlockBusy = true
      try {
        // Yield once so a same-tick keyboard repeat or second caller observes
        // the busy fence before the synchronous localStorage transaction runs.
        await Promise.resolve()
        if (!get().loaded || get().loadError) {
          throw new PartnerSkillUnlockError(
            'stale-account',
            get().loadError ?? '帳號技能資料尚未準備完成；請先重新載入帳號。',
          )
        }
        let persistedIds: string[]
        let persistedSp: number
        try {
          persistedIds = loadPlayerSkillsStrict()
          persistedSp = loadSkillPointsStrict()
        } catch (cause) {
          throw storageError(cause)
        }

        const currentIds = normalizeIds(get().learnedSkillIds)
        const currentSp = useSkillPoints.getState().sp
        if (!sameIds(currentIds, persistedIds) || currentSp !== persistedSp) {
          throw new PartnerSkillUnlockError(
            'stale-account',
            '帳號資料已在其他分頁或較新的操作中變更；請重新載入帳號後再試一次。',
          )
        }

        if (isPartnerSkillLearned(skill.id, persistedIds)) {
          return { status: 'already-learned', skillId: skill.id, cost: skill.cost, remainingSp: persistedSp }
        }
        if (persistedSp < skill.cost) {
          throw new PartnerSkillUnlockError(
            'insufficient-sp',
            `SP 不足：解鎖「${skill.name}」需要 ${skill.cost} SP，目前只有 ${persistedSp} SP。`,
          )
        }

        const nextSp = persistedSp - skill.cost
        const nextIds = [...persistedIds, skill.id]
        // Keep the old canonical values in hand so a second write failure can
        // roll back best-effort and leave the in-memory projections untouched.
        try {
          saveSkillPointsStrict(nextSp)
          savePlayerSkillsStrict(nextIds)
        } catch (cause) {
          try { saveSkillPointsStrict(persistedSp) } catch { /* best effort */ }
          try { savePlayerSkillsStrict(persistedIds) } catch { /* best effort */ }
          throw storageError(cause)
        }

        useSkillPoints.setState({ sp: nextSp })
        set({ learnedSkillIds: nextIds, loaded: true, loadError: null })
        bumpSaveMeta(Date.now())
        return { status: 'applied', skillId: skill.id, cost: skill.cost, remainingSp: nextSp }
      } finally {
        unlockBusy = false
      }
    },
  }
})
