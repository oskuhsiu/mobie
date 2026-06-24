// 一次性產生器：從 PokéAPI 抓 dex 1–1025（G1–G9），產生 species/moves/regions/playerCards 四個資料檔。
// Node 24（內建 fetch）。本地快取 /tmp/dexcache，並發 + 重試。不內建侵權資產：artwork 走官方 raw URL（runtime 載）。
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 用法：node scripts/gen_dex.mjs —— 從 PokéAPI 重新產生 src/game/data 的四個資料檔。
// M13 內容補完：1025＝全國圖鑑 G1–G9（plan/13 §1.1）。可調小做分階段。
const MAX_ID = 1025
const CACHE = '/tmp/dexcache' // 原始 JSON 快取（可刪；刪後重抓）
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'game', 'data')
mkdirSync(CACHE, { recursive: true })

const TYPE_ORDER = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
]
const typeIndex = (t) => TYPE_ORDER.indexOf(t)

// 18 型 × 3 power tier 的招式（zh-Hant）。category 取該型常見強攻擊面向（我們是單一數值模型）。
const MOVE_SPEC = {
  normal:   { cat: 'physical', tiers: [['Tackle','撞擊',45], ['Take Down','猛撞',70], ['Giga Impact','終極衝鋒',95]] },
  fire:     { cat: 'special',  tiers: [['Ember','火花',45], ['Flamethrower','噴射火焰',70], ['Fire Blast','大字爆炎',95]] },
  water:    { cat: 'special',  tiers: [['Water Gun','水槍',45], ['Water Pulse','水之波動',70], ['Hydro Pump','水炮',95]] },
  electric: { cat: 'special',  tiers: [['Thunder Shock','電擊',45], ['Thunderbolt','十萬伏特',70], ['Thunder','打雷',95]] },
  grass:    { cat: 'special',  tiers: [['Absorb','吸取',45], ['Energy Ball','能量球',70], ['Solar Beam','日光束',95]] },
  ice:      { cat: 'special',  tiers: [['Powder Snow','細雪',45], ['Ice Beam','冰凍光束',70], ['Blizzard','暴風雪',95]] },
  fighting: { cat: 'physical', tiers: [['Karate Chop','空手劈',45], ['Jump Kick','飛踢',70], ['Close Combat','近身戰',95]] },
  poison:   { cat: 'special',  tiers: [['Acid','毒液衝擊',45], ['Sludge','污泥攻擊',70], ['Sludge Bomb','污泥炸彈',95]] },
  ground:   { cat: 'physical', tiers: [['Mud-Slap','玩泥巴',45], ['Dig','挖洞',70], ['Earthquake','地震',95]] },
  flying:   { cat: 'physical', tiers: [['Peck','啄',45], ['Wing Attack','翅膀攻擊',70], ['Brave Bird','勇鳥猛攻',95]] },
  psychic:  { cat: 'special',  tiers: [['Confusion','念力',45], ['Psybeam','精神強念',70], ['Psychic','精神力量',95]] },
  bug:      { cat: 'physical', tiers: [['Bug Bite','蟲咬',45], ['Twineedle','雙針',70], ['Megahorn','巨角',95]] },
  rock:     { cat: 'physical', tiers: [['Rock Throw','落石',45], ['Rock Tomb','岩石封鎖',70], ['Rock Slide','岩崩',95]] },
  ghost:    { cat: 'special',  tiers: [['Shadow Sneak','暗影偷襲',45], ['Shadow Claw','暗影爪',70], ['Shadow Ball','暗影球',95]] },
  dragon:   { cat: 'special',  tiers: [['Dragon Breath','龍息',45], ['Dragon Pulse','龍之波動',70], ['Draco Meteor','流星群',95]] },
  dark:     { cat: 'physical', tiers: [['Bite','咬住',45], ['Knock Off','拍落',70], ['Crunch','咬碎',95]] },
  steel:    { cat: 'physical', tiers: [['Metal Claw','金屬爪',45], ['Iron Head','鐵頭',70], ['Iron Tail','鐵尾',95]] },
  fairy:    { cat: 'special',  tiers: [['Fairy Wind','妖精之風',45], ['Dazzling Gleam','魔法閃耀',70], ['Moonblast','月亮之力',95]] },
}
const moveId = (type, tier) => 1000 + typeIndex(type) * 10 + tier
const bstTier = (bst) => (bst < 380 ? 0 : bst < 480 ? 1 : 2)

// 變化招池（M19.d，plan/17 §1.3）——少量通用、跨型別的非傷害戰術招（id 2000+）。
// 無威力（power 0、category 'status'），帶 effect 語意；reducer 依 effect 寫 fieldState 暫態。
// QTE 只影響強度（持續回合/回復量），不影響成敗；mult 即硬上限。型別僅供顯示/地形關聯。
const STATUS_MOVES = [
  { id: 2000, name: 'Swords Dance', nameZh: '劍舞', type: 'normal', effect: { kind: 'buff', stat: 'atk', mult: 1.5, duration: 4, label: '攻擊大幅提升' } },
  { id: 2001, name: 'Iron Defense', nameZh: '鐵壁', type: 'steel', effect: { kind: 'buff', stat: 'def', mult: 1.5, duration: 4, label: '防禦大幅提升' } },
  { id: 2002, name: 'Calm Mind', nameZh: '瞑想', type: 'psychic', effect: { kind: 'buff', stat: 'spa', mult: 1.5, duration: 4, label: '特攻提升' } },
  { id: 2003, name: 'Recover', nameZh: '自我再生', type: 'normal', effect: { kind: 'heal', healFrac: 0.4, label: '回復體力' } },
  { id: 2004, name: 'Grassy Terrain', nameZh: '青草場地', type: 'grass', effect: { kind: 'terrain', terrainId: 'grassland', label: '展開青草場地' } },
]

// ── 抓取（快取 + 並發 + 重試） ──
async function getJson(url, cacheFile) {
  const path = `${CACHE}/${cacheFile}`
  if (existsSync(path)) {
    try { return JSON.parse(readFileSync(path, 'utf8')) } catch { /* re-fetch */ }
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      writeFileSync(path, JSON.stringify(data))
      return data
    } catch (e) {
      if (attempt === 3) throw new Error(`fetch ${url}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
}

const STAT_KEY = { hp: 'hp', attack: 'atk', defense: 'def', 'special-attack': 'spa', 'special-defense': 'spd', speed: 'spe' }
const cap = (s) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')

async function fetchOne(id) {
  const pk = await getJson(`https://pokeapi.co/api/v2/pokemon/${id}`, `pk-${id}.json`)
  const sp = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${id}`, `sp-${id}.json`)
  const baseStats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  for (const s of pk.stats) { const k = STAT_KEY[s.stat.name]; if (k) baseStats[k] = s.base_stat }
  const types = pk.types.slice().sort((a, b) => a.slot - b.slot).map((t) => t.type.name)
  const zh = sp.names.find((n) => n.language.name === 'zh-hant')
    || sp.names.find((n) => n.language.name === 'zh-hans')
  const nameZh = zh ? zh.name : cap(pk.name)
  // M19.f：真實升級級數（去重升序，>1）作為學習表「節奏」；降維映射到我們的精簡招式池。
  const levelSet = new Set()
  for (const m of pk.moves) {
    for (const v of m.version_group_details) {
      if (v.move_learn_method.name === 'level-up' && v.level_learned_at > 1) levelSet.add(v.level_learned_at)
    }
  }
  const levelUpLevels = [...levelSet].sort((a, b) => a - b)
  return { id, name: cap(pk.name), nameZh, types, baseStats, levelUpLevels, evoChainUrl: sp.evolution_chain?.url ?? null }
}

// ── 進化鏈解析（M10）──
// PokéAPI evolution-chain 是樹（species + evolves_to[]）。我們把每個「父→子」邊收成
// speciesId → { to, level }：等級進化用 min_level；道具/通信/親密度等非等級進化「簡化為等級觸發」
// （街機不引入道具進化）——依進化階深合成（第一段 20 / 第二段 38）。分歧進化（伊布）取第一個子代＝決定論。
const speciesIdFromUrl = (url) => { const m = url && url.match(/\/pokemon-species\/(\d+)\/?$/); return m ? Number(m[1]) : null }
function walkChain(node, evoMap, depth = 0) {
  const fromId = speciesIdFromUrl(node.species?.url)
  for (const child of node.evolves_to ?? []) {
    const toId = speciesIdFromUrl(child.species?.url)
    const det = (child.evolution_details && child.evolution_details[0]) || {}
    const level = det.min_level || (depth === 0 ? 20 : 38)
    if (fromId && toId && toId <= MAX_ID && !evoMap.has(fromId)) evoMap.set(fromId, { to: toId, level })
    walkChain(child, evoMap, depth + 1)
  }
}

// 並發池
async function pool(ids, worker, concurrency = 12) {
  const out = new Array(ids.length)
  let next = 0
  let done = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = next++
      if (i >= ids.length) return
      out[i] = await worker(ids[i])
      done++
      if (done % 25 === 0 || done === ids.length) process.stdout.write(`  fetched ${done}/${ids.length}\n`)
    }
  }))
  return out
}

console.log(`抓取 dex 1–${MAX_ID}…`)
const ids = Array.from({ length: MAX_ID }, (_, i) => i + 1)
const dex = await pool(ids, fetchOne)
dex.sort((a, b) => a.id - b.id)
console.log(`完成，共 ${dex.length} 隻。範例：`, JSON.stringify(dex[0]))

// ── 抓取進化鏈、建 speciesId → { to, level } 對照（M10）──
const chainUrls = [...new Set(dex.map((d) => d.evoChainUrl).filter(Boolean))]
const chains = await pool(chainUrls, (url) => getJson(url, `evo-${url.match(/\/evolution-chain\/(\d+)\//)?.[1] ?? 'x'}.json`))
const evoMap = new Map()
for (const c of chains) if (c?.chain) walkChain(c.chain, evoMap)
console.log(`進化鏈：${evoMap.size} 個可進化物種`)

// ── 產生 moves.ts ──
const moveLines = []
for (const type of TYPE_ORDER) {
  const spec = MOVE_SPEC[type]
  spec.tiers.forEach(([name, nameZh, power], tier) => {
    const id = moveId(type, tier)
    moveLines.push(`  ${id}: { id: ${id}, name: '${name}', nameZh: '${nameZh}', type: '${type}', power: ${power}, accuracy: 100, category: '${spec.cat}' },`)
  })
}
// 變化招（M19.d）：power 0 / category 'status' / 帶 effect。
for (const m of STATUS_MOVES) {
  moveLines.push(`  ${m.id}: { id: ${m.id}, name: '${m.name}', nameZh: '${m.nameZh}', type: '${m.type}', power: 0, accuracy: 100, category: 'status', effect: ${JSON.stringify(m.effect)} },`)
}
const movesTs = `import type { Move } from '@/game/types'

/** 型別主題招式池：18 型 × 3 power tier（弱45 / 中70 / 強95）＋ 變化招池（M19.d，id 2000+）。
 *  每隻Mobie依「主屬性 + 種族值總和 tier」對應到其攻擊招；變化招由學習表/訓練所授予。
 *  本檔由 PokéAPI 產生器（scripts/gen_dex）寫出，請勿手改；要改招式請改產生器的 MOVE_SPEC / STATUS_MOVES。 */
export const MOVES: Record<number, Move> = {
${moveLines.join('\n')}
}

export function getMove(id: number): Move {
  const m = MOVES[id]
  if (!m) throw new Error(\`Unknown move id: \${id}\`)
  return m
}

/** 安全查招：未知 id 回 undefined（不丟例外）。回放戰報等「不可崩」路徑用（M14.f）。 */
export function findMove(id: number): Move | undefined {
  return MOVES[id]
}
`
writeFileSync(`${OUT}/moves.ts`, movesTs)
console.log(`寫出 moves.ts（${moveLines.length} 招）`)

// ── 學習表 / teachable 降維映射（M19.f）──
// 變化招 id（由 STATUS_MOVES 依 effect 派生，不綁 id）。
const HEAL_ID = STATUS_MOVES.find((m) => m.effect.kind === 'heal').id
const ATK_BUFF_ID = STATUS_MOVES.find((m) => m.effect.kind === 'buff' && m.effect.stat === 'atk').id
const SPA_BUFF_ID = STATUS_MOVES.find((m) => m.effect.kind === 'buff' && m.effect.stat === 'spa').id
const ALL_STATUS_IDS = STATUS_MOVES.map((m) => m.id)

/** 取該種族真實升級級數的第 p 分位（lv 升序）；無資料用 fallback。 */
function levelAt(levels, p, fallback) {
  if (!levels || levels.length === 0) return fallback
  return levels[Math.min(levels.length - 1, Math.floor(p * levels.length))]
}

/** 學習表：slot0@L1 + 各屬性 3 tier 攻擊招（依真實升級節奏分位）+ 變化招（回復 + 攻防取向增益）。 */
function buildLearnset(d, slot0) {
  const lv = d.levelUpLevels
  const entries = new Map() // moveId → 最低 level
  const add = (level, id) => { if (!entries.has(id) || level < entries.get(id)) entries.set(id, level) }
  add(1, slot0)
  const tierLevels = [levelAt(lv, 0.1, 8), levelAt(lv, 0.45, 20), levelAt(lv, 0.8, 36)]
  for (const t of d.types) for (let tier = 0; tier < 3; tier++) add(tierLevels[tier], moveId(t, tier))
  add(levelAt(lv, 0.4, 18), HEAL_ID)
  add(levelAt(lv, 0.7, 30), d.baseStats.atk >= d.baseStats.spa ? ATK_BUFF_ID : SPA_BUFF_ID)
  return [...entries.entries()]
    .map(([mid, level]) => ({ level, moveId: mid }))
    .sort((a, b) => a.level - b.level || a.moveId - b.moveId)
}

/** 可學清單（招式機/教學）：該種族屬性的全 tier 攻擊招 + 全變化招。 */
function buildTeachable(d) {
  const ids = new Set()
  for (const t of d.types) for (let tier = 0; tier < 3; tier++) ids.add(moveId(t, tier))
  for (const id of ALL_STATUS_IDS) ids.add(id)
  return [...ids].sort((a, b) => a - b)
}

// ── 產生 species.ts ──
const bstOf = (b) => b.hp + b.atk + b.def + b.spa + b.spd + b.spe
const specLines = dex.map((d) => {
  const b = d.baseStats
  const mid = moveId(d.types[0], bstTier(bstOf(b)))
  const typesStr = d.types.map((t) => `'${t}'`).join(', ')
  const evo = evoMap.get(d.id)
  const evoStr = evo ? `\n    evolvesTo: ${evo.to}, evolveLevel: ${evo.level},` : ''
  const learnsetStr = buildLearnset(d, mid).map((e) => `{ level: ${e.level}, moveId: ${e.moveId} }`).join(', ')
  const teachStr = buildTeachable(d).join(', ')
  return `  ${d.id}: {\n` +
    `    id: ${d.id}, name: '${d.name}', nameZh: '${d.nameZh}', types: [${typesStr}],\n` +
    `    baseStats: { hp: ${b.hp}, atk: ${b.atk}, def: ${b.def}, spa: ${b.spa}, spd: ${b.spd}, spe: ${b.spe} },\n` +
    `    moveId: ${mid}, artworkUrl: artwork(${d.id}),${evoStr}\n` +
    `    learnset: [${learnsetStr}],\n` +
    `    teachableMoveIds: [${teachStr}],\n` +
    `  },`
}).join('\n')
const speciesTs = `import type { Species } from '@/game/types'

const artwork = (id: number) =>
  \`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/\${id}.png\`

/** 全國圖鑑 1–${MAX_ID}（第一、二世代），由 PokéAPI 產生器寫出。
 *  屬性/種族值/中文名來自 PokéAPI（zh-Hant）；artwork 走官方 raw URL，runtime 載入、不內建。
 *  moveId 依主屬性 + 種族值總和 tier 決定論指派（見 moves.ts）。
 *  learnset/teachableMoveIds（M19.f）：以 PokéAPI 真實升級節奏降維映射到精簡招式池 + 變化招。請勿手改，改請改產生器。 */
export const SPECIES: Record<number, Species> = {
${specLines}
}

export function getSpecies(id: number): Species {
  const s = SPECIES[id]
  if (!s) throw new Error(\`Unknown species id: \${id}\`)
  return s
}
`
writeFileSync(`${OUT}/species.ts`, speciesTs)
console.log(`寫出 species.ts（${dex.length} 隻）`)

// ── 產生 regions.ts（8 個主題區域，覆蓋全 18 型） ──
const byId = new Map(dex.map((d) => [d.id, d]))
// M8 模式 contract：主題區皆 wild（可捕獲）。terrains＝固定地形（單一或混合）。
// randomTerrain:true 的區，terrains 改當「地形池」，開場由 encounter seed 決定論抽 1 個。
const REGION_THEMES = [
  { id: 'verdant-forest', name: '常綠森林', gradient: ['#1f6e43', '#0c3a24'], icon: '🌳', blurb: '蟲與草系出沒的蓊鬱林地，新手最佳起點。', types: ['grass', 'bug'], band: [6, 13], terrains: ['grassland'] },
  { id: 'ember-volcano', name: '灼熱火山', gradient: ['#b3361f', '#5c1208'], icon: '🌋', blurb: '岩漿翻騰的赤紅山體，火系與烈性Mobie的領域。', types: ['fire'], band: [12, 19], terrains: ['volcanic'] },
  { id: 'crystal-shore', name: '澄澈水濱', gradient: ['#1b6fb3', '#0a2f5c'], icon: '🌊', blurb: '清澈海灣與冰涼潮間帶，水、冰系悠游其中。', types: ['water', 'ice'], band: [12, 19], terrains: ['coastal'] },
  { id: 'thunder-plateau', name: '雷鳴高原', gradient: ['#caa42a', '#5c4a06'], icon: '⚡', blurb: '雷雲低垂的開闊高地，電系與飛行系翱翔盤旋。', types: ['electric', 'flying'], band: [16, 23], terrains: ['stormfield'] },
  { id: 'rocky-cavern', name: '岩窟洞穴', gradient: ['#7a5a3a', '#33231a'], icon: '🪨', blurb: '崎嶇地底坑道，岩、地面與格鬥系潛伏其中。', types: ['rock', 'ground', 'fighting'], band: [16, 23], terrains: ['cavern'] },
  { id: 'haunted-tower', name: '幽魂古塔', gradient: ['#4b2d6e', '#1a0e2e'], icon: '👻', blurb: '陰森詭譎的廢棄高塔，幽靈、毒與惡系徘徊。', types: ['ghost', 'poison', 'dark'], band: [20, 27], terrains: ['haunt'] },
  { id: 'mystic-meadow', name: '神秘花圃', gradient: ['#c25b9e', '#5c2347'], icon: '🧚', blurb: '霧氣繚繞的夢幻花原，超能力與妖精系翩翩起舞。', types: ['psychic', 'fairy', 'normal'], band: [20, 27], terrains: ['mystic'] },
  { id: 'dragon-summit', name: '巨龍峰頂', gradient: ['#2c4a8a', '#10182e'], icon: '🐉', blurb: '雲端之上的險峻峰巔，龍、鋼系強敵盤踞的終局試煉。', types: ['dragon', 'steel', 'ice'], band: [26, 34], terrains: ['dragons-peak'] },
  // 混合地形區（M8.b）：兩個 TerrainDef 逐屬性相乘（夾 [0.5,1.5]）
  { id: 'coastal-marsh', name: '海濱濕地', gradient: ['#2f7d8a', '#0c2e33'], icon: '🪷', blurb: '潮間帶與沼澤交錯的濕地，水、草與毒系混居其間。', types: ['water', 'grass', 'poison'], band: [14, 22], terrains: ['coastal', 'grassland'] },
  { id: 'volcanic-cavern', name: '火山岩窟', gradient: ['#8a3a1f', '#2e1208'], icon: '⛰️', blurb: '岩漿滲入地底坑道的灼熱洞窟，火、岩與地面系盤踞。', types: ['fire', 'rock', 'ground'], band: [18, 26], terrains: ['volcanic', 'cavern'] },
  // 隨機地形區（M8.b）：開場從地形池決定論抽 1 個
  { id: 'mirage-realm', name: '幻象之境', gradient: ['#5b3a8a', '#1a1030'], icon: '🌀', blurb: '地形變幻莫測的幻象結界，每次踏入都是未知的場域。', types: ['psychic', 'ghost', 'dragon', 'fairy'], band: [24, 32], randomTerrain: true, terrains: ['mystic', 'haunt', 'dragons-peak', 'sandstorm', 'snowfield', 'flowerfield'] },
]
const weightOf = (bst) => (bst < 350 ? 4 : bst < 430 ? 3 : bst < 510 ? 2 : 1)
const regionBlocks = REGION_THEMES.map((r) => {
  const cands = dex
    .filter((d) => d.types.some((t) => r.types.includes(t)))
    .map((d) => ({ ...d, bst: bstOf(d.baseStats) }))
    .sort((a, b) => a.bst - b.bst)
  // 跨 BST 等距取樣最多 7 隻 + 最強者當 boss tail
  const PICK = Math.min(7, cands.length)
  const picks = []
  for (let i = 0; i < PICK; i++) picks.push(cands[Math.round((i * (cands.length - 1)) / (PICK - 1))])
  const seen = new Set()
  const uniq = picks.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
  const [lo, hi] = r.band
  const enc = uniq.map((p, i) => {
    const frac = uniq.length > 1 ? i / (uniq.length - 1) : 0
    const min = Math.round(lo + (hi - lo) * frac * 0.85)
    return { speciesId: p.id, weight: weightOf(p.bst), minLevel: min, maxLevel: Math.min(hi, min + 3) }
  })
  // boss tail：池中最強者（若未在列），權重 1、略高等級
  const boss = cands[cands.length - 1]
  if (boss && !seen.has(boss.id)) {
    enc.push({ speciesId: boss.id, weight: 1, minLevel: hi, maxLevel: hi + 2 })
  } else {
    // 已含最強者：把它升成 boss 等級
    const e = enc.find((x) => x.speciesId === boss.id)
    if (e) { e.weight = 1; e.minLevel = hi; e.maxLevel = hi + 2 }
  }
  const encLines = enc.map((e) => {
    const nm = byId.get(e.speciesId)?.nameZh ?? ''
    return `      { speciesId: ${e.speciesId}, weight: ${e.weight}, minLevel: ${e.minLevel}, maxLevel: ${e.maxLevel} }, // ${nm}`
  }).join('\n')
  const terrainLine = r.terrains ? `    terrains: [${r.terrains.map((t) => `'${t}'`).join(', ')}],\n` : ''
  const randomLine = r.randomTerrain ? `    randomTerrain: true,\n` : ''
  return `  {\n` +
    `    id: '${r.id}',\n` +
    `    name: '${r.name}',\n` +
    `    mode: 'wild',\n` + // M6 模式 contract：主題區皆為野外（可捕獲）
    terrainLine + // M8 場域地形（固定/混合；randomTerrain 時為地形池）
    randomLine +
    `    gradient: ['${r.gradient[0]}', '${r.gradient[1]}'],\n` +
    `    icon: '${r.icon}',\n` +
    `    blurb: '${r.blurb}',\n` +
    `    encounters: [\n${encLines}\n    ],\n` +
    `  },`
}).join('\n')
const regionsTs = `import type { Region } from '@/game/types'

/** ${REGION_THEMES.length} 個主題化區域（含混合/隨機地形區），等級帶遞增、覆蓋全 18 型；
 *  遭遇表由產生器從 dex 篩出（每區末項為高等 boss）；地形＝M8 場域系統。
 *  請勿手改，改請改產生器的 REGION_THEMES。 */
export const REGIONS: Region[] = [
${regionBlocks}
]

export function getRegion(id: string): Region {
  const r = REGIONS.find((x) => x.id === id)
  if (!r) throw new Error(\`Unknown region id: \${id}\`)
  return r
}
`
writeFileSync(`${OUT}/regions.ts`, regionsTs)
console.log(`寫出 regions.ts（${REGION_THEMES.length} 區）`)

// ── 產生 playerCards.ts（跨屬性起始 roster，~15 隻） ──
const STARTERS = [
  [1, 16, false, null], [4, 16, false, null], [7, 16, false, null],
  [25, 17, true, null], [133, 16, false, null], [66, 16, false, null],
  [92, 16, false, null], [74, 16, false, null], [35, 16, false, null],
  [63, 16, false, null], [81, 16, false, null], [123, 17, false, null],
  [131, 18, false, null], [143, 18, false, null], [147, 18, false, null],
  [198, 17, false, null],
]
const cardLines = STARTERS.filter(([id]) => byId.has(id)).map(([id, lv, shiny]) => {
  const nm = byId.get(id).nameZh
  const sh = shiny ? ', shiny: true' : ''
  return `  { cardId: 'DEV-${id}', speciesId: ${id}, level: ${lv}${sh} }, // ${nm}`
}).join('\n')
const cardsTs = `import type { Card } from '@/game/types'

/**
 * 起始玩家 roster（手牌）。M2 會由掃描實體卡 QR 取代。
 * 跨屬性挑選，讓玩家面對 8 個區域都有屬性相剋的策略選擇。
 * IV/性格由 cardId 決定論 roll（見 individual.ts）。
 */
export const PLAYER_CARDS: Card[] = [
${cardLines}
]
`
writeFileSync(`${OUT}/playerCards.ts`, cardsTs)
console.log(`寫出 playerCards.ts（${STARTERS.length} 張）`)
console.log('完成。')
