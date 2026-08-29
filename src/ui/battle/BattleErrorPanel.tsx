import { useEffect, useRef } from 'react'
import type { BattleRuntimeError } from '@/store/battleStore'

export function BattleErrorPanel({
  error,
  retrying,
  onRetry,
  onLeave,
}: {
  error: BattleRuntimeError
  retrying: boolean
  onRetry: () => void
  onLeave: () => void
}) {
  const retryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!retrying) retryRef.current?.focus()
  }, [error.requestId, retrying])

  return (
    <div className="battle-error-layer">
      <section className="battle-error-panel" role="alert" aria-labelledby="battle-error-title">
        <h2 id="battle-error-title">戰鬥暫時無法繼續</h2>
        <p>{error.message}</p>
        <div className="battle-error-detail">{error.detail}</div>
        <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
          <button ref={retryRef} className="btn" disabled={retrying} onClick={onRetry}>
            {retrying ? '重新準備中…' : '重新開始本場'}
          </button>
          <button className="btn btn--ghost" disabled={retrying} onClick={onLeave}>
            離開戰鬥
          </button>
        </div>
      </section>
    </div>
  )
}
