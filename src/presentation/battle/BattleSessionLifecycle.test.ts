import { BattleSessionLifecycle, type BattleSessionLifecycleResources } from './BattleSessionLifecycle'
import type { IntentPresentationToken, TurnPresentationToken } from './contracts'

const sessionA = { battleSessionId: 'a', resultFingerprint: 'a-fp' }
const sessionB = { battleSessionId: 'b', resultFingerprint: 'b-fp' }
const turnA: TurnPresentationToken = { ...sessionA, presentationId: 1, purpose: 'turn' }
const intentB: IntentPresentationToken = {
  ...sessionB, presentationId: 1, purpose: 'intent', intentId: 'intro',
}

function resources(calls: string[]): BattleSessionLifecycleResources {
  return {
    cancelSession: (token, reason) => { calls.push(`session.cancel:${token.battleSessionId}:${reason}`) },
    cancelPresentation: (token, reason) => { calls.push(`${token.purpose}.cancel:${reason}`) },
    resetPresentation: (token) => { calls.push(`visual.reset:${token.battleSessionId}`) },
    pausePresentation: (token) => { calls.push(`director.pause:${token.battleSessionId}`) },
    resumePresentation: (token) => { calls.push(`director.resume:${token.battleSessionId}`) },
    sfx: {
      begin: (token) => { calls.push(`sfx.begin:${token.battleSessionId}`) },
      pause: (token) => { calls.push(`sfx.pause:${token.battleSessionId}`) },
      resume: (token) => { calls.push(`sfx.resume:${token.battleSessionId}`) },
      cancel: (token) => { calls.push(`sfx.cancel:${token.battleSessionId}`) },
      complete: (token) => { calls.push(`sfx.complete:${token.battleSessionId}`) },
      release: (token) => { calls.push(`sfx.release:${token.battleSessionId}`) },
    },
    bgm: {
      acquire: (token) => { calls.push(`bgm.acquire:${token.battleSessionId}`) },
      pause: (token) => { calls.push(`bgm.pause:${token.battleSessionId}`) },
      resume: (token) => { calls.push(`bgm.resume:${token.battleSessionId}`) },
      release: (token) => { calls.push(`bgm.release:${token.battleSessionId}`) },
    },
  }
}

describe('BattleSessionLifecycle', () => {
  it('pauses and resumes only the active session presentation', () => {
    const calls: string[] = []
    const lifecycle = new BattleSessionLifecycle(resources(calls))
    lifecycle.activate(sessionA)
    expect(lifecycle.beginPresentation(turnA)).toBe(true)
    lifecycle.setHidden(true)
    lifecycle.setHidden(false)

    expect(calls).toEqual([
      'bgm.acquire:a', 'sfx.begin:a', 'director.resume:a',
      'bgm.pause:a', 'director.pause:a', 'sfx.pause:a',
      'bgm.resume:a', 'director.resume:a', 'sfx.resume:a',
    ])
  })

  it('makes late A cleanup a no-op after B activation', () => {
    const calls: string[] = []
    const lifecycle = new BattleSessionLifecycle(resources(calls))
    lifecycle.activate(sessionA)
    lifecycle.beginPresentation(turnA)
    lifecycle.activate(sessionB)
    lifecycle.beginPresentation(intentB)
    const beforeLateA = [...calls]
    expect(beforeLateA).toContain('turn.cancel:superseded')

    expect(lifecycle.finishPresentation(turnA)).toBe(false)
    expect(lifecycle.end(sessionA, 'unmount')).toBe(false)
    expect(calls.slice(beforeLateA.length)).toEqual([
      'session.cancel:a:unmount', 'sfx.release:a', 'bgm.release:a',
    ])
    expect(lifecycle.snapshot()).toMatchObject({ session: sessionB, presentation: intentB })
  })
})
