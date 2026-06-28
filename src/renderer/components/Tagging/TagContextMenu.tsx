/**
 * TagContextMenu — the right-click "assign what this is" menu (SPEC §5).
 *
 * Lists every StructuralTagType. Picking a type dispatches ADD_TAG with a new
 * tag covering the current selection range. Headings seed `data:{level:1}`.
 *
 * Footnote is special (SPEC §5: it does two jobs). The first selection is the
 * NOTE text; choosing "Footnote" enters a two-step flow that asks the user to
 * select the in-text reference mark and confirm. We then build the tag's `data`
 * via `footnoteTagData(linkFootnote({ markdown, refRange, noteRange }))` so the
 * note is pulled from the flow and re-linked to its reference for XeLaTeX.
 *
 * Hosted by OutputPane, which supplies the selection range and a getter for the
 * live selection used during the footnote's second step.
 */
import { useEffect, useState } from 'react'
import './TagContextMenu.css'
import type { OutputRange, StructuralTag, StructuralTagType } from '@core/model'
import { linkFootnote, footnoteTagData } from '@core/structure'
import { useReview } from '../../store/ReviewContext'
import { TAG_META, TAG_TYPES, newTagId } from './tag-meta'

export interface TagContextMenuProps {
  open: boolean
  x: number
  y: number
  /** The selection range captured when the menu opened (note text for footnotes). */
  range: OutputRange | null
  onClose: () => void
  /**
   * Read the live selection range — used for the footnote second step, where the
   * user makes a NEW selection (the reference mark) while the menu is open.
   */
  getLiveRange?: () => OutputRange | null
}

export function TagContextMenu({
  open,
  x,
  y,
  range,
  onClose,
  getLiveRange
}: TagContextMenuProps): JSX.Element | null {
  const { state, dispatch } = useReview()
  const markdown = state.project?.markdown ?? ''

  // When set, we're in the footnote second step holding the note range.
  const [footnoteNoteRange, setFootnoteNoteRange] = useState<OutputRange | null>(null)

  // Reset footnote flow whenever the menu reopens or closes.
  useEffect(() => {
    if (!open) setFootnoteNoteRange(null)
  }, [open])

  if (!open) return null

  const addSimpleTag = (type: StructuralTagType): void => {
    if (!range) {
      onClose()
      return
    }
    const tag: StructuralTag = {
      id: newTagId(),
      type,
      range,
      ...(type === 'heading' ? { data: { level: 1 } } : {})
    }
    dispatch({ type: 'ADD_TAG', tag })
    onClose()
  }

  const beginFootnote = (): void => {
    if (!range) {
      onClose()
      return
    }
    // First selection is the note text; keep the menu open for step two.
    setFootnoteNoteRange(range)
  }

  const confirmFootnote = (): void => {
    const noteRange = footnoteNoteRange
    const refRange = getLiveRange?.() ?? null
    if (!noteRange || !refRange) return

    const link = linkFootnote({ markdown, refRange, noteRange })
    const tag: StructuralTag = {
      id: newTagId(),
      type: 'footnote',
      range: noteRange,
      data: footnoteTagData(link)
    }
    dispatch({ type: 'ADD_TAG', tag })
    setFootnoteNoteRange(null)
    onClose()
  }

  const onPick = (type: StructuralTagType): void => {
    if (type === 'footnote') beginFootnote()
    else addSimpleTag(type)
  }

  return (
    <>
      <div className="tag-menu-backdrop" onMouseDown={onClose} />
      <div
        className="tag-menu"
        role="menu"
        style={{ left: x, top: y }}
        // Don't let clicks inside bubble to the backdrop / clear the selection.
        onMouseDown={(e) => e.stopPropagation()}
      >
        {footnoteNoteRange ? (
          <div className="tag-menu-footnote-step">
            <p className="tag-menu-hint">
              Footnote note captured. Now select the in-text reference mark, then confirm.
            </p>
            <div className="tag-menu-actions">
              <button type="button" className="tag-menu-confirm" onMouseDown={confirmFootnote}>
                Link reference
              </button>
              <button type="button" className="tag-menu-cancel" onMouseDown={onClose}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <ul className="tag-menu-list">
            {TAG_TYPES.map((type) => {
              const meta = TAG_META[type]
              return (
                <li key={type}>
                  <button
                    type="button"
                    role="menuitem"
                    className="tag-menu-item"
                    onMouseDown={() => onPick(type)}
                  >
                    <span className="tag-menu-swatch" style={{ background: meta.color }} />
                    {meta.label}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
