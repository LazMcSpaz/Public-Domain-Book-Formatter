/**
 * The cover studio's preview, which is the PDF: written and rasterised on a
 * pause after each change, the stale one released as the new one lands.
 * Split out of `CoverStudio.tsx`.
 */
import { useEffect, useRef, useState } from 'react'
import type { CoverDocument } from '@core/cover'
import {
  releaseCoverPreview,
  renderCoverPreview,
  type CoverPreview
} from '../platform/browser/cover-preview'

/**
 * The preview is re-rendered on a pause, not on a keystroke.
 *
 * Writing a PDF and rasterising it is a few hundred milliseconds; doing that
 * per character typed into the blurb would make the field unusable. Long enough
 * to finish a word, short enough that it feels live.
 */
const PREVIEW_DEBOUNCE_MS = 400

export function useCoverPreview(
  doc: CoverDocument,
  artBytes: Map<string, Uint8Array>,
  pageCountMeasured: boolean
): { preview: CoverPreview | null; rendering: boolean; renderError: string | null } {
  const [preview, setPreview] = useState<CoverPreview | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const previewRef = useRef<CoverPreview | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setRendering(true)
      setRenderError(null)
      renderCoverPreview(doc, {
        images: artBytes,
        pageCountMeasured,
        signal: controller.signal
      })
        .then((next) => {
          if (controller.signal.aborted) {
            releaseCoverPreview(next)
            return
          }
          releaseCoverPreview(previewRef.current)
          previewRef.current = next
          setPreview(next)
        })
        .catch((error: unknown) => {
          // A cancelled render is not a failure: the answer moved on. Anything
          // else is reported: a silently swallowed error leaves the last good
          // cover on screen looking current, which is the one thing a preview
          // must never do.
          if (controller.signal.aborted || (error as { name?: string }).name === 'AbortError') {
            return
          }
          setRenderError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setRendering(false)
        })
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [doc, artBytes, pageCountMeasured])

  // The last preview outlives the effect that made it; revoke it on the way out.
  useEffect(
    () => () => {
      releaseCoverPreview(previewRef.current)
      previewRef.current = null
    },
    []
  )

  return { preview, rendering, renderError }
}
