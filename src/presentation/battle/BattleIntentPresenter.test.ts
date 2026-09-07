import { BattleDirector } from './BattleDirector'
import { RealPresentationClock } from './PresentationClock'
import { BattleIntentPresenter, type BattleIntentDisplayPort } from './BattleIntentPresenter'
import type { IntentPresentationJob, IntentPresentationToken } from './contracts'

const token: IntentPresentationToken = {
  battleSessionId: 'battle',
  resultFingerprint: 'fingerprint',
  presentationId: 9,
  purpose: 'intent',
  intentId: 'partner:reveal',
}

describe('BattleIntentPresenter failure boundary', () => {
  it('lets the shared Director degrade a display failure and reset once', async () => {
    const calls: string[] = []
    const display: BattleIntentDisplayPort = {
      setBanner: (message) => { calls.push(`banner:${message ?? 'clear'}`) },
      appendFeed: (entry) => { calls.push(`feed:${entry.id}`) },
      playPartnerEffect: () => { throw new Error('effect unavailable') },
    }
    const presenter = new BattleIntentPresenter({ display })
    const director = new BattleDirector({
      handler: { play: async () => undefined },
      intentHandler: presenter,
      lifecycle: {
        degraded: (_error, job) => { calls.push(`degraded:${job.kind}`) },
        reset: (job) => { calls.push(`reset:${job.kind}`) },
      },
    })
    const job: IntentPresentationJob = {
      kind: 'intent',
      token,
      visualSeed: 'partner-seed',
      snapshot: {
        player: { members: [], activeIndex: 0 },
        foe: { members: [], activeIndex: 0 },
        terrainIds: [],
        sideStatuses: { player: [], foe: [] },
        fieldMarks: [],
      },
      intent: {
        kind: 'partner-result',
        id: 'partner:reveal',
        skillId: 'reveal',
        banner: 'Reveal',
        feed: { id: 'reveal-feed', message: 'Revealed' },
        effects: ['reveal-foe'],
      },
    }

    await expect(director.present(job, new AbortController().signal)).resolves.toBe('degraded')
    expect(calls).toEqual([
      'banner:Reveal',
      'feed:reveal-feed',
      'degraded:intent',
      'reset:intent',
    ])
  })

  it.each([false, true])('sequences switch display callbacks with abort=%s', async abort => {
    const calls: string[] = []
    const controller = new AbortController()
    const clock = new RealPresentationClock()
    const switchToken: IntentPresentationToken = { ...token, intentId: 'switch:9' }
    const context = {
      token: switchToken, signal: controller.signal,
      clock: {
        race: clock.race.bind(clock),
        wait: (ms: number, signal: AbortSignal) => {
          calls.push(`wait:${ms}`)
          return abort ? clock.race(new Promise<void>(() => undefined), signal) : Promise.resolve()
        },
      },
    }
    const presenter = new BattleIntentPresenter({ display: {
      setBanner: () => { throw new Error('switch must not show a banner') },
      appendFeed: () => { throw new Error('switch must not append history') },
      playPartnerEffect: () => { throw new Error('switch must not run partner effects') },
      prepareSwitch: received => { expect(received).toBe(context); calls.push('prepare') },
      frameSwitch: received => { expect(received).toBe(context); calls.push('frame') },
    } })
    const playing = presenter.play({
      kind: 'intent', token: switchToken, visualSeed: 'switch',
      intent: { kind: 'switch-prelude', id: 'switch:9' },
      snapshot: {
        player: { members: [], activeIndex: 0 }, foe: { members: [], activeIndex: 0 },
        terrainIds: [], sideStatuses: { player: [], foe: [] }, fieldMarks: [],
      },
    }, context)
    if (abort) {
      controller.abort('unmount')
      await expect(playing).rejects.toMatchObject({ name: 'AbortError' })
      expect(calls).toEqual(['prepare', 'wait:300'])
    } else {
      await playing
      expect(calls).toEqual(['prepare', 'wait:300', 'frame', 'wait:120'])
    }
  })

})
