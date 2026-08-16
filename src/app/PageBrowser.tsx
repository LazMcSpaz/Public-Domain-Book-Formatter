/**
 * Looking at any page of the finished book.
 *
 * The design gate previews four body pages, deliberately: it exists to answer
 * questions about the *look*, and laying out three hundred pages on every
 * radio-button change would make it unusable. But that left no way to see page
 * 147 at all — and the things most worth checking are exactly the ones that
 * only appear on some particular leaf. A footnote set at the foot of the page
 * its reference falls on. A table that broke across a spread. A drop capital on
 * the one chapter whose first word is a quotation.
 *
 * That gap got worse when the app started *writing* into the book. An editor's
 * note and a generated introduction are the two things a user most wants to see
 * in place, and neither is on the first four leaves.
 *
 * This renders straight from the exported PDF bytes, so there is no second
 * layout and nothing that can disagree with the file being downloaded — the
 * same rule the design preview follows, applied to the whole book instead of a
 * sample.
 */
import { useEffect, useRef, useState } from 'react'
import { renderPageToObjectUrl } from '../platform/browser/pdf'

export interface PageBrowserProps {
  bytes: Uint8Array
  pageCount: number
  /** Where to open. Defaults to the first page. */
  initialPage?: number
}

export function PageBrowser({ bytes, pageCount, initialPage = 0 }: PageBrowserProps): JSX.Element {
  const [page, setPage] = useState(Math.min(Math.max(0, initialPage), pageCount - 1))
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** What the number box holds while it is being typed into. */
  const [typed, setTyped] = useState(String(page + 1))

  // The Blob is made once for the whole component rather than per page: it is a
  // book-sized copy of the bytes, and remaking it on every step would churn
  // several megabytes each time the user pressed Next.
  const blob = useRef<Blob | null>(null)
  if (blob.current === null) {
    blob.current = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  }

  useEffect(() => {
    let live = true
    let made: string | null = null
    setBusy(true)
    setError(null)

    void (async () => {
      try {
        const next = await renderPageToObjectUrl(blob.current!, page, 120)
        if (!live) {
          // The user moved on while this was rendering. Revoking here is the
          // only place it can be done — nothing else holds the url.
          URL.revokeObjectURL(next)
          return
        }
        made = next
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old)
          return next
        })
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : 'Could not render that page')
      } finally {
        if (live) setBusy(false)
      }
    })()

    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [page])

  // The last url, released when the browser goes away.
  useEffect(() => () => setUrl((old) => (old && URL.revokeObjectURL(old), null)), [])

  const go = (to: number): void => {
    const clamped = Math.min(Math.max(0, to), pageCount - 1)
    setPage(clamped)
    setTyped(String(clamped + 1))
  }

  return (
    <div className="browser">
      <div className="browser-bar">
        <button type="button" onClick={() => go(page - 1)} disabled={page === 0}>
          ‹ Previous
        </button>
        <label>
          Page
          <input
            type="number"
            min={1}
            max={pageCount}
            value={typed}
            aria-label="Go to page"
            onChange={(e) => {
              setTyped(e.target.value)
              const n = Number(e.target.value)
              // Only jump on a number that is actually in the book — otherwise
              // typing "1" on the way to "147" would render page one first.
              if (Number.isInteger(n) && n >= 1 && n <= pageCount) setPage(n - 1)
            }}
            onBlur={() => setTyped(String(page + 1))}
          />
          of {pageCount}
        </label>
        <button type="button" onClick={() => go(page + 1)} disabled={page >= pageCount - 1}>
          Next ›
        </button>
        {busy ? <span className="browser-busy">rendering…</span> : null}
      </div>

      {error ? (
        <p className="help">{error}</p>
      ) : (
        <div className={`browser-leaf${page % 2 === 0 ? ' recto' : ' verso'}`}>
          {url ? <img src={url} alt={`Page ${page + 1} of the finished book`} /> : null}
        </div>
      )}
      <p className="help">
        Rendered from the file you are about to download — not a mock-up of it.
      </p>
    </div>
  )
}
