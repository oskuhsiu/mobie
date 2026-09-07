import { audio } from '@/audio/audioEngine'
import { battleAudioSession } from '@/audio/battleAudioSession'
import type { BattleEventCue, CueContext, EventScenePort } from '@/presentation/battle/contracts'
import { resolveMoveRecipe } from '@/presentation/battle/moveRecipe'
import type { Side, SupportOutcome } from '@/game/battle/reducer'
import type { Move } from '@/game/types'
import { getMove } from '@/game/data/moves'
import { lookupTerrain } from '@/game/data/terrains'
import { getItem } from '@/game/ext/items'
import { getAbility } from '@/game/ext/abilities'
import { haptic } from '@/input/haptics'
import type { BattleSceneHandle } from '@/scene/battle/contracts'
import type { FxHandle } from '@/scene/fx/FxCanvas'
import { playMoveFx, resolveFx } from '@/scene/fx/fxCatalog'
import type { VfxCue } from '@/scene/r3f/vfxRuntime'
import { useBattleStore } from '@/store/battleStore'
import type { DamageNumbersHandle } from '@/ui/components/DamageNumbers'

interface EventVisuals {
  owns(context: CueContext): boolean
  scene(): BattleSceneHandle | null
  fx(): FxHandle | null
  damage(): DamageNumbersHandle | null
  position(side: Side, anchor: 'cast' | 'impact'): { nx: number; ny: number }
  reducedMotion(): boolean
  enabled(): boolean
  switchPrepared(index: number): boolean
  trace(cue: BattleEventCue, context: CueContext, stage: 'cue' | 'audio' | 'feed', detail: string): void
}
export const SUPPORT_LABEL: Record<SupportOutcome, string> = {
  attackUp: '⚡ 攻擊力上升！', crit: '🎯 必定會心！', ally: '🤝 夥伴補刀！', dud: '… 可惜，摃龜',
}

/** Synchronous scene/HUD adapters only; all waits and safe-point ordering live in the Director handler. */
export function createBattleEventPorts(v: EventVisuals): EventScenePort {
  const store = useBattleStore.getState
  const banner = (ctx: CueContext, text: string | null) => store().presentationSetBanner(ctx.token, text)
  const sound = (cue: BattleEventCue, ctx: CueContext, name: Parameters<typeof audio.play>[0]) => {
    if (ctx.skipping || !v.owns(ctx)) return
    battleAudioSession.play(ctx.token, () => audio.play(name))
    v.trace(cue, ctx, 'audio', name)
  }
  const feed = (cue: BattleEventCue, ctx: CueContext, text: string) => {
    store().presentationPushFeed(ctx.token, { id: `${cue.id}:result`, kind: 'result', text })
    v.trace(cue, ctx, 'feed', 'result')
  }
  const member = (cue: BattleEventCue, side: Side, index: number) => cue.before[side].members[index]
  const name = (cue: BattleEventCue, side: Side, index: number) => `${side === 'foe' ? '對手的 ' : ''}${member(cue, side, index).nameZh}`
  const statusMove = (cue: BattleEventCue): Move | null => {
    const e = cue.event
    if (e.type === 'statusApplied') return member(cue, e.side, e.index).moves.find(m => m.id === e.moveId) ?? getMove(e.moveId)
    if (e.type === 'heal') return { ...member(cue, e.side, e.index).move, power: 0, category: 'status', effect: { kind: 'heal', label: '回復體力' } }
    if (e.type === 'comboCast') return { ...cue.before.player.members[cue.before.player.activeIndex].move,
      power: 0, category: 'status', effect: { kind: e.castKind === 'infuseTerrain' ? 'terrain' : 'buff',
        mult: e.castKind === 'enemyDebuff' ? 0.8 : 1.4, label: e.label } }
    return null
  }
  const aura = (cue: BattleEventCue, ctx: CueContext, phase: VfxCue['phase']) => {
    const move = statusMove(cue)
    if (!move || ctx.skipping || !v.enabled()) return false
    const e = cue.event
    const side = 'side' in e && e.side ? e.side : 'player'
    return v.scene()?.tracer?.({ cueId: cue.id, owner: `${ctx.token.battleSessionId}:${ctx.token.presentationId}`,
      caster: side, target: e.type === 'comboCast' && e.castKind === 'enemyDebuff' ? 'foe' : side,
      recipe: 'status', phase, didHit: true, presentation: resolveMoveRecipe(move) }) ?? false
  }
  return {
    begin(cue, ctx) {
      if (!v.owns(ctx)) return
      const e = cue.event
      v.trace(cue, ctx, 'cue', `${e.type}:begin`)
      if (ctx.skipping) return
      if (e.type === 'activeChanged') {
        if (!e.forced && !v.switchPrepared(e.toIndex)) v.scene()?.recall?.(e.side)
        banner(ctx, e.forced ? '夥伴即將接替上場' : '召回夥伴…')
      } else if (e.type === 'chainHit') {
        store().presentationSetCombo(ctx.token, e.comboCount)
        store().presentationSetActiveIndex(ctx.token, 'player', e.attackerIndex)
        v.scene()?.enter('player')
        banner(ctx, `🔗 第 ${e.comboCount} 段：${member(cue, 'player', e.attackerIndex).nameZh}`)
      } else if (e.type === 'comboCast') {
        banner(ctx, `${e.icon} 合體技「${e.name}」！`)
        if (v.enabled()) v.fx()?.converge({ ...v.position('player', 'cast'), color: '#ffe14a', count: 16 })
        sound(cue, ctx, 'select')
      } else if (e.type === 'statusApplied') {
        banner(ctx, `${name(cue, e.side, e.index)} 使出 ${statusMove(cue)!.nameZh}！`)
        aura(cue, ctx, 'anticipate')
        sound(cue, ctx, 'select')
      } else if (e.type === 'heal') {
        banner(ctx, `＋ ${name(cue, e.side, e.index)} 回復體力`)
      } else if (e.type === 'wildAccident') {
        banner(ctx, e.kind === 'terrainShift' ? '◎ 場域正在改變…' : '💥 野生夥伴亂入！')
        if (v.enabled()) v.fx()?.ring({ nx: 0.5, ny: 0.5, color: '#aab9d9' })
      } else if (e.type === 'random') {
        banner(ctx, '支援輪盤…')
        sound(cue, ctx, 'select')
      }
    },
    cast(cue, ctx) {
      if (!v.owns(ctx) || ctx.skipping) return
      aura(cue, ctx, 'cast')
    },
    apply(cue, ctx) {
      if (!v.owns(ctx)) return
      const e = cue.event
      const visual = !ctx.skipping
      store().presentationApplyEvent(ctx.token, e)
      const move = statusMove(cue)
      if (move && visual && !aura(cue, ctx, 'impact') && v.enabled()) {
        const side = 'side' in e && e.side ? e.side : 'player'
        const target = e.type === 'comboCast' && e.castKind === 'enemyDebuff' ? 'foe' : side
        playMoveFx(v.fx(), resolveFx(move), v.position(side, 'cast'), v.position(target, 'impact'), { reducedMotion: v.reducedMotion() })
      }
      switch (e.type) {
        case 'memberFainted': {
          store().presentationSetMemberHp(ctx.token, e.side, e.index, 0)
          if (visual) { v.scene()?.faint(e.side); haptic('faint') }
          sound(cue, ctx, 'faint')
          feed(cue, ctx, `${name(cue, e.side, e.index)} 倒下了！`)
          break
        }
        case 'heal': {
          store().presentationSetMemberHp(ctx.token, e.side, e.index, e.hpAfter)
          const source = getItem(e.source) ?? getAbility(e.source)
          const text = `＋ ${name(cue, e.side, e.index)} 回復 ${e.amount} HP（${source?.name ?? e.source}）`
          banner(ctx, text); feed(cue, ctx, text); sound(cue, ctx, 'super')
          break
        }
        case 'statusApplied': {
          if (e.effectKind === 'heal' && e.hpAfter != null) store().presentationSetMemberHp(ctx.token, e.side, e.index, e.hpAfter)
          const label = e.effectKind === 'heal' ? `＋ ${e.label}　+${e.healAmount ?? 0} HP`
            : e.effectKind === 'terrain' ? `◎ 場域：${e.label}`
            : `${(move?.effect?.mult ?? 1) < 1 ? '▼' : '▲'} ${e.label}（${e.remaining} 回合）`
          banner(ctx, label); feed(cue, ctx, `${name(cue, e.side, e.index)}：${label}`)
          sound(cue, ctx, 'super')
          break
        }
        case 'activeChanged': {
          store().presentationSetActiveIndex(ctx.token, e.side, e.toIndex)
          if (visual) v.scene()?.enter(e.side)
          const entering = name(cue, e.side, e.toIndex)
          const text = e.forced ? `${entering} 因夥伴倒下自動上場` : `${entering} 換上場`
          if (e.forced) store().presentationSetCommandNotice(ctx.token, { kind: 'forced-switch', text })
          banner(ctx, text); feed(cue, ctx, text); sound(cue, ctx, 'switch')
          break
        }
        case 'wildAccident': {
          if (e.kind === 'terrainShift' && e.terrainId) {
            const text = `◎ 地形突變！場域變為 ${lookupTerrain(e.terrainId)?.name ?? e.terrainId}`
            banner(ctx, text); feed(cue, ctx, text); sound(cue, ctx, 'super')
          } else if (e.side != null && e.index != null && e.hpAfter != null) {
            const amount = e.amount ?? 0
            const pos = v.position(e.side, 'impact')
            store().presentationSetMemberHp(ctx.token, e.side, e.index, e.hpAfter)
            if (visual && amount > 0) {
              store().presentationShowHit(ctx.token, { target: e.side, amount, crit: false, effText: null, missed: false })
              if (v.enabled()) {
                v.damage()?.spawn({ ...pos, amount, crit: false, effectiveness: 1, missed: false })
                v.fx()?.burst({ ...pos, color: '#ff9a3c', count: 12, kind: 'puff' })
              }
              v.scene()?.hitReact(e.side); haptic('hit')
            }
            const text = `💥 亂入野生襲擊 ${name(cue, e.side, e.index)}（-${amount}）`
            banner(ctx, text); feed(cue, ctx, text); sound(cue, ctx, 'hit')
          }
          break
        }
        case 'switchDefenseResolved': {
          const pct = Math.round((1 - e.damageMult) * 100)
          const label = e.defenseQuality === 'perfect' ? '完美防禦！' : e.defenseQuality === 'good' ? '防禦成功！' : e.defenseQuality === 'normal' ? '勉強防禦' : '防禦失敗…'
          banner(ctx, `${label}　減傷 ${pct}%`); feed(cue, ctx, `${label}（減傷 ${pct}%）`)
          break
        }
        case 'random': {
          const outcome = e.event.outcome as SupportOutcome
          if (visual) store().presentationSetSupport(ctx.token, outcome)
          feed(cue, ctx, `支援輪盤：${SUPPORT_LABEL[outcome]}`)
          sound(cue, ctx, outcome === 'dud' ? 'select' : 'super')
          break
        }
        case 'chainOpportunity': banner(ctx, '🔗 連鎖就緒！'); feed(cue, ctx, '連鎖槽集滿！可發動連鎖攻擊'); sound(cue, ctx, 'super'); break
        case 'chainHit': break // The next damageApplied owns the only impact.
        case 'comboCast': {
          const effect = e.castKind === 'infuseTerrain' ? '灌注場域' : e.castKind === 'teamBuff' ? '全隊增益' : '弱化敵方'
          feed(cue, ctx, `${e.icon} 合體技「${e.name}」發動：${effect}（${e.remaining} 回合）`)
          sound(cue, ctx, 'super')
          break
        }
      }
      v.trace(cue, ctx, 'cue', `${e.type}:apply`)
    },
    clear(cue, ctx) {
      if (!v.owns(ctx)) return
      aura(cue, ctx, 'recover')
      // Keep the participant counter through its following damage cue.
      if (cue.event.type !== 'chainHit') store().presentationClearTransient(ctx.token)
    },
  }
}
