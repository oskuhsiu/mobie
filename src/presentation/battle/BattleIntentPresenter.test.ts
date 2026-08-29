import { BattleDirector } from './BattleDirector'
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
})
