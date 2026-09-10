import { useLayoutEffect, type RefObject } from 'react'

/** Focus a route's first safe action after a screen handoff. */
export function useRouteFocus<T extends HTMLElement>(targetRef: RefObject<T>, active: boolean): void {
  useLayoutEffect(() => {
    if (!active || typeof window === 'undefined') return
    targetRef.current?.focus({ preventScroll: true })
    const refocus = window.setTimeout(() => targetRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(refocus)
  }, [active, targetRef])
}
