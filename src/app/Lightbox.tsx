/**
 * A scan, big enough to actually read.
 *
 * Every gate in this app is built on the promise that you never decide blind —
 * the scan is beside the question, the word crop is beside the reading. That
 * promise is only kept if the evidence is legible, and a 150-pixel thumbnail of
 * a page of dense type is not: it proves a page exists, which nobody doubted.
 *
 * So anything shown as evidence can be opened. The image is drawn at its
 * natural size and the frame scrolls, rather than fitting the page to the
 * window — fitting is what made it unreadable in the first place, and a scan
 * worth opening is one worth panning around.
 */
import { useEffect, useRef } from 'react'

export interface LightboxProps {
  src: string
  caption: string
  /** Shown while a readable render is still being made. */
  loading?: boolean
  onClose: () => void
}

export function Lightbox({ src, caption, loading, onClose }: LightboxProps): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Focus moves in, so Escape works without clicking first and so a keyboard
    // user is not left behind the overlay.
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={caption}
      // The backdrop closes; the frame inside it does not, so dragging a
      // selection across the image cannot dismiss it by accident.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="lightbox-bar">
        <span>{caption}</span>
        <button ref={closeRef} type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="lightbox-frame">
        {loading ? (
          <p className="lightbox-loading">Rendering the page…</p>
        ) : (
          <img src={src} alt={caption} />
        )}
      </div>
    </div>
  )
}
