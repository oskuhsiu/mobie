import type { Move } from '@/game/types'

/** 型別主題招式池：18 型 × 3 power tier（弱45 / 中70 / 強95）。
 *  每隻Mobie依「主屬性 + 種族值總和 tier」對應到其中一招（單一專屬招式）。
 *  本檔由 PokéAPI 產生器（scripts/gen_dex）寫出，請勿手改；要改招式請改產生器的 MOVE_SPEC。 */
export const MOVES: Record<number, Move> = {
  1000: { id: 1000, name: 'Tackle', nameZh: '撞擊', type: 'normal', power: 45, accuracy: 100, category: 'physical' },
  1001: { id: 1001, name: 'Take Down', nameZh: '猛撞', type: 'normal', power: 70, accuracy: 100, category: 'physical' },
  1002: { id: 1002, name: 'Giga Impact', nameZh: '終極衝鋒', type: 'normal', power: 95, accuracy: 100, category: 'physical' },
  1010: { id: 1010, name: 'Ember', nameZh: '火花', type: 'fire', power: 45, accuracy: 100, category: 'special' },
  1011: { id: 1011, name: 'Flamethrower', nameZh: '噴射火焰', type: 'fire', power: 70, accuracy: 100, category: 'special' },
  1012: { id: 1012, name: 'Fire Blast', nameZh: '大字爆炎', type: 'fire', power: 95, accuracy: 100, category: 'special' },
  1020: { id: 1020, name: 'Water Gun', nameZh: '水槍', type: 'water', power: 45, accuracy: 100, category: 'special' },
  1021: { id: 1021, name: 'Water Pulse', nameZh: '水之波動', type: 'water', power: 70, accuracy: 100, category: 'special' },
  1022: { id: 1022, name: 'Hydro Pump', nameZh: '水炮', type: 'water', power: 95, accuracy: 100, category: 'special' },
  1030: { id: 1030, name: 'Thunder Shock', nameZh: '電擊', type: 'electric', power: 45, accuracy: 100, category: 'special' },
  1031: { id: 1031, name: 'Thunderbolt', nameZh: '十萬伏特', type: 'electric', power: 70, accuracy: 100, category: 'special' },
  1032: { id: 1032, name: 'Thunder', nameZh: '打雷', type: 'electric', power: 95, accuracy: 100, category: 'special' },
  1040: { id: 1040, name: 'Absorb', nameZh: '吸取', type: 'grass', power: 45, accuracy: 100, category: 'special' },
  1041: { id: 1041, name: 'Energy Ball', nameZh: '能量球', type: 'grass', power: 70, accuracy: 100, category: 'special' },
  1042: { id: 1042, name: 'Solar Beam', nameZh: '日光束', type: 'grass', power: 95, accuracy: 100, category: 'special' },
  1050: { id: 1050, name: 'Powder Snow', nameZh: '細雪', type: 'ice', power: 45, accuracy: 100, category: 'special' },
  1051: { id: 1051, name: 'Ice Beam', nameZh: '冰凍光束', type: 'ice', power: 70, accuracy: 100, category: 'special' },
  1052: { id: 1052, name: 'Blizzard', nameZh: '暴風雪', type: 'ice', power: 95, accuracy: 100, category: 'special' },
  1060: { id: 1060, name: 'Karate Chop', nameZh: '空手劈', type: 'fighting', power: 45, accuracy: 100, category: 'physical' },
  1061: { id: 1061, name: 'Jump Kick', nameZh: '飛踢', type: 'fighting', power: 70, accuracy: 100, category: 'physical' },
  1062: { id: 1062, name: 'Close Combat', nameZh: '近身戰', type: 'fighting', power: 95, accuracy: 100, category: 'physical' },
  1070: { id: 1070, name: 'Acid', nameZh: '毒液衝擊', type: 'poison', power: 45, accuracy: 100, category: 'special' },
  1071: { id: 1071, name: 'Sludge', nameZh: '污泥攻擊', type: 'poison', power: 70, accuracy: 100, category: 'special' },
  1072: { id: 1072, name: 'Sludge Bomb', nameZh: '污泥炸彈', type: 'poison', power: 95, accuracy: 100, category: 'special' },
  1080: { id: 1080, name: 'Mud-Slap', nameZh: '玩泥巴', type: 'ground', power: 45, accuracy: 100, category: 'physical' },
  1081: { id: 1081, name: 'Dig', nameZh: '挖洞', type: 'ground', power: 70, accuracy: 100, category: 'physical' },
  1082: { id: 1082, name: 'Earthquake', nameZh: '地震', type: 'ground', power: 95, accuracy: 100, category: 'physical' },
  1090: { id: 1090, name: 'Peck', nameZh: '啄', type: 'flying', power: 45, accuracy: 100, category: 'physical' },
  1091: { id: 1091, name: 'Wing Attack', nameZh: '翅膀攻擊', type: 'flying', power: 70, accuracy: 100, category: 'physical' },
  1092: { id: 1092, name: 'Brave Bird', nameZh: '勇鳥猛攻', type: 'flying', power: 95, accuracy: 100, category: 'physical' },
  1100: { id: 1100, name: 'Confusion', nameZh: '念力', type: 'psychic', power: 45, accuracy: 100, category: 'special' },
  1101: { id: 1101, name: 'Psybeam', nameZh: '精神強念', type: 'psychic', power: 70, accuracy: 100, category: 'special' },
  1102: { id: 1102, name: 'Psychic', nameZh: '精神力量', type: 'psychic', power: 95, accuracy: 100, category: 'special' },
  1110: { id: 1110, name: 'Bug Bite', nameZh: '蟲咬', type: 'bug', power: 45, accuracy: 100, category: 'physical' },
  1111: { id: 1111, name: 'Twineedle', nameZh: '雙針', type: 'bug', power: 70, accuracy: 100, category: 'physical' },
  1112: { id: 1112, name: 'Megahorn', nameZh: '巨角', type: 'bug', power: 95, accuracy: 100, category: 'physical' },
  1120: { id: 1120, name: 'Rock Throw', nameZh: '落石', type: 'rock', power: 45, accuracy: 100, category: 'physical' },
  1121: { id: 1121, name: 'Rock Tomb', nameZh: '岩石封鎖', type: 'rock', power: 70, accuracy: 100, category: 'physical' },
  1122: { id: 1122, name: 'Rock Slide', nameZh: '岩崩', type: 'rock', power: 95, accuracy: 100, category: 'physical' },
  1130: { id: 1130, name: 'Shadow Sneak', nameZh: '暗影偷襲', type: 'ghost', power: 45, accuracy: 100, category: 'special' },
  1131: { id: 1131, name: 'Shadow Claw', nameZh: '暗影爪', type: 'ghost', power: 70, accuracy: 100, category: 'special' },
  1132: { id: 1132, name: 'Shadow Ball', nameZh: '暗影球', type: 'ghost', power: 95, accuracy: 100, category: 'special' },
  1140: { id: 1140, name: 'Dragon Breath', nameZh: '龍息', type: 'dragon', power: 45, accuracy: 100, category: 'special' },
  1141: { id: 1141, name: 'Dragon Pulse', nameZh: '龍之波動', type: 'dragon', power: 70, accuracy: 100, category: 'special' },
  1142: { id: 1142, name: 'Draco Meteor', nameZh: '流星群', type: 'dragon', power: 95, accuracy: 100, category: 'special' },
  1150: { id: 1150, name: 'Bite', nameZh: '咬住', type: 'dark', power: 45, accuracy: 100, category: 'physical' },
  1151: { id: 1151, name: 'Knock Off', nameZh: '拍落', type: 'dark', power: 70, accuracy: 100, category: 'physical' },
  1152: { id: 1152, name: 'Crunch', nameZh: '咬碎', type: 'dark', power: 95, accuracy: 100, category: 'physical' },
  1160: { id: 1160, name: 'Metal Claw', nameZh: '金屬爪', type: 'steel', power: 45, accuracy: 100, category: 'physical' },
  1161: { id: 1161, name: 'Iron Head', nameZh: '鐵頭', type: 'steel', power: 70, accuracy: 100, category: 'physical' },
  1162: { id: 1162, name: 'Iron Tail', nameZh: '鐵尾', type: 'steel', power: 95, accuracy: 100, category: 'physical' },
  1170: { id: 1170, name: 'Fairy Wind', nameZh: '妖精之風', type: 'fairy', power: 45, accuracy: 100, category: 'special' },
  1171: { id: 1171, name: 'Dazzling Gleam', nameZh: '魔法閃耀', type: 'fairy', power: 70, accuracy: 100, category: 'special' },
  1172: { id: 1172, name: 'Moonblast', nameZh: '月亮之力', type: 'fairy', power: 95, accuracy: 100, category: 'special' },
}

export function getMove(id: number): Move {
  const m = MOVES[id]
  if (!m) throw new Error(`Unknown move id: ${id}`)
  return m
}
