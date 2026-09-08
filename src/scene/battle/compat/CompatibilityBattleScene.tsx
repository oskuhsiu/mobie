import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Side } from '@/game/battle/reducer'
import type { BattleAnchorKind, BattleScreenPoint, BattleViewport } from '@/presentation/battle/battleAnchors'
import { projectBattleAnchor } from '@/presentation/battle/battleAnchors'
import type { BattleSceneHandle, BattleSceneSnapshot } from '@/scene/battle/contracts'
import '@/ui/styles/battleRenderer.css'

type MotionState = 'idle' | 'lunge' | 'hit' | 'faint' | 'recall' | 'enter'
type CombatantState = { mode: MotionState; version: number }

const INITIAL_STATE: Record<Side, CombatantState> = {
  player: { mode: 'idle', version: 0 },
  foe: { mode: 'idle', version: 0 },
}

function initialOf(name: string): string {
  return [...name.trim()][0] ?? '?'
}

interface CompatibilityBattleSceneProps {
  snapshot: BattleSceneSnapshot
  paused: boolean
  reducedMotion: boolean
}

interface CompatibilityCombatantProps {
  side: Side
  name: string
  artworkUrl: string
  shiny?: boolean
  state: CombatantState
  onMotionEnd: () => void
}

function CompatibilityCombatant({ side, name, artworkUrl, shiny, state, onMotionEnd }: CompatibilityCombatantProps) {
  const [artworkFailed, setArtworkFailed] = useState(!artworkUrl)
  const initial = initialOf(name)

  useEffect(() => {
    setArtworkFailed(!artworkUrl)
  }, [artworkUrl])

  return (
    <div
      className={`battle-renderer__combatant battle-renderer__combatant--${side}`}
      data-battle-combatant={side}
      data-compat-state={state.mode}
      role="img"
      aria-label={`${side === 'player' ? '我方' : '對手'} ${name}`}
    >
      <div
        key={`${side}-${state.version}`}
        className={`battle-renderer__combatant-motion battle-renderer__combatant-motion--${state.mode}`}
        onAnimationEnd={onMotionEnd}
      >
        <div className={`battle-renderer__artwork ${shiny ? 'battle-renderer__artwork--shiny' : ''}`}>
          {artworkFailed ? (
            <div className="battle-renderer__silhouette" aria-hidden="true">
              <span>{initial}</span>
            </div>
          ) : (
            <img
              src={artworkUrl}
              alt=""
              className="battle-renderer__image"
              draggable={false}
              onError={() => setArtworkFailed(true)}
            />
          )}
        </div>
      </div>
      <span className="battle-renderer__combatant-name">{name}</span>
    </div>
  )
}

export const CompatibilityBattleScene = forwardRef<BattleSceneHandle, CompatibilityBattleSceneProps>(function CompatibilityBattleScene({ snapshot, paused, reducedMotion }, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [states, setStates] = useState<Record<Side, CombatantState>>({
    player: { ...INITIAL_STATE.player },
    foe: { ...INITIAL_STATE.foe },
  })

  const setMode = (side: Side, mode: MotionState) => {
    setStates((previous) => ({
      ...previous,
      [side]: { mode, version: previous[side].version + 1 },
    }))
  }

  useImperativeHandle(ref, () => ({
    normalAttack: (cue) => {
      if (cue.phase === 'anticipate' || cue.phase === 'contact') {
        setMode(cue.caster, reducedMotion ? 'idle' : 'lunge')
      } else if (cue.phase === 'hit-react') {
        setMode(cue.target, reducedMotion ? 'idle' : 'hit')
      } else {
        setMode(cue.caster, 'idle')
        setMode(cue.target, 'idle')
      }
    },
    lunge: (side) => setMode(side, reducedMotion ? 'idle' : 'lunge'),
    hitReact: (side) => setMode(side, reducedMotion ? 'idle' : 'hit'),
    recall: (side) => setMode(side, 'recall'),
    faint: (side) => setMode(side, 'faint'),
    enter: (side) => setMode(side, 'enter'),
    setTimeScale: (scale) => {
      const root = rootRef.current
      if (!root) return
      const paused = !Number.isFinite(scale) || scale <= 0
      root.dataset.rendererTimeScale = paused ? '0' : '1'
      root.style.setProperty('--battle-renderer-duration-scale', paused ? '1' : String(1 / scale))
    },
    resetPresentation: (options) => {
      rootRef.current?.style.setProperty('--battle-renderer-duration-scale', '1')
      if (rootRef.current) rootRef.current.dataset.rendererTimeScale = '1'
      setStates((previous) => ({
        player: options?.keepRecall && previous.player.mode === 'recall' ? previous.player : { mode: 'idle', version: previous.player.version + 1 },
        foe: options?.keepRecall && previous.foe.mode === 'recall' ? previous.foe : { mode: 'idle', version: previous.foe.version + 1 },
      }))
    },
    projectAnchor: (side: Side, anchor: BattleAnchorKind, viewport: BattleViewport): BattleScreenPoint =>
      projectBattleAnchor(side, anchor, viewport),
  }), [reducedMotion])

  return (
    <div
      ref={rootRef}
      className="battle-renderer battle-renderer--compatibility"
      data-renderer-surface="compatibility"
      data-renderer-state="compatibility-ready"
      data-renderer-paused={paused ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      <p className="battle-renderer__note" role="status">已切換相容模式，戰鬥仍可繼續。</p>
      <div className="battle-renderer__arena" aria-label="相容模式戰鬥場景">
        <CompatibilityCombatant
          side="foe"
          name={snapshot.foe.nameZh}
          artworkUrl={snapshot.foe.artworkUrl}
          shiny={snapshot.foe.shiny}
          state={states.foe}
          onMotionEnd={() => !['faint', 'recall'].includes(states.foe.mode) && setMode('foe', 'idle')}
        />
        <CompatibilityCombatant
          side="player"
          name={snapshot.player.nameZh}
          artworkUrl={snapshot.player.artworkUrl}
          shiny={snapshot.player.shiny}
          state={states.player}
          onMotionEnd={() => !['faint', 'recall'].includes(states.player.mode) && setMode('player', 'idle')}
        />
      </div>
    </div>
  )
})

CompatibilityBattleScene.displayName = 'CompatibilityBattleScene'

export default CompatibilityBattleScene
