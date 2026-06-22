import type { TypeName } from '@/game/types'

export const TYPE_LABEL_ZH: Record<TypeName, string> = {
  normal: '一般', fire: '火', water: '水', electric: '電', grass: '草', ice: '冰',
  fighting: '格鬥', poison: '毒', ground: '地面', flying: '飛行', psychic: '超能力',
  bug: '蟲', rock: '岩石', ghost: '幽靈', dragon: '龍', dark: '惡', steel: '鋼', fairy: '妖精',
}

export const typeColor = (t: TypeName) => `var(--t-${t})`

/** 屬性色 hex（給 canvas 粒子用，對齊 global.css :root 的 --t-*） */
export const TYPE_HEX: Record<TypeName, string> = {
  normal: '#9fa19f', fire: '#e62829', water: '#2980ef', electric: '#fac000',
  grass: '#3fa129', ice: '#3fd8ff', fighting: '#ff8000', poison: '#9141cb',
  ground: '#b9772f', flying: '#81b9ef', psychic: '#ef4179', bug: '#91a119',
  rock: '#afa981', ghost: '#704170', dragon: '#5060e1', dark: '#50413f',
  steel: '#60a1b8', fairy: '#ef70ef',
}
