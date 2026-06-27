/**
 * OutputPane — the formatted-output side of the review instrument (SPEC §4).
 *
 * Renders `project.markdown` as a sequence of contentEditable paragraphs, each
 * built from coordinate-map entries so mapped words drive hover-sync and
 * confidence tinting while the surrounding text shows verbatim. Inline editing
 * is span-level contentEditable: edits are read back from the DOM, debounced,
 * and dispatched as SET_MARKDOWN with the edited paragraphs' token ids marked
 * dirty (their mapping is stale until re-OCR).
 *
 * Caret preservation: React must NOT re-render the paragraphs in response to the
 * user's own keystrokes (that would reset the caret). We track the last markdown
 * we emitted; when the incoming `project.markdown` matches it we keep rendering
 * the DOM the user is editing untouched. Only EXTERNAL markdown changes (e.g.
 * find-replace) — which differ from what we emitted — trigger a fresh render.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import './OutputPane.css'
import { useReview } from '../../store/ReviewContext'
import { useHoverSync } from '../../hooks/useHoverSync'
import { splitParagraphs } from '../../utils/markdown-to-spans'
import { ParagraphView } from './ParagraphView'

/** No-OCR-flag tokens are trusted: high confidence so they never tint. */
const DEFAULT_CONFIDENCE = 100

/** Debounce window for committing inline edits (ms). */
const EDIT_DEBOUNCE_MS = 300

export interface OutputPaneProps {
  containerRef: RefObject<HTMLDivElement>
}

export function OutputPane({ containerRef }: OutputPaneProps): JSX.Element | null {
  const { state, dispatch } = useReview()
  const { hoverTokenId, setHoverFromOutput, clearHover } = useHoverSync()

  const project = state.project
  const markdown = project?.markdown ?? ''

  // Markdown we last emitted ourselves — used to skip re-rendering on self-edits.
  const lastEmittedRef = useRef<string | null>(null)
  // Markdown currently committed to the DOM (only changes on external edits).
  const [renderMarkdown, setRenderMarkdown] = useState(markdown)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Sync renderMarkdown from external markdown changes only. When the incoming
  // markdown equals what we just emitted, the DOM is already correct (the user
  // typed it), so we leave it alone to preserve the caret.
  useEffect(() => {
    if (markdown === lastEmittedRef.current) return
    lastEmittedRef.current = null
    setRenderMarkdown(markdown)
  }, [markdown])

  // tokenId → OCR confidence, derived once from the project's OCR flags.
  const confidenceMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const flag of project?.flags ?? []) {
      if (flag.kind === 'ocr') map.set(flag.tokenId, flag.confidence)
    }
    return map
  }, [project?.flags])

  const confidenceOf = useCallback(
    (tokenId: string): number => confidenceMap.get(tokenId) ?? DEFAULT_CONFIDENCE,
    [confidenceMap]
  )

  // Paragraphs are derived from renderMarkdown (the committed DOM text), NOT the
  // live store markdown, so self-edits don't re-slice and remount mid-type.
  const paragraphs = useMemo(
    () => splitParagraphs(renderMarkdown, project?.coordinateMap ?? []),
    [renderMarkdown, project?.coordinateMap]
  )

  const commitEdit = useCallback(() => {
    const body = bodyRef.current
    if (!body) return

    const paraEls = Array.from(body.querySelectorAll<HTMLElement>('.paragraph'))
    const nextMarkdown = paraEls.map((el) => el.textContent ?? '').join('\n\n')

    // Token ids inside edited paragraphs lose reliable mapping. We mark every
    // token id currently rendered in the DOM dirty whenever the text changed —
    // a paragraph's tokens are only meaningful while its text is untouched.
    const dirty: string[] = []
    for (const el of paraEls) {
      for (const span of el.querySelectorAll<HTMLElement>('[data-token-id]')) {
        const id = span.dataset.tokenId
        if (id) dirty.push(id)
      }
    }

    if (nextMarkdown === renderMarkdown) return

    lastEmittedRef.current = nextMarkdown
    dispatch({ type: 'SET_MARKDOWN', markdown: nextMarkdown, dirtyTokenIds: dirty })
  }, [dispatch, renderMarkdown])

  const onInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(commitEdit, EDIT_DEBOUNCE_MS)
  }, [commitEdit])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  if (!project) return null

  return (
    <div className="output-pane-root" ref={containerRef}>
      <div
        className={`output-body${state.readingPrefs.confidenceTint ? ' tint-on' : ''}`}
        ref={bodyRef}
        onMouseLeave={clearHover}
        onInput={onInput}
      >
        {paragraphs.map((paragraph) => (
          <ParagraphView
            key={paragraph.start}
            paragraph={paragraph}
            hoverTokenId={hoverTokenId}
            dirtyTokenIds={state.dirtyTokenIds}
            confidenceOf={confidenceOf}
            onHover={setHoverFromOutput}
          />
        ))}
      </div>
    </div>
  )
}
