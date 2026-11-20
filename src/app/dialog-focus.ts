import { useEffect, useRef, type RefObject } from 'react'

/**
 * A dialog's keyboard manners, for the Workroom's job detail and its reading
 * view: focus moves into the dialog when it opens and stays there while it is
 * open (Tab and Shift+Tab go round inside it), Escape closes it, and focus
 * goes back to whatever opened it when it closes.
 *
 * Only the topmost dialog does any of this. The two used to listen for Escape
 * on the whole window each, so one Escape closed a file and the job under it
 * together. `npm run check:workroom` presses the keys.
 */

/** The dialogs open now, the topmost last. */
const open: HTMLElement[] = []

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

export function useDialogFocus(ref: RefObject<HTMLElement>, onClose: () => void): void {
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    open.push(dialog)
    dialog.focus({ preventScroll: true })
    const topmost = (): boolean => open[open.length - 1] === dialog

    const onKey = (e: KeyboardEvent): void => {
      if (!topmost()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        return
      }
      if (e.key !== 'Tab') return
      const stops = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.getClientRects().length > 0
      )
      const first = stops[0]
      const last = stops[stops.length - 1]
      const at = document.activeElement
      if (!first || !last) {
        e.preventDefault()
        dialog.focus({ preventScroll: true })
      } else if (e.shiftKey && (at === first || at === dialog || !dialog.contains(at))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (at === last || !dialog.contains(at))) {
        e.preventDefault()
        first.focus()
      }
    }
    // Focus that leaves the topmost dialog (a click outside it, a screen
    // reader's jump) is brought back.
    const onFocus = (e: FocusEvent): void => {
      if (topmost() && e.target instanceof Node && !dialog.contains(e.target)) {
        dialog.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      open.splice(open.indexOf(dialog), 1)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [ref])
}
