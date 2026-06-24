// M17 — 玩家（訓練師）技能錢包（mobie.playerskills.v1，帳號級）。設計真相：plan/19 §資料模型。
//
// **不掛 OwnedUnit**（守 canonical roster 不變式）：玩家技能是訓練師自有工具、跨怪物共用，
// 故獨立 save slice。只存「已花 SP 解鎖的技能 id」；起始技能（cost 0，如看穿）由 catalog
// 的 isPartnerSkillLearned 視為恆習得，不需存進這裡。SP 扣款由呼叫端（PartnerSkillModal）用
// 共用的 skillPointsStore.spend 處理，與 M19 招式訓練同型（spend 成功才 learn）。

import { create } from 'zustand'

const KEY = 'mobie.playerskills.v1'

interface PersistShape {
  learnedSkillIds: string[]
}

function load(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const o = JSON.parse(raw) as Partial<PersistShape>
    if (!Array.isArray(o.learnedSkillIds)) return []
    return o.learnedSkillIds.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function save(ids: string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify({ learnedSkillIds: ids } satisfies PersistShape))
  } catch {
    /* 配額/隱私模式：忽略 */
  }
}

interface PlayerSkillsStore {
  learnedSkillIds: string[]
  /** 解鎖一個玩家技能（冪等；SP 扣款由呼叫端先做）。 */
  learn: (id: string) => void
}

export const usePlayerSkills = create<PlayerSkillsStore>((set, get) => ({
  learnedSkillIds: load(),

  learn: (id) => {
    if (get().learnedSkillIds.includes(id)) return
    const learnedSkillIds = [...get().learnedSkillIds, id]
    set({ learnedSkillIds })
    save(learnedSkillIds)
  },
}))
