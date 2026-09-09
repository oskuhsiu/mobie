import { createPortal } from 'react-dom'
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useOptionalOverlayController } from './overlayContext'
import type { OverlayDismissPolicy } from './OverlayController'
import { focusableElements } from '@/ui/accessibility/useDialogFocusTrap'

function nextId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function ModalSurface({
  title,
  description,
  onClose,
  policy = 'escape-and-backdrop',
  children,
  footer,
  headerLeading,
  headerAside,
  className = '',
  style,
  portal = true,
  restoreFocus = true,
}: {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  policy?: OverlayDismissPolicy
  children: ReactNode
  footer?: ReactNode
  headerLeading?: ReactNode
  headerAside?: ReactNode
  className?: string
  style?: CSSProperties
  portal?: boolean
  restoreFocus?: boolean
}) {
  const controller = useOptionalOverlayController()
  const managedByController = Boolean(controller?.snapshot.current)
  const effectivePolicy = controller?.snapshot.current?.policy ?? policy
  const surfaceRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  // Capture the invoker during the opening render. A parent screen may focus its
  // default action in a later effect while the portal is being attached.
  const invokerRef = useRef<HTMLElement | null>(
    controller?.snapshot.current?.invoker ?? (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null),
  )
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)
  const titleId = useRef(nextId('modal-title')).current
  const descriptionId = useRef(nextId('modal-description')).current

  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (!portal || typeof document === 'undefined') return
    const node = document.createElement('div')
    node.className = 'modal-portal'
    node.dataset.modalPortal = 'true'
    document.body.appendChild(node)
    setPortalNode(node)
    return () => node.remove()
  }, [portal])

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    const appRoot = document.getElementById('root')
    const previousInert = appRoot?.inert ?? false
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden')
    const previousOverflow = document.body.style.overflow
    const previousOverlayOpen = document.body.dataset.overlayOpen
    appRoot?.setAttribute('aria-hidden', 'true')
    if (appRoot) appRoot.inert = true
    document.body.style.overflow = 'hidden'
    document.body.dataset.overlayOpen = 'true'

    return () => {
      if (appRoot) {
        appRoot.inert = previousInert
        if (previousAriaHidden == null) appRoot.removeAttribute('aria-hidden')
        else appRoot.setAttribute('aria-hidden', previousAriaHidden)
      }
      document.body.style.overflow = previousOverflow
      if (previousOverlayOpen === undefined) delete document.body.dataset.overlayOpen
      else document.body.dataset.overlayOpen = previousOverlayOpen
    }
  }, [])

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const initial = closeRef.current ?? focusableElements(surface)[0] ?? surface
    const focusInitial = () => {
      if (surface.isConnected) initial.focus()
    }
    focusInitial()
    const focusFrame = requestAnimationFrame(focusInitial)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (effectivePolicy === 'explicit-action-only') return
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements(surface)
      if (focusable.length === 0) {
        event.preventDefault()
        surface.focus()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)!
      const current = document.activeElement
      if (event.shiftKey && (current === first || !surface.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || !surface.contains(current))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown)
      if (restoreFocus && !managedByController && invokerRef.current?.isConnected && !invokerRef.current.hasAttribute('disabled')) {
        queueMicrotask(() => invokerRef.current?.focus())
      }
    }
  }, [managedByController, controller, effectivePolicy, portalNode, restoreFocus])

  const content = (
    <div
      className="modal-backdrop"
      data-modal-backdrop
      data-dismiss-policy={effectivePolicy}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && effectivePolicy === 'escape-and-backdrop') onCloseRef.current()
      }}
    >
      <section
        ref={surfaceRef}
        className={`modal-card modal-surface ${className}`.trim()}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-modal-surface
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-card__head modal-surface__head">
          <div className="modal-surface__heading">
            <div className="modal-surface__heading-row">
              {headerLeading}
              <div>
                <h2 id={titleId} className="h-title modal-surface__title">{title}</h2>
                {description && <p id={descriptionId} className="h-sub modal-surface__description">{description}</p>}
              </div>
            </div>
          </div>
          {headerAside}
          <button ref={closeRef} className="btn btn--ghost btn--sm" data-modal-close onClick={onClose}>關閉</button>
        </div>
        <div className="modal-surface__body" data-modal-body>{children}</div>
        {footer && <div className="modal-surface__footer" data-modal-footer>{footer}</div>}
      </section>
    </div>
  )

  if (!portal || !portalNode) return portal ? null : content
  return createPortal(content, portalNode)
}
