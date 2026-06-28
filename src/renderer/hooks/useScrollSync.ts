/**
 * useScrollSync — keeps the source and output panes tracking each other during a
 * whole-book read (SPEC §4 scroll-sync). Both panes tag every word element with
 * `data-token-id`, so syncing is exact: we find the first visible token in the
 * scrolled pane and align the same token in the other pane.
 *
 * A shared lock flag prevents the programmatic scroll from echoing back into an
 * infinite loop, and work is throttled to one alignment per animation frame.
 */
import { useEffect, useRef, type RefObject } from 'react'

interface Anchor {
  id: string
  /** Offset of the token's top below the container's top edge, in px. */
  delta: number
}

/** First token whose box is at/below the container's top edge (i.e. visible). */
function firstVisibleToken(container: HTMLElement): Anchor | null {
  const cTop = container.getBoundingClientRect().top
  const tokens = container.querySelectorAll<HTMLElement>('[data-token-id]')
  for (const el of tokens) {
    const rect = el.getBoundingClientRect()
    if (rect.bottom > cTop + 1) {
      const id = el.dataset.tokenId
      if (id) return { id, delta: rect.top - cTop }
    }
  }
  return null
}

/**
 * Scroll `container` so the element tagged with `id` sits `delta` px below the
 * top edge. Returns false if no such element exists in this pane.
 */
export function scrollElementToToken(container: HTMLElement, id: string, delta = 0): boolean {
  const el = container.querySelector<HTMLElement>(`[data-token-id="${CSS.escape(id)}"]`)
  if (!el) return false
  const cTop = container.getBoundingClientRect().top
  const elTop = el.getBoundingClientRect().top
  container.scrollTop += elTop - cTop - delta
  return true
}

export function useScrollSync(
  sourcePaneRef: RefObject<HTMLElement>,
  outputPaneRef: RefObject<HTMLElement>
): void {
  const locked = useRef(false)
  const frame = useRef(0)

  useEffect(() => {
    const source = sourcePaneRef.current
    const output = outputPaneRef.current
    if (!source || !output) return

    const sync = (from: HTMLElement, to: HTMLElement): void => {
      if (locked.current || frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        const anchor = firstVisibleToken(from)
        if (!anchor) return
        locked.current = true
        scrollElementToToken(to, anchor.id, anchor.delta)
        // Release the lock after the induced scroll event has fired.
        requestAnimationFrame(() => {
          locked.current = false
        })
      })
    }

    const onSourceScroll = (): void => sync(source, output)
    const onOutputScroll = (): void => sync(output, source)

    source.addEventListener('scroll', onSourceScroll, { passive: true })
    output.addEventListener('scroll', onOutputScroll, { passive: true })

    return () => {
      source.removeEventListener('scroll', onSourceScroll)
      output.removeEventListener('scroll', onOutputScroll)
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [sourcePaneRef, outputPaneRef])
}
