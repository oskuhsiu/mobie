import { createContext, useContext, type ReactNode } from 'react'
import { useMachine } from '@xstate/react'
import { gameMachine, type GameContext, type GameEvent } from '@/game/machine/gameMachine'

interface GameApi {
  context: GameContext
  value: string
  send: (event: GameEvent) => void
  matches: (state: string) => boolean
}

const Ctx = createContext<GameApi | null>(null)

export function GameProvider({ children }: { children: ReactNode }) {
  const [snapshot, send] = useMachine(gameMachine)

  const api: GameApi = {
    context: snapshot.context,
    value: String(snapshot.value),
    send,
    matches: (s) => snapshot.matches(s as never),
  }

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useGame(): GameApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useGame must be used within GameProvider')
  return v
}
