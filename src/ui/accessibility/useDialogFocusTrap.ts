import { useLayoutEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => (
    !element.closest('[inert]') && element.getAttribute('aria-hidden') !== 'true'
  ))
}

export function useDialogFocusTrap({
  dialogRef,
  initialFocusRef,
  onEscape,
}: {
  dialogRef: RefObject<HTMLElement>
  initialFocusRef?: RefObject<HTMLElement>
  onEscape: () => void
}): void {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const initial = initialFocusRef?.current ?? focusableElements(dialog)[0] ?? dialog
    initial.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onEscapeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = focusableElements(dialog)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)!
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [dialogRef, initialFocusRef])
}
