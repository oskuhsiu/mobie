import '@/ui/styles/battleRenderer.css'

export type BattleRenderGateState = 'battle-data-loading' | 'renderer-booting'

export interface BattleRenderGateProps {
  state: BattleRenderGateState
  reason?: string
}

const DEFAULT_REASON: Record<BattleRenderGateState, string> = {
  'battle-data-loading': '正在準備戰鬥資料。',
  'renderer-booting': '正在準備戰鬥畫面。',
}

export function BattleRenderGate({ state, reason }: BattleRenderGateProps) {
  const message = reason ?? DEFAULT_REASON[state]

  return (
    <div
      className={`battle-render-gate battle-render-gate--${state}`}
      data-renderer-surface="dom"
      data-render-state={state}
      data-command-disabled="true"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="battle-render-gate__arena" aria-hidden="true">
        <div className="battle-render-gate__anchor battle-render-gate__anchor--foe" data-battle-anchor="foe" />
        <div className="battle-render-gate__anchor battle-render-gate__anchor--player" data-battle-anchor="player" />
      </div>
      <div className="battle-render-gate__copy">
        <strong>{state === 'battle-data-loading' ? '準備戰鬥資料…' : '準備戰鬥畫面…'}</strong>
        <span>指令暫時停用：{message}資料與畫面準備完成後即可操作。</span>
      </div>
    </div>
  )
}

export default BattleRenderGate
