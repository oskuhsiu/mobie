// M7 — 持有道具背包（itembag slice，mobie.itembag.v1）。設計真相：plan/09 §1.2。
//
// 背包只存「擁有數量」Record<itemId, number>，是獨立 save 命名空間（不塞進 OwnedUnit，
// 不違反「只存 canonical roster」——roster 的 canonical 是 OwnedUnit.heldItemId，背包是另一 slice）。
// 裝備對帳走 exactly-once：卸下舊道具→歸還 +1、裝上新道具→扣庫存 -1，由 equip 一次算清。

import { create } from 'zustand'
import { ITEMS, getItem } from '@/game/ext/items'
import { useRoster } from '@/store/rosterStore'

export const ITEM_BAG_STORAGE_KEY = 'mobie.itembag.v1'
const KEY = ITEM_BAG_STORAGE_KEY

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

/** Canonical equipment writes must report a failure to the UI transaction. */
function saveBagStrict(bag: Bag): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(bag))
  } catch (cause) {
    throw new Error(`保存道具庫存失敗：${cause instanceof Error ? cause.message : String(cause)}`)
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

// Every equip operation reads the latest roster and bag after the previous
// operation settles. This keeps two fast taps from spending the same item
// twice or overwriting a newer held-item assignment.
let equipQueue: Promise<void> = Promise.resolve()

export const useBag = create<BagStore>((set, get) => ({
  bag: loadBag(),

  equip: (unitId, itemId) => {
    const operation = equipQueue.then(async () => {
      const currentUnit = useRoster.getState().roster.find((u) => u.id === unitId)
      if (!currentUnit) return false
      const prev = currentUnit.heldItemId
      if (itemId && !getItem(itemId)) return false
      if (itemId && itemId === prev) return true // 已裝同一個＝no-op
      if (!itemId && prev === undefined) return true // already unequipped
      const bag = { ...get().bag }
      if (itemId && (bag[itemId] ?? 0) <= 0) return false // 庫存不足

      const nextBag = { ...bag }
      if (prev) nextBag[prev] = (nextBag[prev] ?? 0) + 1 // 歸還卸下的舊道具
      if (itemId) nextBag[itemId] = Math.max(0, (nextBag[itemId] ?? 0) - 1) // 扣裝上的新道具

      // The roster boundary writes first, then the bag boundary. If the second
      // write fails, restore the previous held item before surfacing one
      // retryable error; neither in-memory projection is published halfway.
      const real = await useRoster.getState().setHeldItem(unitId, itemId ?? undefined)
      try {
        saveBagStrict(nextBag)
      } catch (cause) {
        try { await useRoster.getState().setHeldItem(unitId, real) } catch { /* best effort */ }
        throw cause
      }
      set({ bag: nextBag })
      return true
    })
    equipQueue = operation.then(() => undefined, () => undefined)
    return operation
  },
}))
