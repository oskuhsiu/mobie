// M10 — 星級 Grade（純派生展示，零 buff、零新欄、零持久化）。設計真相：plan/10 §2。
//
// 貼 Mezastar Grade 1–6（5=Star、6=Superstar）的稀有度展示徽章。
// **與 IV 星級嚴格分軸**：IV 星級＝個體素質（實質戰力）；Grade＝稀有度展示（不影響戰力）。
// 只由「已存在 / 靜態」資料派生（plan/10 §2.2，不為 Grade 加 origin 欄）：
//   shiny（已有）+ IV 總和 tier（已有）+ species 靜態稀有度（用 BST，species.baseStats 既有靜態資料）。
// 純函數、每次由 OwnedUnit + Species 派生，不另存。

import type { Species, Stats } from '@/game/types'

export type Grade = 1 | 2 | 3 | 4 | 5 | 6

/** Grade 派生只需個體值 + 異色旗標——OwnedUnit / BattleMobie 皆滿足。 */
export interface GradeInput {
  ivs: Stats
  shiny: boolean
}

const sumStats = (s: Stats): number => s.hp + s.atk + s.def + s.spa + s.spd + s.spe

/** IV 總和（0..186）分 5 階（0..4）：素質越高基底 Grade 越高。 */
function ivBucket(ivSum: number): number {
  if (ivSum >= 165) return 4
  if (ivSum >= 130) return 3
  if (ivSum >= 95) return 2
  if (ivSum >= 60) return 1
  return 0
}

/**
 * 計算稀有度 Grade（1..6）。純派生：
 *   基底 = 1 + IV tier（1..5）；BST≥600（傳說/準傳級稀有）+1；異色 → 大幅加值且至少 5。
 * → 普通個體≈2，滿 IV 一般種≈5，異色至少 5，異色滿 IV 傳說 = 6 Superstar。
 */
export function computeGrade(indiv: GradeInput, species: Species): Grade {
  const ivSum = sumStats(indiv.ivs)
  const bst = sumStats(species.baseStats)
  let g = 1 + ivBucket(ivSum) // 1..5
  if (bst >= 600) g += 1 // 靜態稀有度（高 BST＝傳說/準傳）
  if (indiv.shiny) g = Math.max(g + 1, 5) // 異色：加值且保底 5
  return Math.max(1, Math.min(6, g)) as Grade
}

/** Grade 顯示文案（5=Star、6=Superstar，貼 Mezastar）。 */
export const GRADE_LABEL: Record<Grade, string> = {
  1: 'Grade 1', 2: 'Grade 2', 3: 'Grade 3', 4: 'Grade 4', 5: 'Star', 6: 'Superstar',
}

/** Grade ≥5 為「閃耀級」，UI 給專屬光效。 */
export const isShiningGrade = (g: Grade): boolean => g >= 5

/** 短徽章字（6=SS / 5=S / 其餘數字），徽章與圖鑑格共用。 */
export const gradeShort = (g: Grade): string => (g === 6 ? 'SS' : g === 5 ? 'S' : String(g))
