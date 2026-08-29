import type { BattleSessionToken, PresentationToken } from '@/presentation/battle/contracts'
import { sameBattleSession, samePresentationToken } from '@/presentation/battle/battleIdentity'
import { audio } from './audioEngine'

export interface BattleAudioAdapter {
  cancelBattleSfx(): void
  pauseBattleSfx(): void
  resumeBattleSfx(): void
}

export interface BattleAudioSnapshot {
  owner: PresentationToken | null
  paused: boolean
}

function copyPresentation(token: PresentationToken): PresentationToken {
  return { ...token }
}

export class BattleAudioSession {
  private owner: PresentationToken | null = null
  private paused = false

  constructor(private readonly adapter: BattleAudioAdapter) {}

  begin(token: PresentationToken): void {
    if (this.owner && samePresentationToken(this.owner, token)) return
    if (this.owner) {
      if (this.paused) this.adapter.resumeBattleSfx()
      this.adapter.cancelBattleSfx()
    }
    this.owner = copyPresentation(token)
    this.paused = false
  }

  play(token: PresentationToken, callback: () => void): boolean {
    if (!this.owner || this.paused || !samePresentationToken(this.owner, token)) return false
    callback()
    return true
  }

  playCurrent(callback: () => void): boolean {
    if (!this.owner || this.paused) return false
    callback()
    return true
  }

  pause(token: PresentationToken): void {
    if (!this.owner || this.paused || !samePresentationToken(this.owner, token)) return
    this.paused = true
    this.adapter.pauseBattleSfx()
  }

  resume(token: PresentationToken): void {
    if (!this.owner || !this.paused || !samePresentationToken(this.owner, token)) return
    this.paused = false
    this.adapter.resumeBattleSfx()
  }

  cancel(token: PresentationToken): void {
    if (!this.owner || !samePresentationToken(this.owner, token)) return
    if (this.paused) this.adapter.resumeBattleSfx()
    this.owner = null
    this.paused = false
    this.adapter.cancelBattleSfx()
  }

  /** Successful presentation releases ownership without cutting its final one-shot sound. */
  complete(token: PresentationToken): void {
    if (!this.owner || !samePresentationToken(this.owner, token)) return
    if (this.paused) this.adapter.resumeBattleSfx()
    this.owner = null
    this.paused = false
  }

  release(sessionToken: BattleSessionToken): void {
    if (!this.owner || !sameBattleSession(this.owner, sessionToken)) return
    if (this.paused) this.adapter.resumeBattleSfx()
    this.owner = null
    this.paused = false
    this.adapter.cancelBattleSfx()
  }

  snapshot(): BattleAudioSnapshot {
    return {
      owner: this.owner ? copyPresentation(this.owner) : null,
      paused: this.paused,
    }
  }
}

export const battleAudioSession = new BattleAudioSession(audio)
