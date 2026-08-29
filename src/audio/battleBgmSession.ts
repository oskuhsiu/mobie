import type { BattleSessionToken } from '@/presentation/battle/contracts'
import { sameBattleSession } from '@/presentation/battle/battleIdentity'
import { audio } from './audioEngine'

export interface BattleBgmAdapter {
  setIntensity(level: number): void
  pauseBgm(): void
  resumeBgm(): void
}

export interface BattleBgmSnapshot {
  owner: BattleSessionToken | null
  intensity: number
  paused: boolean
}

export class BattleBgmSession {
  private owner: BattleSessionToken | null = null
  private intensity = 0
  private paused = false

  constructor(private readonly adapter: BattleBgmAdapter) {}

  acquire(token: BattleSessionToken): void {
    if (this.owner && sameBattleSession(this.owner, token)) return
    const wasPaused = this.paused
    this.owner = {
      battleSessionId: token.battleSessionId,
      resultFingerprint: token.resultFingerprint,
    }
    this.intensity = 0
    this.paused = false
    this.adapter.setIntensity(0)
    if (wasPaused) this.adapter.resumeBgm()
  }

  set(token: BattleSessionToken, level: number): boolean {
    if (!this.owner || !sameBattleSession(this.owner, token)) return false
    this.intensity = Math.max(0, Math.min(1, level))
    this.adapter.setIntensity(this.intensity)
    return true
  }

  pause(token: BattleSessionToken): void {
    if (!this.owner || this.paused || !sameBattleSession(this.owner, token)) return
    this.paused = true
    this.adapter.pauseBgm()
  }

  resume(token: BattleSessionToken): void {
    if (!this.owner || !this.paused || !sameBattleSession(this.owner, token)) return
    this.paused = false
    this.adapter.resumeBgm()
  }

  release(token: BattleSessionToken): void {
    if (!this.owner || !sameBattleSession(this.owner, token)) return
    const wasPaused = this.paused
    this.owner = null
    this.intensity = 0
    this.paused = false
    this.adapter.setIntensity(0)
    if (wasPaused) this.adapter.resumeBgm()
  }

  snapshot(): BattleBgmSnapshot {
    return {
      owner: this.owner ? { ...this.owner } : null,
      intensity: this.intensity,
      paused: this.paused,
    }
  }
}

export const battleBgmSession = new BattleBgmSession(audio)
