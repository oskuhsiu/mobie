import type {
  BattleSessionToken,
  CancelReason,
  PresentationToken,
} from './contracts'
import { sameBattleSession, samePresentationToken } from './battleIdentity'

export type BattleSessionEndReason = 'retry' | 'leave' | 'unmount' | 'superseded' | 'outcome'

export interface BattleSessionLifecycleResources {
  cancelSession(token: BattleSessionToken, reason: CancelReason): void
  cancelPresentation(token: PresentationToken, reason: CancelReason): void
  resetPresentation(token: PresentationToken): void
  pausePresentation(token: PresentationToken): void
  resumePresentation(token: PresentationToken): void
  sfx: {
    begin(token: PresentationToken): void
    pause(token: PresentationToken): void
    resume(token: PresentationToken): void
    cancel(token: PresentationToken): void
    complete(token: PresentationToken): void
    release(token: BattleSessionToken): void
  }
  bgm: {
    acquire(token: BattleSessionToken): void
    pause(token: BattleSessionToken): void
    resume(token: BattleSessionToken): void
    release(token: BattleSessionToken): void
  }
}

/** Owns volatile resources only; canonical battle mutation remains in battleStore/turn coordinator. */
export class BattleSessionLifecycle {
  private session: BattleSessionToken | null = null
  private presentation: PresentationToken | null = null
  private hidden = false

  constructor(private readonly resources: BattleSessionLifecycleResources) {}

  activate(token: BattleSessionToken): void {
    if (sameBattleSession(this.session, token)) return
    const previous = this.session
    const previousPresentation = this.presentation
    if (previous) {
      if (previousPresentation) this.resources.cancelPresentation(previousPresentation, 'superseded')
      if (previousPresentation) this.resources.resetPresentation(previousPresentation)
      this.resources.sfx.release(previous)
    }
    this.session = token
    this.presentation = null
    // B becomes BGM owner before any late A release can run.
    this.resources.bgm.acquire(token)
    if (this.hidden) this.resources.bgm.pause(token)
  }

  beginPresentation(token: PresentationToken): boolean {
    if (!sameBattleSession(this.session, token)) return false
    this.presentation = token
    this.resources.sfx.begin(token)
    if (this.hidden) {
      this.resources.pausePresentation(token)
      this.resources.sfx.pause(token)
    } else {
      this.resources.resumePresentation(token)
    }
    return true
  }

  finishPresentation(token: PresentationToken): boolean {
    if (!samePresentationToken(this.presentation, token)) return false
    this.resources.sfx.complete(token)
    this.presentation = null
    return true
  }

  cancelPresentation(token: PresentationToken): boolean {
    if (!samePresentationToken(this.presentation, token)) return false
    this.resources.sfx.cancel(token)
    this.presentation = null
    return true
  }

  ownsPresentation(token: PresentationToken): boolean {
    return samePresentationToken(this.presentation, token)
  }

  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return
    this.hidden = hidden
    const session = this.session
    const presentation = this.presentation
    if (!session) return
    if (hidden) {
      this.resources.bgm.pause(session)
      if (presentation) {
        this.resources.pausePresentation(presentation)
        this.resources.sfx.pause(presentation)
      }
    } else {
      this.resources.bgm.resume(session)
      if (presentation) {
        this.resources.resumePresentation(presentation)
        this.resources.sfx.resume(presentation)
      }
    }
  }

  end(token: BattleSessionToken, reason: BattleSessionEndReason): boolean {
    const owned = sameBattleSession(this.session, token)
    const cancelReason: CancelReason = reason === 'unmount' ? 'unmount' : 'superseded'
    this.resources.cancelSession(token, cancelReason)
    if (owned && this.presentation) this.resources.sfx.cancel(this.presentation)
    this.resources.sfx.release(token)
    this.resources.bgm.release(token)
    if (owned) {
      this.presentation = null
      this.session = null
    }
    return owned
  }

  snapshot(): {
    session: BattleSessionToken | null
    presentation: PresentationToken | null
    hidden: boolean
  } {
    return { session: this.session, presentation: this.presentation, hidden: this.hidden }
  }

}
