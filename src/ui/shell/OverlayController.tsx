import {
  Component,
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
  const target = (): HTMLElement | null => {
    const preferred = entry.restoreFocus?.()
    if (preferred?.isConnected && !preferred.hasAttribute('disabled')) return preferred
    return entry.invoker?.isConnected && !entry.invoker.hasAttribute('disabled')
      ? entry.invoker
      : null
  }

  // Focus the live invoker synchronously when it is already mounted. This
  // keeps keyboard users anchored even when a parent route re-renders in the
  // same frame; the bounded retries below still handle a remounted portal.
  const immediate = target()
  if (immediate?.isConnected && !immediate.hasAttribute('disabled')) immediate.focus()

  const attempt = (remaining: number) => {
    const resolve = () => queueMicrotask(() => {
      const element = target()
      if (element?.isConnected && !element.hasAttribute('disabled')) {
        element.focus()
        if (entry.restoreFocus && remaining > 0) requestAnimationFrame(() => attempt(remaining - 1))
        return
      }
      if (remaining > 0) requestAnimationFrame(() => attempt(remaining - 1))
    })
    // A popped surface remounts its parent portal during this frame. Resolve
    // its logical target after that mount and after the surface's own initial
    // focus. Headless Chrome can pause rAF while the page is hidden, so keep a
    // timer fallback for the same bounded attempt.
    let finished = false
    let timer: number | undefined
    const resolveOnce = () => {
      if (finished) return
      finished = true
      if (timer !== undefined) window.clearTimeout(timer)
      resolve()
    }
    requestAnimationFrame(() => requestAnimationFrame(resolveOnce))
    timer = window.setTimeout(resolveOnce, 50)
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
      <OverlayChunkBoundary title={title} policy={current.policy} onClose={close}>
        <Suspense fallback={(
          <ModalSurface title={title} description="工具載入中…" onClose={close} policy={current.policy}>
            <div className="overlay-loading__copy" role="status">載入中…</div>
          </ModalSurface>
        )}>
          {current.content}
        </Suspense>
      </OverlayChunkBoundary>
    </div>
  )
}

interface OverlayChunkBoundaryProps {
  title: string
  policy: OverlayDismissPolicy
  onClose: () => void
  children: ReactNode
}

interface OverlayChunkBoundaryState {
  error: Error | null
}

/** A rejected lazy tool chunk must leave the route usable and explain recovery. */
class OverlayChunkBoundary extends Component<OverlayChunkBoundaryProps, OverlayChunkBoundaryState> {
  state: OverlayChunkBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): OverlayChunkBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <ModalSurface
        title={this.props.title}
        description="工具載入失敗"
        onClose={this.props.onClose}
        policy={this.props.policy}
      >
        <div className="overlay-loading__copy overlay-loading__copy--error" role="alert" data-overlay-chunk-error>
          <strong>這個工具暫時無法載入</strong>
          <span>請重新載入頁面後再試；目前的冒險進度不會被改動。</span>
          <button type="button" className="btn btn--ghost btn--sm" data-overlay-chunk-close onClick={this.props.onClose}>回到遊戲</button>
        </div>
      </ModalSurface>
    )
  }
}

/** Small bridge kept beside the controller so the shell exports one overlay vocabulary. */
export { ModalSurface }
