import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { useMachine, useSelector } from '@xstate/react'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
import { gameMachine, type GameContext, type GameEvent } from '@/game/machine/gameMachine'

declare global {
  interface Window {
    /** DEV-only route event counter used by cold-boot browser evidence. */
    __MOBIE_ROUTE_EVENTS__?: { total: number; byType: Partial<Record<GameEvent['type'], number>> }
  }
}

interface GameApi {
  context: GameContext
  value: string
  send: (event: GameEvent) => void
  matches: (state: string) => boolean
}

type GameActor = ActorRefFrom<typeof gameMachine>
type SendGameEvent = (event: GameEvent) => void

const Ctx = createContext<GameApi | null>(null)

export function GameProvider({ children, snapshot: restoredSnapshot, actor }: {
  children: ReactNode
  snapshot?: SnapshotFrom<typeof gameMachine>
  actor?: GameActor
}) {
  if (actor) return <ActorGameProvider actor={actor}>{children}</ActorGameProvider>
  return <MachineGameProvider restoredSnapshot={restoredSnapshot}>{children}</MachineGameProvider>
}

function MachineGameProvider({ children, restoredSnapshot }: {
  children: ReactNode
  restoredSnapshot?: SnapshotFrom<typeof gameMachine>
}) {
  const [snapshot, send] = useMachine(gameMachine, restoredSnapshot ? { snapshot: restoredSnapshot } : {})
  return <GameContextProvider snapshot={snapshot} send={send}>{children}</GameContextProvider>
}

function ActorGameProvider({ children, actor }: { children: ReactNode; actor: GameActor }) {
  const snapshot = useSelector(actor, (current) => current)
  return <GameContextProvider snapshot={snapshot} send={actor.send}>{children}</GameContextProvider>
}

function GameContextProvider({ children, snapshot, send }: {
  children: ReactNode
  snapshot: SnapshotFrom<typeof gameMachine>
  send: SendGameEvent
}) {
  const sendEvent = useCallback((event: GameEvent) => {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const current = window.__MOBIE_ROUTE_EVENTS__ ?? { total: 0, byType: {} }
      window.__MOBIE_ROUTE_EVENTS__ = {
        total: current.total + 1,
        byType: { ...current.byType, [event.type]: (current.byType[event.type] ?? 0) + 1 },
      }
    }
    send(event)
  }, [send])

  const api: GameApi = {
    context: snapshot.context,
    value: String(snapshot.value),
    send: sendEvent,
    matches: (s) => snapshot.matches(s as never),
  }

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useGame(): GameApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useGame must be used within GameProvider')
  return v
}
