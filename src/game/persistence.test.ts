import { afterEach, describe, expect, it } from 'vitest'
import { LocalStorageAdapter } from './persistence'
import { createOwnedUnit } from './growth'

function installStorage() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  return storage
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('roster capture persistence envelope', () => {
  it('keeps legacy arrays readable and writes capture markers with the roster in one envelope', async () => {
    const storage = installStorage()
    const adapter = new LocalStorageAdapter()
    const unit = createOwnedUnit('capture-unit', 1, 5)
    storage.setItem('mobie.roster.v2', JSON.stringify([unit]))
    expect(await adapter.loadRosterStrict()).toEqual([unit])

    const marker = {
      resultId: 'capture-result',
      resultFingerprint: 'capture-fingerprint',
      destination: 'roster-capture',
      status: 'pending',
      createdAt: 1,
      payload: { card: { cardId: unit.id, speciesId: unit.speciesId, level: unit.level } },
      unit,
      receipt: { resultId: 'capture-result', resultFingerprint: 'capture-fingerprint', unit, appliedAt: 1 },
    }
    await adapter.saveRosterWithCaptureMarkersStrict?.([unit], [marker])

    expect(JSON.parse(storage.getItem('mobie.roster.v2') ?? 'null')).toEqual({
      roster: [unit],
      resultSettlements: [marker],
    })
    expect(await adapter.loadRoster()).toEqual([unit])
    await adapter.saveRosterStrict([unit])
    expect(JSON.parse(storage.getItem('mobie.roster.v2') ?? 'null')).toMatchObject({
      roster: [unit],
      resultSettlements: [marker],
    })
  })
})
