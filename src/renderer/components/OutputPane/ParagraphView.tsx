/**
 * ParagraphView — one contentEditable paragraph of the output (SPEC §4 inline
 * editing). Renders the paragraph's pre-sliced SpanNodes: plain strings as text,
 * mapped entries as <WordSpan>. Carries `data-para-start` so the pane can
 * reconstruct absolute offsets / document order on edit.
 *
 * Editing is handled by the parent OutputPane via a debounced `onInput` on the
 * output root (event delegation), so this component just renders; it must not
 * re-render mid-edit from the user's own keystrokes (the parent guards that by
 * skipping re-sync of self-emitted markdown).
 */
import { Fragment } from 'react'
import type { Paragraph } from '../../utils/markdown-to-spans'
import { WordSpan, type TagDecoration } from './WordSpan'

export interface ParagraphViewProps {
  paragraph: Paragraph
  hoverTokenId: string | null
  dirtyTokenIds: ReadonlySet<string>
  /** tokenId → OCR confidence (0–100); high default applied by the parent. */
  confidenceOf: (tokenId: string) => number
  /** Structural-tag decoration for a token's output range, or undefined. */
  decorationOf: (start: number, end: number) => TagDecoration | undefined
  onHover: (offset: number) => void
}

export function ParagraphView({
  paragraph,
  hoverTokenId,
  dirtyTokenIds,
  confidenceOf,
  decorationOf,
  onHover
}: ParagraphViewProps): JSX.Element {
  return (
    <div
      className="paragraph"
      data-para-start={paragraph.start}
      contentEditable
      suppressContentEditableWarning
    >
      {paragraph.nodes.map((node, i) => {
        if (node.entry) {
          return (
            <WordSpan
              key={`${node.entry.tokenId}-${i}`}
              entry={node.entry}
              text={node.text}
              confidence={confidenceOf(node.entry.tokenId)}
              isHovered={node.entry.tokenId === hoverTokenId}
              isDirty={dirtyTokenIds.has(node.entry.tokenId)}
              decoration={decorationOf(node.entry.output.start, node.entry.output.end)}
              onHover={onHover}
            />
          )
        }
        return <Fragment key={`t-${i}`}>{node.text}</Fragment>
      })}
    </div>
  )
}
