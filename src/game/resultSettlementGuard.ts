/**
 * Process-local command guard for operations that must not race a Result
 * settlement.  It intentionally carries no journal or canonical data; the
 * projection coordinator is the owner that toggles it.
 */
let settlementRunning = false

export function setResultSettlementRunning(running: boolean): void {
  settlementRunning = running
}

export function isResultSettlementRunning(): boolean {
  return settlementRunning
}

export function assertResultSettlementIdle(action: string): void {
  if (settlementRunning) throw new Error(`Result 結算進行中，請等待完成後再${action}。`)
}
