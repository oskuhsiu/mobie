// M19.e / M17 — 技能點（SP）錢包（mobie.skillpoints.v1，帳號級單一數值）。
//
// 怪物招式訓練（M19.e）與玩家夥伴技能（M17，plan/19）**共用同一池**，但 UI 兩分頁**分池顯示**
// （plan/17 §3.1 護欄：避免玩家誤以為同類）。獨立 save slice，不塞進 OwnedUnit（守 canonical roster）。

import { create } from 'zustand'

const KEY = 'mobie.skillpoints.v1'

function loadSp(): number {
  if (typeof localStorage === 'undefined') return 0
  try {
    const raw = localStorage.getItem(KEY)
    const n = raw ? JSON.parse(raw) : 0
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

function saveSp(n: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(n))
  } catch {
    /* 配額/隱私模式：忽略 */
  }
}

interface SkillPointsStore {
  sp: number
  /** 加 SP（boss/塔勝利給；不持久化中間態，直接寫帳號級總數）。 */
  add: (delta: number) => void
  /** 嘗試花費；餘額不足回 false（不扣）。成功扣款並存檔。 */
  spend: (cost: number) => boolean
}

export const useSkillPoints = create<SkillPointsStore>((set, get) => ({
  sp: loadSp(),

  add: (delta) => {
    if (delta <= 0) return
    const sp = get().sp + Math.floor(delta)
    set({ sp })
    saveSp(sp)
  },

  spend: (cost) => {
    if (cost <= 0) return true
    const cur = get().sp
    if (cur < cost) return false
    const sp = cur - Math.floor(cost)
    set({ sp })
    saveSp(sp)
    return true
  },
}))
