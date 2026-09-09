import { describe, expect, it } from 'vitest'
import { assertResultSettlementIdle, isResultSettlementRunning, setResultSettlementRunning } from './resultSettlementGuard'

describe('Result settlement command guard', () => {
  it('rejects save commands only while the projection is running', () => {
    setResultSettlementRunning(true)
    expect(isResultSettlementRunning()).toBe(true)
    expect(() => assertResultSettlementIdle('匯出')).toThrow('Result 結算進行中')

    setResultSettlementRunning(false)
    expect(isResultSettlementRunning()).toBe(false)
    expect(() => assertResultSettlementIdle('匯出')).not.toThrow()
  })
})
