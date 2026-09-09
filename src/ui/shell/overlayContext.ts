import { createContext, useContext } from 'react'
import type { OverlayControllerApi } from './OverlayController'

export const OverlayContext = createContext<OverlayControllerApi | null>(null)

export function useOverlayController(): OverlayControllerApi {
  const controller = useContext(OverlayContext)
  if (!controller) throw new Error('useOverlayController must be used within AppShell')
  return controller
}

export function useOptionalOverlayController(): OverlayControllerApi | null {
  return useContext(OverlayContext)
}
