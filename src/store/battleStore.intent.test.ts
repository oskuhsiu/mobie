import { mon } from '@/game/battle/testFixtures'
import type { IntroIntent, PartnerSkillResultIntent, TurnResolution } from '@/presentation/battle/contracts'
import { useBattleStore } from './battleStore'

const identity = { battleSessionId: 'battle-intent', resultFingerprint: 'fingerprint-intent' }

const intro: IntroIntent = {
  kind: 'intro',
  id: 'intro',
  foeEntrance: { id: 'intro:foe', message: '對手派出了測試對手！' },
  playerEntrance: { id: 'intro:player', message: '上吧，測試夥伴！' },
  terrain: {
    banner: '🌧️ 場域地形：雨天',
    feed: [{ id: 'intro:terrain', message: '場域地形：🌧️雨天（影響對應屬性招式威力）' }],
  },
  synergy: {
    banner: '✦ 羈絆發動！ 🤝',
    feed: [{ id: 'intro:synergy:0', message: '羈絆：測試羈絆' }],
  },
}

function reset(phase: 'intro' | 'playerChoice' = 'intro') {
  useBattleStore.getState().ensureBattleSession({
    logicalBattleKey: {},
    playerMembers: [mon()],
    foeMembers: [mon()],
    battleSeed: 'seed',
    regionId: 'practice',
    mode: 'arena',
    recordReplay: false,
    snapshot: [],
    createdAt: 1,
    identityFactory: () => identity,
  })
  useBattleStore.getState().setPhase(phase)
}

describe('battleStore intent presentation', () => {
  it('defers an unmounted intent safe point until the same session remounts', () => {
    reset()
    const token = useBattleStore.getState().beginIntentPresentation(intro)!
    useBattleStore.getState().intentPushFeed(token, intro.foeEntrance)

    expect(useBattleStore.getState().cancelIntentOnce(token, 'unmount')).toBe(true)
    expect(useBattleStore.getState().cancelIntentOnce(token, 'unmount')).toBe(false)
    expect(useBattleStore.getState()).toMatchObject({
      phase: 'intro',
      log: [],
      intentPresentation: null,
    })
    expect(useBattleStore.getState().session?.completedIntentIds.has('intro')).toBe(false)

    expect(useBattleStore.getState().completeInterruptedIntentOnce(token)).toBe(true)
    expect(useBattleStore.getState().completeInterruptedIntentOnce(token)).toBe(false)
    expect(useBattleStore.getState()).toMatchObject({
      phase: 'playerChoice',
      log: [
        intro.foeEntrance.message,
        intro.playerEntrance.message,
        intro.terrain?.feed[0]?.message,
        intro.synergy?.feed[0]?.message,
      ],
      choiceFocusRequestId: 1,
    })
    expect(useBattleStore.getState().session?.completedIntentIds.has('intro')).toBe(true)
  })

  it('converges partial and skipped intro playback on one display-only safe point', () => {
    reset()
    useBattleStore.setState({ energy: 37 })
    const before = useBattleStore.getState()
    const canonical = before.battle
    const recorder = before.session?.recorder
    const token = before.beginIntentPresentation(intro)!

    expect(token).toMatchObject({ purpose: 'intent', intentId: 'intro', presentationId: 1 })
    expect(useBattleStore.getState().acquireTurnPresentationToken()).toBeNull()
    useBattleStore.getState().intentPushFeed(token, intro.foeEntrance)
    expect(useBattleStore.getState().intentPresentation?.log).toEqual([intro.foeEntrance.message])
    expect(useBattleStore.getState().log).toEqual([])

    const stale = { ...token, presentationId: token.presentationId + 1 }
    useBattleStore.getState().intentPushFeed(stale, { id: 'stale', message: '不應寫入' })
    expect(useBattleStore.getState().completeIntentOnce(stale)).toBe(false)
    expect(useBattleStore.getState().completeIntentOnce(token)).toBe(true)
    expect(useBattleStore.getState().completeIntentOnce(token)).toBe(false)

    const after = useBattleStore.getState()
    expect(after).toMatchObject({
      battle: canonical,
      phase: 'playerChoice',
      energy: 37,
      choiceFocusRequestId: 1,
      intentPresentation: null,
    })
    expect(after.log).toEqual([
      intro.foeEntrance.message,
      intro.playerEntrance.message,
      intro.terrain?.feed[0]?.message,
      intro.synergy?.feed[0]?.message,
    ])
    expect(after.session).toMatchObject({ rngCursor: 0, endSent: false })
    expect(after.session?.recorder).toBe(recorder)
    expect(after.session?.recorder.build('win')).toBeNull()
    expect(after.session?.completedIntentIds.has('intro')).toBe(true)
    expect(after.beginIntentPresentation(intro)).toBeNull()

    if (false) {
      // @ts-expect-error Intent tokens cannot reach the canonical turn commit seam.
      after.commitTurn(token, {} as TurnResolution)
    }
  })

  it('commits Partner gameplay once before presenting its display-only receipt', () => {
    reset('playerChoice')
    useBattleStore.setState({ energy: 52 })
    const canonical = useBattleStore.getState().battle!
    const turn = canonical.turn
    const intent: PartnerSkillResultIntent = {
      kind: 'partner-result',
      id: 'partner:rally',
      skillId: 'rally',
      banner: '📣 訓練師加油！',
      feed: { id: 'partner:rally:result', message: '訓練師加油！全隊氣勢提升（攻擊・特攻 ↑）' },
      effects: ['reveal-foe', 'team-status'],
    }
    expect(useBattleStore.getState().beginIntentPresentation(intent)).toBeNull()
    const receipt = useBattleStore.getState().commitPartnerSkillOnce({
      skillId: 'rally',
      revealFoeIndex: 0,
      teamStatuses: [{ stat: 'atk', mult: 1.2, remaining: 3, source: -1, label: '訓練師加油' }],
    })

    expect(receipt).toEqual({ skillId: 'rally', revealedFoeIndex: 0, teamStatusCount: 1 })
    const committed = useBattleStore.getState()
    expect(committed.battle?.turn).toBe(turn)
    expect(committed.battle?.field.teamStatuses).toHaveLength(1)
    expect(committed.revealedFoes).toEqual([0])
    expect(committed.energy).toBe(52)
    expect(committed.session?.partnerSkillIdsUsed.has('rally')).toBe(true)
    expect(committed.commitPartnerSkillOnce({ skillId: 'rally', teamStatuses: [] })).toBeNull()

    const token = committed.beginIntentPresentation(intent)!
    expect(useBattleStore.getState()).toMatchObject({ phase: 'busy', battle: committed.battle, energy: 52 })
    expect(useBattleStore.getState().completeIntentOnce(token)).toBe(true)
    expect(useBattleStore.getState()).toMatchObject({ phase: 'playerChoice', battle: committed.battle, energy: 52 })
    expect(useBattleStore.getState().log).toEqual([intent.feed.message])
    expect(useBattleStore.getState().session).toMatchObject({ rngCursor: 0, endSent: false })
  })
})
