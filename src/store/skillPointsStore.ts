// M19.e / M17 — 技能點（SP）錢包（mobie.skillpoints.v1，帳號級單一數值）。
//
// 怪物招式訓練（M19.e）與玩家夥伴技能（M17，plan/19）**共用同一池**，但 UI 兩分頁**分池顯示**
// （plan/17 §3.1 護欄：避免玩家誤以為同類）。獨立 save slice，不塞進 OwnedUnit（守 canonical roster）。

import { create } from 'zustand'
import type { AchievementRewardMarker } from '@/game/achievementClaim'

export const SKILL_POINTS_KEY = 'mobie.skillpoints.v1'
const SETTLEMENT_FIELD = 'resultSettlements'

function decode(raw: string | null): { points: number; settlements?: unknown[]; achievementClaims?: AchievementRewardMarker[] } | null {
  if (raw === null) return null
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed === 'number') return Number.isFinite(parsed) && parsed >= 0 ? { points: Math.floor(parsed) } : null
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (typeof record.sp !== 'number' || !Number.isFinite(record.sp) || record.sp < 0) return null
  return {
    points: Math.floor(record.sp),
    ...(Array.isArray(record[SETTLEMENT_FIELD]) ? { settlements: record[SETTLEMENT_FIELD] } : {}),
    ...(Array.isArray(record.achievementClaims) ? { achievementClaims: record.achievementClaims as AchievementRewardMarker[] } : {}),
  }
}

function encode(n: number, settlements?: unknown[], achievementClaims?: AchievementRewardMarker[]): string {
  if (!settlements && !achievementClaims) return JSON.stringify(Math.max(0, Math.floor(n)))
  return JSON.stringify({
    sp: Math.max(0, Math.floor(n)),
    ...(settlements ? { [SETTLEMENT_FIELD]: settlements } : {}),
    ...(achievementClaims ? { achievementClaims } : {}),
  })
}

export function loadSkillPoints(): number {
  if (typeof localStorage === 'undefined') return 0
  try {
    return decode(localStorage.getItem(SKILL_POINTS_KEY))?.points ?? 0
  } catch {
    return 0
  }
}

export function loadSkillPointsStrict(): number {
  if (typeof localStorage === 'undefined') return 0
  const raw = localStorage.getItem(SKILL_POINTS_KEY)
  if (raw === null) return 0
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`讀取 SP 失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const decoded = decode(JSON.stringify(parsed))
  if (!decoded) throw new Error('讀取 SP 失敗：資料格式無效')
  return decoded.points
}

function saveSp(n: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    const current = decode(localStorage.getItem(SKILL_POINTS_KEY))
    localStorage.setItem(SKILL_POINTS_KEY, encode(n, current?.settlements, current?.achievementClaims))
  } catch {
    /* 配額/隱私模式：忽略 */
  }
}

export function saveSkillPointsStrict(n: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    const current = decode(localStorage.getItem(SKILL_POINTS_KEY))
    localStorage.setItem(SKILL_POINTS_KEY, encode(n, current?.settlements, current?.achievementClaims))
  } catch (cause) {
    throw new Error(`保存 SP 失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Child-boundary write: canonical SP and its settlement markers share one envelope. */
export function saveSkillPointsWithSettlementMarkersStrict(n: number, markers: unknown[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    const current = decode(localStorage.getItem(SKILL_POINTS_KEY))
    localStorage.setItem(SKILL_POINTS_KEY, encode(n, markers, current?.achievementClaims))
  } catch (cause) {
    throw new Error(`保存 SP 結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Read the SP child markers owned by the Achievement claim boundary. */
export function loadSkillPointAchievementClaims(): AchievementRewardMarker[] {
  if (typeof localStorage === 'undefined') return []
  try { return decode(localStorage.getItem(SKILL_POINTS_KEY))?.achievementClaims ?? [] }
  catch { return [] }
}

/** Strict claim-marker read: a malformed/unavailable wallet must block a retry. */
export function loadSkillPointAchievementClaimsStrict(): AchievementRewardMarker[] {
  if (typeof localStorage === 'undefined') return []
  const raw = localStorage.getItem(SKILL_POINTS_KEY)
  if (raw === null) return []
  let decoded: { achievementClaims?: AchievementRewardMarker[] } | null
  try { decoded = decode(raw) }
  catch (cause) { throw new Error(`讀取成就 SP 領取標記失敗：${cause instanceof Error ? cause.message : String(cause)}`) }
  if (!decoded) throw new Error('讀取成就 SP 領取標記失敗：資料格式無效')
  return decoded.achievementClaims ?? []
}

/** Claim child-boundary write: canonical SP and achievement receipt markers share one envelope. */
export function saveSkillPointsWithAchievementClaimsStrict(
  points: number,
  claims: AchievementRewardMarker[],
): void {
  if (typeof localStorage === 'undefined') return
  try {
    const current = decode(localStorage.getItem(SKILL_POINTS_KEY))
    localStorage.setItem(SKILL_POINTS_KEY, encode(points, current?.settlements, claims))
  } catch (cause) {
    throw new Error(`保存成就 SP 領取資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
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
  sp: loadSkillPoints(),

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
