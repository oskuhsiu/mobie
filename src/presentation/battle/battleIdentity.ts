import type { BattleSessionToken } from './contracts'

export type BattleIdentity = BattleSessionToken

export interface BattleIdentityCrypto {
  randomUUID?: () => string
  getRandomValues<T extends ArrayBufferView>(array: T): T
}

function random128BitId(crypto: BattleIdentityCrypto): string {
  if (crypto.randomUUID) return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** One logical battle owns one stable, independently generated identity pair. */
export function createBattleIdentity(
  crypto: BattleIdentityCrypto = globalThis.crypto,
): BattleIdentity {
  return {
    battleSessionId: random128BitId(crypto),
    resultFingerprint: random128BitId(crypto),
  }
}
