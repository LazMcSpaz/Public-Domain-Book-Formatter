/**
 * The design gate's preview.
 *
 * The point of this component is that it shows the *actual pages* — the book is
 * laid out, written to a PDF, and rendered from those bytes. So "I need to be
 * able to see all of these formatting and style options render before I can hit
 * accept on anything" is answered literally rather than approximately.
 *
 * Two behaviours make it usable rather than merely correct:
 *
 * - It regenerates only when the *style* changes, and after a pause. The gate's
 *   answers are radio buttons, so a few hundred milliseconds is invisible, and
 *   without the pause a run of clicks would queue a render for each one.
 * - It keeps the previous pages on screen while the next ones are made. A pane
 *   that blanks on every answer is worse than one that lags: the user loses the
 *   comparison they were making.
 */
import { useEffect, useRef, useState } from 'react'
import type { BookDocument } from '@core/assemble'
import type { StyleProfile } from '@core/model'
import type { LayoutEdition } from '@core/layout'
import {
  isPreviewCancellation,
  releasePreview,
  renderPreview,
  type PreviewResult
} from '../platform/browser/preview'

export interface PreviewPaneProps {
  /** Named `book`, not `document`, so it cannot be confused with the DOM's. */
  book: BookDocument | null
  profile: StyleProfile
  edition: LayoutEdition
  /**
   * PNG bytes per illustration id. Without them a plate previews as a blank
   * leaf, which would be the design gate showing something the export does not.
   */
  images?: ReadonlyMap<string, Uint8Array>
}

/** Long enough to swallow a run of clicks, short enough to feel immediate. */
const DEBOUNCE_MS = 250

export function PreviewPane({
  book,
  profile,
  edition,
  images
}: PreviewPaneProps): JSX.Element | null {
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // What the effect watches, flattened to primitives. Depending on the objects
  // themselves would re-render on every keystroke elsewhere in the gate, since
  // the profile and the edition are rebuilt from the answers on each render.
  const bookKey = book?.blocks.length ?? -1
  const styleKey = JSON.stringify(profile)
  const editionKey = [edition.title, edition.author].join('\u0000')
  // Pictures arriving (or being unticked) changes the pages, so it has to be a
  // reason to redraw — otherwise the plate keeps the look it had before.
  const imageKey = images?.size ?? 0

  // The inputs, reachable from the effect without being dependencies of it:
  // the keys above decide *when* to run, these supply the values to run with.
  const inputs = useRef({ book, profile, edition, images })
  inputs.current = { book, profile, edition, images }

  // Held in a ref so the cleanup that revokes the object URLs sees the pages
  // that are actually on screen, not the ones captured when the effect ran.
  const current = useRef<PreviewResult | null>(null)

  useEffect(() => {
    const { book: doc, profile: style, edition: details, images: pixels } = inputs.current
    if (!doc) return

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true)
      setError(null)
      renderPreview(doc, style, {
        edition: details,
        signal: controller.signal,
        ...(pixels ? { images: pixels } : {})
      })
        .then((next) => {
          // A preview that finished after its answer was superseded is waste,
          // and its pages are object URLs — dropping the reference would leak.
          if (controller.signal.aborted) {
            releasePreview(next)
            return
          }
          releasePreview(current.current)
          current.current = next
          setPreview(next)
        })
        .catch((cause: unknown) => {
          if (isPreviewCancellation(cause) || controller.signal.aborted) return
          setError(cause instanceof Error ? cause.message : 'Could not render a preview.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [bookKey, styleKey, editionKey, imageKey])

  // The pages outlive this component only as object URLs, so unmounting has to
  // revoke them or a session's worth of previews stays resident.
  useEffect(() => {
    return () => {
      releasePreview(current.current)
      current.current = null
    }
  }, [])

  if (!book) return null

  return (
    <section className="preview" aria-label="Preview of the finished pages">
      <div className="preview-head">
        <span className="summary-label">How it will print</span>
        {busy ? <span className="preview-busy">setting…</span> : null}
      </div>

      {error ? <div className="help">{error}</div> : null}

      {preview?.substitutions.map(([wanted, used]) => (
        <div key={wanted} className="help">
          {wanted} isn’t installed here, so these pages are set in {used}. See{' '}
          <code>public/fonts/{wanted.toLowerCase()}/README.md</code>.
        </div>
      ))}

      <div className={busy ? 'spreads stale' : 'spreads'}>
        {preview?.pages.map((page) => (
          <figure key={page.index} className={page.recto ? 'leaf recto' : 'leaf verso'}>
            <img
              src={page.url}
              alt={page.folio ? `Page ${page.folio}` : 'An unnumbered page'}
              width={page.widthPx}
              height={page.heightPx}
            />
          </figure>
        ))}
      </div>

      <div className="help">
        {preview
          ? 'These are real pages from the finished PDF, not a mock-up — the export renders the same layout.'
          : 'Setting the first pages…'}
      </div>
    </section>
  )
}
