import { describe, it, expect } from 'vitest'
import { eventToReportLine, logToReport, makeReportCtx } from './report'
import type { BattleEvent } from '@/game/battle/reducer'
import type { DisplayUnitSnapshot, ReplayLog } from './types'

const SNAP: DisplayUnitSnapshot[] = [
  { instanceId: 'player:0', side: 'player', slot: 0, speciesId: 1, displayName: '妙蛙種子', level: 12, maxHp: 40, initialHp: 40, shiny: false },
  { instanceId: 'foe:0', side: 'foe', slot: 0, speciesId: 4, displayName: '小火龍', level: 11, maxHp: 36, initialHp: 36, shiny: false },
]
const ctx = makeReportCtx(SNAP)
const line = (ev: BattleEvent) => eventToReportLine(ev, ctx)

describe('report — 逐 handler 投影中文', () => {
  it('damageApplied：含招名/傷害/效果標籤', () => {
    const s = line({ type: 'damageApplied', attackerSide: 'player', attackerIndex: 0, targetSide: 'foe', targetIndex: 0, amount: 18, missed: false, crit: true, effectiveness: 2, effectivenessText: '效果絕佳', hpBefore: 36, hpAfter: 18, maxHp: 36 })
    expect(s).toContain('妙蛙種子')
    expect(s).toContain('對 小火龍 造成 18 傷害')
    expect(s).toContain('效果絕佳')
    expect(s).toContain('會心一擊')
  })

  it('damageApplied：未命中', () => {
    expect(line({ type: 'damageApplied', attackerSide: 'player', attackerIndex: 0, targetSide: 'foe', targetIndex: 0, amount: 0, missed: true, crit: false, effectiveness: 1, effectivenessText: null, hpBefore: 36, hpAfter: 36, maxHp: 36 })).toContain('沒有命中')
  })

  it('memberFainted', () => {
    expect(line({ type: 'memberFainted', side: 'foe', index: 0 })).toBe('小火龍 倒下了！')
  })

  it('heal', () => {
    expect(line({ type: 'heal', side: 'player', index: 0, amount: 5, hpBefore: 10, hpAfter: 15, maxHp: 40, source: '剩飯' })).toContain('回復了 5 點 HP')
  })

  it('activeChanged：主動 vs 強制', () => {
    expect(line({ type: 'activeChanged', side: 'player', fromIndex: 0, toIndex: 1, forced: false })).toContain('換上了')
    expect(line({ type: 'activeChanged', side: 'foe', fromIndex: 0, toIndex: 1, forced: true })).toContain('對手')
  })

  it('switchDefenseResolved：依 damageMult 算減傷%', () => {
    expect(line({ type: 'switchDefenseResolved', side: 'player', index: 1, defenseQuality: 'good', damageMult: 0.4 })).toContain('減傷 60%')
  })

  it('battleEnded：自然 vs timeout', () => {
    expect(line({ type: 'battleEnded', winner: 'player' })).toContain('我方獲勝')
    expect(line({ type: 'battleEnded', winner: 'foe', reason: 'timeout' })).toContain('回合數達上限')
  })

  it('random：輪盤投影、accuracy/crit 回 null', () => {
    expect(line({ type: 'random', event: { type: 'supportRoulette', actorId: 'p', roll: 0.1, outcome: 'attackUp', source: 's' } })).toContain('攻擊提升')
    expect(line({ type: 'random', event: { type: 'ballRoulette', actorId: 'p', roll: 0.9, outcome: 'ultra', source: 's' } })).toContain('高級球')
    expect(line({ type: 'random', event: { type: 'accuracy', actorId: 'p', roll: 0.4, outcome: 'hit', source: 's' } })).toBeNull()
  })

  it('chainOpportunity / chainHit', () => {
    expect(line({ type: 'chainOpportunity', maxHits: 3, eligibleIndices: [1, 2] })).toContain('連鎖就緒')
    expect(line({ type: 'chainHit', comboCount: 2, attackerIndex: 1 })).toContain('第 2 段')
  })

  it('wildAccident：地形突變 vs 亂入', () => {
    expect(line({ type: 'wildAccident', kind: 'terrainShift', terrainId: 'coastal' })).toContain('地形')
    expect(line({ type: 'wildAccident', kind: 'intrusion', side: 'player', index: 0, amount: 7, hpAfter: 33 })).toContain('7 點傷害')
  })

  it('statusApplied：buff/heal/terrain 三類', () => {
    expect(line({ type: 'statusApplied', side: 'player', index: 0, moveId: 2000, effectKind: 'buff', label: '攻擊提升', remaining: 4 })).toContain('4 回合')
    expect(line({ type: 'statusApplied', side: 'player', index: 0, moveId: 2003, effectKind: 'heal', label: '回復', remaining: 0, healAmount: 12 })).toContain('回復了 12 點 HP')
    expect(line({ type: 'statusApplied', side: 'player', index: 0, moveId: 2004, effectKind: 'terrain', label: '青草場地', remaining: 0, terrainId: 'grassland' })).toContain('地形')
  })

  it('未知 variant 安全回退 [type]', () => {
    expect(line({ type: 'bogusFutureEvent' } as unknown as BattleEvent)).toBe('[bogusFutureEvent]')
  })

  it('comboCast：合體技投影（M12.d）', () => {
    expect(line({ type: 'comboCast', key: 'steam-burst', name: '蒸氣爆破', icon: '♨️', castKind: 'enemyDebuff', label: '蒸氣爆破', remaining: 3 })).toContain('合體技「蒸氣爆破」')
  })

  it('未知 resolvedMoveId 不丟例外、回退招式#id（回放不可崩）', () => {
    const s = line({ type: 'damageApplied', attackerSide: 'player', attackerIndex: 0, targetSide: 'foe', targetIndex: 0, amount: 5, missed: false, crit: false, effectiveness: 1, effectivenessText: null, hpBefore: 36, hpAfter: 31, maxHp: 36, resolvedMoveId: 999999 })
    expect(s).toContain('招式#999999')
  })
})

describe('report — logToReport 全場', () => {
  it('含開場陣容 + 回合分段', () => {
    const log: ReplayLog = {
      header: { formatVersion: 1, battleId: 'b', battleSeed: 's', createdAt: 0, regionId: 'g', mode: 'wild', outcome: 'win', snapshot: SNAP },
      turns: [
        { input: { type: 'ATTACK' }, events: [{ type: 'damageApplied', attackerSide: 'player', attackerIndex: 0, targetSide: 'foe', targetIndex: 0, amount: 18, missed: false, crit: false, effectiveness: 1, effectivenessText: null, hpBefore: 36, hpAfter: 18, maxHp: 36 }] },
        { input: { type: 'ATTACK' }, events: [{ type: 'memberFainted', side: 'foe', index: 0 }, { type: 'battleEnded', winner: 'player' }] },
      ],
    }
    const txt = logToReport(log)
    expect(txt).toContain('【戰鬥開始】')
    expect(txt).toContain('我方：妙蛙種子')
    expect(txt).toContain('— 第 1 回合 —')
    expect(txt).toContain('— 第 2 回合 —')
    expect(txt).toContain('我方獲勝')
  })
})
