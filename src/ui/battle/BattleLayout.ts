export type BattleWindowClass =
  | 'short-landscape'
  | 'phone-portrait'
  | 'tablet-portrait'
  | 'mid-landscape'
  | 'wide-landscape'

/** Mirrors the mutually-exclusive media-query contract in battle.css. */
export function classifyBattleWindow(width: number, height: number): BattleWindowClass {
  const landscape = width > height
  if (landscape && height <= 600) return 'short-landscape'
  if (!landscape && width <= 620) return 'phone-portrait'
  if (!landscape) return 'tablet-portrait'
  if (width <= 899) return 'mid-landscape'
  return 'wide-landscape'
}
