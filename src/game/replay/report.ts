// M14.b — 戰報投影器（plan/15 §6）：把 canonical 事件流投影成人類可讀的正體中文戰報。
// 一 event variant 一 handler、依 type 分派、直吐中文、未知 variant 回退 `[type]`（不丟例外）。
// 純函數鏈，永不反向 parse；handler 可單獨 vitest。

import type { BattleEvent, Side } from '@/game/battle/reducer'
import { getBall, type BallId } from '@/game/battle/engine'
import { findMove } from '@/game/data/moves'
import type { ReplayLog, DisplayUnitSnapshot } from './types'

/** 投影上下文：把 `${side}:${index}` 解析成顯示名。 */
export interface ReportCtx {
  nameOf: (side: Side, index: number) => string
}

const SUPPORT_LABEL: Record<string, string> = {
  attackUp: '攻擊提升',
  crit: '必定會心',
  ally: '隊友支援補刀',
  dud: '沒有發動',
}

/** 由回放 snapshot 建出 ReportCtx（instanceId = `${side}:${slot}`）。 */
export function makeReportCtx(snapshot: DisplayUnitSnapshot[]): ReportCtx {
  const names = new Map<string, string>()
  for (const u of snapshot) names.set(`${u.side}:${u.slot}`, u.displayName)
  return {
    nameOf: (side, index) => names.get(`${side}:${index}`) ?? `${side === 'player' ? '我方' : '對手'}#${index + 1}`,
  }
}

const moveName = (id?: number): string => (id ? findMove(id)?.nameZh ?? `招式#${id}` : '招式')

function renderDamage(ev: Extract<BattleEvent, { type: 'damageApplied' }>, ctx: ReportCtx): string {
  const attacker = ctx.nameOf(ev.attackerSide, ev.attackerIndex)
  const target = ctx.nameOf(ev.targetSide, ev.targetIndex)
  if (ev.missed) return `${attacker} 使出 ${moveName(ev.resolvedMoveId)}，但是沒有命中！`
  const tags: string[] = []
  if (ev.effectivenessText) tags.push(ev.effectivenessText)
  if (ev.crit) tags.push('會心一擊')
  const suffix = tags.length ? `（${tags.join('，')}）` : ''
  return `${attacker} 使出 ${moveName(ev.resolvedMoveId)}，對 ${target} 造成 ${ev.amount} 傷害${suffix}`
}

function renderFaint(ev: Extract<BattleEvent, { type: 'memberFainted' }>, ctx: ReportCtx): string {
  return `${ctx.nameOf(ev.side, ev.index)} 倒下了！`
}

function renderHeal(ev: Extract<BattleEvent, { type: 'heal' }>, ctx: ReportCtx): string {
  return `${ctx.nameOf(ev.side, ev.index)} 回復了 ${ev.amount} 點 HP（${ev.source}）`
}

function renderSwitch(ev: Extract<BattleEvent, { type: 'activeChanged' }>, ctx: ReportCtx): string {
  const who = ev.side === 'player' ? '我方' : '對手'
  const inName = ctx.nameOf(ev.side, ev.toIndex)
  return ev.forced ? `${who}換上了 ${inName}！` : `${who}收回隊友，換上了 ${inName}！`
}

function renderDefense(ev: Extract<BattleEvent, { type: 'switchDefenseResolved' }>, ctx: ReportCtx): string {
  const pct = Math.round((1 - ev.damageMult) * 100)
  const who = ctx.nameOf(ev.side, ev.index)
  return pct > 0 ? `${who}換人防禦，減傷 ${pct}%` : `${who}換人，未能減傷`
}

function renderEnd(ev: Extract<BattleEvent, { type: 'battleEnded' }>): string {
  const who = ev.winner === 'player' ? '我方' : '對手'
  return ev.reason === 'timeout' ? `回合數達上限，依剩餘血量判定 ${who}獲勝！` : `戰鬥結束，${who}獲勝！`
}

function renderRandom(ev: Extract<BattleEvent, { type: 'random' }>): string | null {
  // accuracy/crit 已併入 damageApplied 一行，戰報不重複；只投影輪盤類。
  if (ev.event.type === 'supportRoulette') return `支援輪盤：${SUPPORT_LABEL[ev.event.outcome] ?? ev.event.outcome}`
  if (ev.event.type === 'ballRoulette') return `球輪盤轉出：${getBall(ev.event.outcome as BallId).nameZh}`
  return null
}

function renderChainOpp(ev: Extract<BattleEvent, { type: 'chainOpportunity' }>): string {
  return `🔗 連鎖就緒！可發動最多 ${ev.maxHits} 段連擊`
}

function renderChainHit(ev: Extract<BattleEvent, { type: 'chainHit' }>): string {
  return `連鎖第 ${ev.comboCount} 段！`
}

function renderComboCast(ev: Extract<BattleEvent, { type: 'comboCast' }>): string {
  const effect = ev.castKind === 'infuseTerrain' ? '灌注場域地形' : ev.castKind === 'teamBuff' ? '全隊增益' : '弱化敵方'
  return `${ev.icon} 合體技「${ev.name}」發動！${effect}（${ev.remaining} 回合）`
}

function renderWild(ev: Extract<BattleEvent, { type: 'wildAccident' }>, ctx: ReportCtx): string {
  if (ev.kind === 'terrainShift') return `野外突變！地形改變了`
  const who = ev.side != null && ev.index != null ? ctx.nameOf(ev.side, ev.index) : '場上一隻 Mobie'
  return `亂入的野生 Mobie 給了 ${who} ${ev.amount ?? 0} 點傷害！`
}

function renderStatus(ev: Extract<BattleEvent, { type: 'statusApplied' }>, ctx: ReportCtx): string {
  const who = ctx.nameOf(ev.side, ev.index)
  const base = `${who} 使出 ${moveName(ev.moveId)}`
  if (ev.effectKind === 'heal') return `${base}，回復了 ${ev.healAmount ?? 0} 點 HP`
  if (ev.effectKind === 'terrain') return `${base}，改變了場地地形`
  return `${base}，${ev.label}（${ev.remaining} 回合）`
}

/** 單一 event → 一行中文戰報；null = 不投影（如 accuracy/crit 已併入傷害行）。 */
export function eventToReportLine(ev: BattleEvent, ctx: ReportCtx): string | null {
  switch (ev.type) {
    case 'damageApplied': return renderDamage(ev, ctx)
    case 'memberFainted': return renderFaint(ev, ctx)
    case 'heal': return renderHeal(ev, ctx)
    case 'activeChanged': return renderSwitch(ev, ctx)
    case 'switchDefenseResolved': return renderDefense(ev, ctx)
    case 'battleEnded': return renderEnd(ev)
    case 'random': return renderRandom(ev)
    case 'chainOpportunity': return renderChainOpp(ev)
    case 'chainHit': return renderChainHit(ev)
    case 'comboCast': return renderComboCast(ev)
    case 'wildAccident': return renderWild(ev, ctx)
    case 'statusApplied': return renderStatus(ev, ctx)
    default: return `[${(ev as { type: string }).type}]` // 未知 variant 安全回退
  }
}

/** 全場投影成多行中文戰報（含開場雙方陣容 + 結尾）。 */
export function logToReport(log: ReplayLog): string {
  const ctx = makeReportCtx(log.header.snapshot)
  const lines: string[] = []
  const players = log.header.snapshot.filter((u) => u.side === 'player').map((u) => u.displayName)
  const foes = log.header.snapshot.filter((u) => u.side === 'foe').map((u) => u.displayName)
  lines.push(`【戰鬥開始】我方：${players.join('、')}　VS　對手：${foes.join('、')}`)
  let turnNo = 0
  for (const turn of log.turns) {
    turnNo += 1
    lines.push(`— 第 ${turnNo} 回合 —`)
    for (const ev of turn.events) {
      const line = eventToReportLine(ev, ctx)
      if (line) lines.push(line)
    }
  }
  return lines.join('\n')
}
