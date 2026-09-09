import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ModalSurface } from './ModalSurface'
import { OverlayContext, useOverlayController } from './overlayContext'
export { useOverlayController, useOptionalOverlayController } from './overlayContext'

export type OverlayDismissPolicy = 'escape-and-backdrop' | 'escape-only' | 'explicit-action-only'

export interface OverlayDefinition {
  id: string
  policy: OverlayDismissPolicy
  content: ReactNode
}

export interface OverlayEntry extends OverlayDefinition {
  route: string
  serial: number
  invoker: HTMLElement | null
  restoreFocus?: () => HTMLElement | null
}

export interface OverlaySnapshot {
  route: string
  stack: readonly OverlayEntry[]
  current: OverlayEntry | null
}

export interface OverlayOpenOptions {
  /** Override the active element when a menu item should restore to its parent affordance. */
  invoker?: HTMLElement | null
  /** Resolve a remounted equivalent when the original element lived in a popped surface. */
  restoreFocus?: () => HTMLElement | null
}

export interface OverlayControllerApi {
  snapshot: OverlaySnapshot
  open: (definition: OverlayDefinition, options?: OverlayOpenOptions) => void
  push: (definition: OverlayDefinition, options?: OverlayOpenOptions) => void
  pop: () => void
  close: () => void
}

declare global {
  interface Window {
    /** DEV-only overlay stack snapshot used by the Chrome evidence runner. */
    __MOBIE_OVERLAY__?: {
      snapshot: () => {
        route: string
        stack: Array<{ id: string; policy: OverlayDismissPolicy; route: string; serial: number }>
      }
    }
  }
}

function activeElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function restoreFocus(entry: OverlayEntry): void {
  const attempt = (remaining: number) => {
    const resolve = () => queueMicrotask(() => {
      const element = entry.restoreFocus
        ? entry.restoreFocus()
        : entry.invoker?.isConnected && !entry.invoker.hasAttribute('disabled')
          ? entry.invoker
          : null
      if (element?.isConnected && !element.hasAttribute('disabled')) {
        element.focus()
        if (entry.restoreFocus && remaining > 0) requestAnimationFrame(() => attempt(remaining - 1))
        return
      }
      if (remaining > 0) requestAnimationFrame(() => attempt(remaining - 1))
    })
    // A popped surface remounts its parent portal during this frame. Resolve
    // its logical target after that mount and after the surface's own initial focus.
    if (entry.restoreFocus) requestAnimationFrame(() => requestAnimationFrame(resolve))
    else resolve()
  }
  attempt(3)
}

export function OverlayControllerProvider({ route, children }: { route: string; children: ReactNode }) {
  const [stack, setStack] = useState<OverlayEntry[]>([])
  const stackRef = useRef<OverlayEntry[]>([])
  const previousRouteRef = useRef(route)
  const serialRef = useRef(0)

  const commit = useCallback((next: OverlayEntry[]) => {
    stackRef.current = next
    setStack(next)
  }, [])

  const makeEntry = useCallback((definition: OverlayDefinition, options?: OverlayOpenOptions): OverlayEntry => ({
    ...definition,
    route,
    serial: ++serialRef.current,
    invoker: options?.invoker === undefined ? activeElement() : options.invoker,
    restoreFocus: options?.restoreFocus,
  }), [route])

  const open = useCallback((definition: OverlayDefinition, options?: OverlayOpenOptions) => {
    commit([makeEntry(definition, options)])
  }, [commit, makeEntry])

  const push = useCallback((definition: OverlayDefinition, options?: OverlayOpenOptions) => {
    commit([...stackRef.current, makeEntry(definition, options)])
  }, [commit, makeEntry])

  const pop = useCallback(() => {
    const current = stackRef.current.at(-1)
    if (!current) return
    commit(stackRef.current.slice(0, -1))
    restoreFocus(current)
  }, [commit])

  const close = useCallback(() => {
    const root = stackRef.current[0]
    if (!root) return
    commit([])
    restoreFocus(root)
  }, [commit])

  useEffect(() => {
    if (previousRouteRef.current !== route) {
      previousRouteRef.current = route
      if (stackRef.current.length > 0) commit([])
    }
  }, [commit, route])

  const snapshot = useMemo<OverlaySnapshot>(() => ({
    route,
    stack,
    current: stack.at(-1) ?? null,
  }), [route, stack])

  const api = useMemo<OverlayControllerApi>(() => ({ snapshot, open, push, pop, close }), [snapshot, open, push, pop, close])

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return
    const diagnostics = {
      snapshot: () => ({
        route: snapshot.route,
        stack: snapshot.stack.map(({ id, policy, route: entryRoute, serial }) => ({ id, policy, route: entryRoute, serial })),
      }),
    }
    window.__MOBIE_OVERLAY__ = diagnostics
    return () => {
      if (window.__MOBIE_OVERLAY__ === diagnostics) delete window.__MOBIE_OVERLAY__
    }
  }, [snapshot])

  return <OverlayContext.Provider value={api}>{children}</OverlayContext.Provider>
}

/** AppShell owns this single host; the active entry owns exactly one ModalSurface. */
export function OverlayHost() {
  const { snapshot, close } = useOverlayController()
  const current = snapshot.current
  if (!current) return null
  const title = current.id.split(':')[0] === 'settings' ? '⚙️ 設定' : '工具'
  return (
    <div
      className="overlay-host"
      data-overlay-host
      data-overlay-id={current.id}
      data-overlay-policy={current.policy}
      data-overlay-depth={snapshot.stack.length}
    >
      <Suspense fallback={(
        <ModalSurface title={title} description="工具載入中…" onClose={close} policy={current.policy}>
          <div className="overlay-loading__copy" role="status">載入中…</div>
        </ModalSurface>
      )}>
        {current.content}
      </Suspense>
    </div>
  )
}

/** Small bridge kept beside the controller so the shell exports one overlay vocabulary. */
export { ModalSurface }
