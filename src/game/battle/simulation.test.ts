// 模擬戰鬥壓力測試：用 seeded RNG 把上百場「完整對戰」從頭打到分出勝負，
// 每一步驗證戰鬥不變式（HP 邊界 / 無 NaN / activeIndex 合法 / 必定終局），
// 並交叉驗證「模組全關（純 M1.x）」與「M7 三模組全開」皆不會炸、結果決定論。
import { describe, it, expect } from 'vitest'
import type { BattlePokemon, Card } from '@/game/types'
import { buildBattlePokemon } from '@/game/stats'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { REGIONS } from '@/game/data/regions'
import { PRACTICE_REGION } from '@/game/data/practiceRegion'
import { rollEncounterTeam } from '@/game/encounter'
import {
  resolveTurn,
  createBattleState,
  MAX_TURNS,
  type BattleState,
  type BattleAction,
  type BattleEvent,
} from '@/game/battle/reducer'
import { assembleExt, assembleBattlePrep, applyBattlePrep } from '@/store/ext'
import { defaultSettings, type GameSettings } from '@/game/settings'
import { MODULE_IDS } from '@/game/settings'
import type { QteQuality } from '@/game/battle/engine'

// ── 本地決定論 RNG（測試自有，不依賴 individual 內部）──────────────
function makeRng(seedStr: string): () => number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const allOnSettings = (): GameSettings => {
  const s = defaultSettings()
  for (const id of MODULE_IDS) s.modules[id] = true
  return s
}

const QUALITIES: QteQuality[] = ['perfect', 'good', 'normal', 'weak']

// 不變式檢查：對任一戰鬥態與其 events
function checkInvariants(state: BattleState, events: BattleEvent[]): void {
  for (const side of ['player', 'foe'] as const) {
    const s = state[side]
    expect(Number.isInteger(s.activeIndex)).toBe(true)
    expect(s.activeIndex).toBeGreaterThanOrEqual(0)
    expect(s.activeIndex).toBeLessThan(s.members.length)
    for (const m of s.members) {
      expect(Number.isFinite(m.currentHp)).toBe(true)
      expect(m.currentHp).toBeGreaterThanOrEqual(0) // 不會打成負血
      expect(m.currentHp).toBeLessThanOrEqual(m.maxHp) // 不會超過上限（含剩飯回血夾頂）
    }
  }
  expect(state.turn).toBeGreaterThan(0)
  for (const e of events) {
    if (e.type === 'damageApplied') {
      expect(e.amount).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(e.amount)).toBe(true)
      expect(e.hpAfter).toBeGreaterThanOrEqual(0)
      expect(e.hpAfter).toBeLessThanOrEqual(e.maxHp)
    }
    if (e.type === 'heal') {
      expect(e.amount).toBeGreaterThanOrEqual(0)
      expect(e.hpAfter).toBeLessThanOrEqual(e.maxHp)
      expect(e.hpAfter).toBeGreaterThanOrEqual(e.hpBefore)
    }
  }
}

interface SimResult {
  winner: 'player' | 'foe'
  turns: number
  totalDamage: number
  switches: number
  starStrikes: number
}

// 跑完一整場：玩家以 seeded rng 隨機行動（多數攻擊、偶爾換人/星擊），直到分出勝負。
function playBattle(seedStr: string, foeCards: Card[], playerCards: Card[], withExt: boolean): SimResult {
  const rng = makeRng(seedStr)
  const settings = withExt ? allOnSettings() : defaultSettings()
  const prep = assembleBattlePrep(settings)
  const ext = assembleExt(settings)

  const { team: players } = applyBattlePrep(playerCards.map(buildBattlePokemon), prep, true)
  const { team: foes } = applyBattlePrep(foeCards.map(buildBattlePokemon), prep, false)

  let state = createBattleState(players, foes)
  let totalDamage = 0
  let switches = 0
  let starStrikes = 0
  let guard = 0

  while (state.winner === null && guard < MAX_TURNS + 10) {
    guard++
    const r = rng()
    let action: BattleAction
    // 約 12% 嘗試換人（若有可換的存活隊友），約 6% 星擊，其餘普攻
    const benchIdx = state.player.members.findIndex(
      (m, i) => i !== state.player.activeIndex && m.currentHp > 0,
    )
    if (r < 0.12 && benchIdx >= 0) {
      action = { type: 'SWITCH', index: benchIdx, defenseQuality: QUALITIES[Math.floor(rng() * 4)] }
      switches++
    } else if (r < 0.18) {
      action = { type: 'ATTACK', starStrike: true }
      starStrikes++
    } else {
      action = { type: 'ATTACK', quality: QUALITIES[Math.floor(rng() * 4)], mashCount: Math.floor(rng() * 25) }
    }

    const { nextState, events } = resolveTurn(state, action, { rng, ext })
    checkInvariants(nextState, events)
    for (const e of events) if (e.type === 'damageApplied') totalDamage += e.amount
    state = nextState
  }

  expect(state.winner, `seed ${seedStr} 未在上限內終局`).not.toBeNull()
  return { winner: state.winner!, turns: state.turn, totalDamage, switches, starStrikes }
}

// 取 3 隻玩家卡（依 seed 旋轉，覆蓋不同組合）
function pickPlayers(offset: number): Card[] {
  const n = PLAYER_CARDS.length
  return [PLAYER_CARDS[offset % n], PLAYER_CARDS[(offset + 1) % n], PLAYER_CARDS[(offset + 2) % n]]
}

describe('模擬戰鬥壓力測試（大量完整對戰）', () => {
  const allRegions = [...REGIONS, PRACTICE_REGION]
  const SEEDS_PER = 18

  it(`每區域 × ${SEEDS_PER} seed × 模組(關/開)：全部終局且不變式不破`, () => {
    let battles = 0
    let extWins = 0
    for (let ri = 0; ri < allRegions.length; ri++) {
      const region = allRegions[ri]
      for (let s = 0; s < SEEDS_PER; s++) {
        const seed = `${region.id}#${s}`
        const foeCards = rollEncounterTeam(region, 3, makeRng('foe-' + seed))
        const players = pickPlayers(ri + s)
        // 模組全關（純 M1.x）
        const off = playBattle(seed, foeCards, players, false)
        expect(off.turns).toBeLessThanOrEqual(MAX_TURNS + 1)
        // 模組全開（M7：羈絆/道具/特性/…）
        const on = playBattle(seed, foeCards, players, true)
        expect(on.turns).toBeLessThanOrEqual(MAX_TURNS + 1)
        if (on.winner === 'player') extWins++
        battles += 2
      }
    }
    // 跑了夠多場（大量），且至少有相當比例的勝負分布（非全平/全敗的退化）
    expect(battles).toBeGreaterThanOrEqual(allRegions.length * SEEDS_PER * 2)
    expect(extWins).toBeGreaterThan(0)
  })

  it('決定論：同 seed 同輸入 → 同結果（reducer 純函數）', () => {
    const region = REGIONS[0]
    const foeCards = rollEncounterTeam(region, 3, makeRng('det-foe'))
    const players = pickPlayers(2)
    const a = playBattle('det#1', foeCards, players, true)
    const b = playBattle('det#1', foeCards, players, true)
    expect(a).toEqual(b)
  })

  it('至少觸發過換人與星擊路徑（行動分支都被走到）', () => {
    let switches = 0
    let stars = 0
    const region = REGIONS[1]
    for (let s = 0; s < 30; s++) {
      const foeCards = rollEncounterTeam(region, 3, makeRng('br-foe-' + s))
      const res = playBattle('branch#' + s, foeCards, pickPlayers(s), true)
      switches += res.switches
      stars += res.starStrikes
    }
    expect(switches).toBeGreaterThan(0)
    expect(stars).toBeGreaterThan(0)
  })
})

describe('模擬戰鬥 · 邊界情境', () => {
  it('完全免疫（一般 vs 純幽靈）也必定終局（走 MAX_TURNS 剩餘血量判定）', () => {
    // 強制一隊一般招打純幽靈：傷害恆 0 → 自然不會 KO → 必須靠 timeout 判勝
    const ghost = (): BattlePokemon => buildBattlePokemon({ cardId: 'g', speciesId: 92, level: 20 }) // 鬼斯=ghost/poison
    const normalAtk = (): BattlePokemon => {
      const m = buildBattlePokemon({ cardId: 'n', speciesId: 133, level: 20 }) // 伊布=normal
      return m
    }
    // 玩家 3 隻一般、對手 3 隻幽靈
    const players = [normalAtk(), normalAtk(), normalAtk()]
    const foes = [ghost(), ghost(), ghost()]
    let state = createBattleState(players, foes)
    const rng = makeRng('immune')
    let guard = 0
    while (state.winner === null && guard < MAX_TURNS + 10) {
      guard++
      const { nextState, events } = resolveTurn(state, { type: 'ATTACK', quality: 'good' }, { rng })
      checkInvariants(nextState, events)
      state = nextState
    }
    expect(state.winner).not.toBeNull()
    expect(state.turn).toBeGreaterThan(MAX_TURNS) // 確實是打到上限才判定
  })

  it('一拳必殺：極高傷一回合內可推進到終局而不破不變式', () => {
    const rng = makeRng('ohko')
    // 高等打低等，星擊 ×3 必會心 → 快速 KO
    const players = [buildBattlePokemon({ cardId: 'p', speciesId: 6, level: 60 })] // 噴火龍
    const foes = [buildBattlePokemon({ cardId: 'f', speciesId: 10, level: 3 })] // 綠毛蟲
    let state = createBattleState(players, foes)
    let guard = 0
    while (state.winner === null && guard < 40) {
      guard++
      const { nextState, events } = resolveTurn(state, { type: 'ATTACK', starStrike: true }, { rng })
      checkInvariants(nextState, events)
      state = nextState
    }
    expect(state.winner).toBe('player')
  })
})
