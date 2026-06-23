// M7 — 持有道具背包（itembag slice，mz.itembag.v1）。設計真相：plan/09 §1.2。
//
// 背包只存「擁有數量」Record<itemId, number>，是獨立 save 命名空間（不塞進 OwnedUnit，
// 不違反「只存 canonical roster」——roster 的 canonical 是 OwnedUnit.heldItemId，背包是另一 slice）。
// 裝備對帳走 exactly-once：卸下舊道具→歸還 +1、裝上新道具→扣庫存 -1，由 equip 一次算清。

import { create } from 'zustand'
import { ITEMS } from '@/game/ext/items'
import { useRoster } from '@/store/rosterStore'

const KEY = 'mz.itembag.v1'

type Bag = Record<string, number>

/** 自用初始背包：每種道具給 2 個（純自用、無付費/掉落系統）。 */
function starterBag(): Bag {
  const b: Bag = {}
  for (const d of ITEMS) b[d.id] = 2
  return b
}

/** 只保留已知道具 id、非負整數的庫存（防壞檔 / 刪過的道具）。 */
function sanitizeBag(raw: unknown): Bag {
  const known = new Set(ITEMS.map((d) => d.id))
  const out: Bag = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (known.has(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.floor(v)
    }
  }
  return out
}

function loadBag(): Bag {
  if (typeof localStorage === 'undefined') return starterBag()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return starterBag() // 首次：種子背包
    return sanitizeBag(JSON.parse(raw))
  } catch {
    return starterBag()
  }
}

function saveBag(bag: Bag): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(bag))
  } catch {
    /* 配額/隱私模式：忽略 */
  }
}

interface BagStore {
  bag: Bag
  /**
   * 裝備（itemId=null 卸下）到某隻 roster 單位。回 true=成功；false=庫存不足。
   * 對帳：歸還舊道具、扣新道具庫存；同步寫 OwnedUnit.heldItemId（rosterStore）。
   */
  equip: (unitId: string, itemId: string | null) => Promise<boolean>
}

export const useBag = create<BagStore>((set, get) => ({
  bag: loadBag(),

  equip: async (unitId, itemId) => {
    const prev = useRoster.getState().roster.find((u) => u.id === unitId)?.heldItemId
    if (itemId && itemId === prev) return true // 已裝同一個＝no-op
    const bag = { ...get().bag }
    if (itemId && (bag[itemId] ?? 0) <= 0) return false // 庫存不足

    const real = await useRoster.getState().setHeldItem(unitId, itemId ?? undefined)
    if (real) bag[real] = (bag[real] ?? 0) + 1 // 歸還卸下的舊道具
    if (itemId) bag[itemId] = (bag[itemId] ?? 0) - 1 // 扣裝上的新道具
    set({ bag })
    saveBag(bag)
    return true
  },
}))
