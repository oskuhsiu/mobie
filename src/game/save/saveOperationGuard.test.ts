import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertSaveOperationsIdle,
  beginSaveMutation,
  getSaveOperationSnapshot,
  setSaveOperationRunning,
  tryBeginSaveOperation,
} from './saveOperationGuard'
import { setResultSettlementRunning } from '@/game/resultSettlementGuard'

function storageOf(entries: Record<string, string>): Storage {
  const values = new Map(Object.entries(entries))
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('Save operation guard', () => {
  beforeEach(() => setResultSettlementRunning(false))

  afterEach(() => {
    setSaveOperationRunning('result', false)
    setSaveOperationRunning('achievement-claim', false)
    setSaveOperationRunning('hatch', false)
    vi.unstubAllGlobals()
  })

  it('blocks direct commands while a process-local operation is running', () => {
    setSaveOperationRunning('hatch', true)
    expect(getSaveOperationSnapshot()).toMatchObject({ blocked: true, reasons: ['hatch'] })
    expect(() => assertSaveOperationsIdle('匯出')).toThrow('孵化操作')
  })

  it('also mirrors the Result boolean guard into save commands', () => {
    setResultSettlementRunning(true)
    expect(getSaveOperationSnapshot()).toMatchObject({ blocked: true, reasons: ['result'] })
    setResultSettlementRunning(false)
    expect(getSaveOperationSnapshot().blocked).toBe(false)
  })

  it('reads pending claim and hatch outboxes after a remount', () => {
    vi.stubGlobal('localStorage', storageOf({
      'mobie.meta.v1': JSON.stringify({ achievementClaims: [{ status: 'pending' }] }),
      'mobie.incubator.v1': JSON.stringify({ hatchOutbox: [{ status: 'pending' }] }),
    }))
    expect(getSaveOperationSnapshot().reasons).toEqual(['achievement-claim', 'hatch'])

    localStorage.setItem('mobie.meta.v1', JSON.stringify({ achievementClaims: [{ status: 'settled' }] }))
    localStorage.setItem('mobie.incubator.v1', JSON.stringify({ hatchOutbox: [{ status: 'settled' }] }))
    expect(getSaveOperationSnapshot()).toMatchObject({ blocked: false, reasons: [], message: null })
  })

  it('fails closed when operation storage cannot be read', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage unavailable') } })
    expect(getSaveOperationSnapshot()).toMatchObject({ blocked: true, reasons: ['storage'] })
    expect(() => assertSaveOperationsIdle('匯出')).toThrow('無法確認 durable operation 狀態')
  })

  it('treats an interrupted save transaction as a recoverable block', () => {
    vi.stubGlobal('localStorage', storageOf({
      'mobie.save.transaction.v1': JSON.stringify({ status: 'pending' }),
    }))
    expect(getSaveOperationSnapshot()).toMatchObject({ blocked: true, reasons: ['save-transaction'] })
  })

  it('prevents a reward coordinator from starting while save holds the mutex', () => {
    const release = beginSaveMutation()
    expect(tryBeginSaveOperation('achievement-claim')).toBe(false)
    release()
    expect(tryBeginSaveOperation('achievement-claim')).toBe(true)
    setSaveOperationRunning('achievement-claim', false)
  })
})
