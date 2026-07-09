/**
 * ImageCropPopover — source-image-on-hover (SPEC §4).
 *
 * When a word is hovered AND either confidence tinting is on or the hovered word
 * is low-confidence, show a floating popover near the cursor containing a
 * full-resolution canvas crop of that word's bbox. The original scan pixels
 * resolve ambiguous OCR ("is that an l or a 1") better than the text.
 *
 * Best-effort and cheap to run: the full page image (a base64 data URL from
 * `window.api.getPageImage`) is fetched once per page and cached; crops are
 * recomputed only when the hovered token changes, and the whole effort is
 * debounced so rapid pointer movement doesn't thrash.
 */
import { useEffect, useRef, useState } from 'react'
import type { SourcePage, WordToken } from '@core/model'
import { useReview } from '../../store/ReviewContext'
import { getHoverToken, subscribeHover } from '../../highlight'
import { cropImage } from '../../utils/crop-image'
import './ImageCropPopover.css'

/** Below this OCR confidence a word is "low-confidence" (SPEC §4 tiers). */
const LOW_CONFIDENCE = 60
/** Pixels of context to include around the bbox in the crop. */
const CROP_PADDING = 6
/** Debounce before fetching/cropping, so flicking the cursor is free. */
const SHOW_DELAY_MS = 90

interface CursorPos {
  x: number
  y: number
}

/** Find the hovered word across all pages by token id. */
function findWord(pages: SourcePage[], tokenId: string): WordToken | null {
  for (const page of pages) {
    const word = page.words.find((w) => w.id === tokenId)
    if (word) return word
  }
  return null
}

export function ImageCropPopover(): JSX.Element | null {
  const { state } = useReview()
  const project = state.project
  const projectPath = state.projectPath
  const confidenceTint = state.readingPrefs.confidenceTint

  // Subscribe to the imperative hover controller so ONLY this small popover
  // re-renders on hover — the source/output panes stay render-free.
  const [hoverTokenId, setHoverTokenId] = useState<string | null>(getHoverToken)
  useEffect(() => subscribeHover(setHoverTokenId), [])

  const [cursor, setCursor] = useState<CursorPos | null>(null)
  const [cropUrl, setCropUrl] = useState<string | null>(null)

  // Cache of full-page data URLs keyed by image path (fetched once per page).
  const pageImageCache = useRef<Map<string, Promise<string>>>(new Map())

  // Track the cursor only while a token is hovered (cheap pointer listener).
  useEffect(() => {
    if (!hoverTokenId) {
      setCursor(null)
      return
    }
    const onMove = (e: PointerEvent): void => setCursor({ x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [hoverTokenId])

  // Resolve the hovered word + decide whether the popover should show at all.
  const word = project && hoverTokenId ? findWord(project.pages, hoverTokenId) : null
  const eligible = word !== null && (confidenceTint || word.confidence < LOW_CONFIDENCE)

  useEffect(() => {
    if (!eligible || !word || !project || !projectPath) {
      setCropUrl(null)
      return
    }
    const page = project.pages[word.pageIndex]
    const imagePath = page?.imagePath
    if (!imagePath) {
      setCropUrl(null)
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      let pending = pageImageCache.current.get(imagePath)
      if (!pending) {
        pending = window.api.getPageImage(projectPath, imagePath)
        pageImageCache.current.set(imagePath, pending)
      }
      pending
        .then((dataUrl) => cropImage(dataUrl, word.bbox, CROP_PADDING))
        .then((url) => {
          if (!cancelled) setCropUrl(url)
        })
        .catch(() => {
          if (!cancelled) setCropUrl(null)
          // Drop a failed fetch from the cache so a later hover can retry.
          if (pageImageCache.current.get(imagePath) === pending) {
            pageImageCache.current.delete(imagePath)
          }
        })
    }, SHOW_DELAY_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // Re-run when the hovered token (its id/bbox) or eligibility changes.
  }, [eligible, word?.id, word?.bbox, project, projectPath])

  // Drop the cache when the project changes so stale pixels never leak across.
  useEffect(() => {
    pageImageCache.current = new Map()
  }, [projectPath])

  if (!eligible || !cursor || !cropUrl) return null

  // Offset from the cursor; keep it inside the viewport on the right/bottom.
  const OFFSET = 16
  const MAX_W = 360
  const left = Math.min(cursor.x + OFFSET, window.innerWidth - MAX_W - 8)
  const top = cursor.y + OFFSET

  return (
    <div
      className="image-crop-popover"
      style={{ left: `${Math.max(8, left)}px`, top: `${top}px` }}
      role="img"
      aria-label="Source scan crop of hovered word"
    >
      <img className="image-crop-popover__img" src={cropUrl} alt="" />
      {word && (
        <div className="image-crop-popover__meta">
          OCR “{word.text}” · {Math.round(word.confidence)}%
        </div>
      )}
    </div>
  )
}
