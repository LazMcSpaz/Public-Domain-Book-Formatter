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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject
} from 'react'
import './OutputPane.css'
import type { OutputRange } from '@core/model'
import { useReview } from '../../store/ReviewContext'
import { useHoverSync } from '../../hooks/useHoverSync'
import { useSelectionRange } from '../../hooks/useSelectionRange'
import { splitParagraphs } from '../../utils/markdown-to-spans'
import { ParagraphView } from './ParagraphView'
import { buildDecorationIndex } from './tag-decorations'
import { TagContextMenu } from '../Tagging'

/** No-OCR-flag tokens are trusted: high confidence so they never tint. */
const DEFAULT_CONFIDENCE = 100

/** Debounce window for committing inline edits (ms). */
const EDIT_DEBOUNCE_MS = 300

/**
 * Read a paragraph element's text for markdown reconstruction, excluding the
 * decoration-only tag badges (SPEC §5) so they never leak into the document.
 */
function paragraphText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement
  for (const badge of clone.querySelectorAll('.tag-badge')) badge.remove()
  return clone.textContent ?? ''
}

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

  // Selection → markdown range, used by the right-click tag menu (SPEC §5).
  const getSelectionRange = useSelectionRange(bodyRef)

  // Context-menu state: open + cursor position + captured selection range.
  const [menu, setMenu] = useState<{ x: number; y: number; range: OutputRange | null } | null>(null)

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

  // Per-token structural-tag decoration lookup, rebuilt when tags / active tag
  // change. WordSpans query it by their output range to render tag styling.
  const decorationIndex = useMemo(
    () => buildDecorationIndex(project?.tags ?? [], state.activeTagId),
    [project?.tags, state.activeTagId]
  )
  const decorationOf = useCallback(
    (start: number, end: number) => decorationIndex.at(start, end),
    [decorationIndex]
  )

  // Right-click in the output body opens the tag menu at the cursor, carrying
  // the current selection range (note text for the footnote two-step flow).
  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      const range = getSelectionRange()
      if (!range) return // no selection → let the native menu through
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, range })
    },
    [getSelectionRange]
  )

  const closeMenu = useCallback(() => setMenu(null), [])

  const commitEdit = useCallback(() => {
    const body = bodyRef.current
    if (!body) return

    const paraEls = Array.from(body.querySelectorAll<HTMLElement>('.paragraph'))
    // Tag badges (SPEC §5) are decoration-only (contentEditable=false). Strip
    // them from a clone before reading text so they never enter the markdown.
    const nextMarkdown = paraEls.map((el) => paragraphText(el)).join('\n\n')

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
        onContextMenu={onContextMenu}
      >
        {paragraphs.map((paragraph) => (
          <ParagraphView
            key={paragraph.start}
            paragraph={paragraph}
            hoverTokenId={hoverTokenId}
            dirtyTokenIds={state.dirtyTokenIds}
            confidenceOf={confidenceOf}
            decorationOf={decorationOf}
            onHover={setHoverFromOutput}
          />
        ))}
      </div>
      <TagContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        range={menu?.range ?? null}
        getLiveRange={getSelectionRange}
        onClose={closeMenu}
      />
    </div>
  )
}
