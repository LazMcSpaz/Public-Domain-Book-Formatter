/**
 * The proofing workbench: one source leaf, its scan, and what was read off it.
 *
 * Deliberately not a page of the finished book. This edition repaginates, so a
 * finished page corresponds to nothing the user can hold the scan against —
 * whereas a source leaf is exactly what they are checking, and bounding the
 * screen to one of them is also what keeps a three-hundred-page book from
 * putting thousands of text boxes in the DOM at once.
 *
 * Every change is a `BookEdit` appended to a list, never a write into the
 * transcription. The transcription is the one thing the user paid for; edits
 * are re-applied over it, so they can be undone and the book can be
 * re-assembled underneath them.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BookDocument } from '@core/assemble'
import type { BlockKind, VerificationFinding } from '@core/transcribe'
import {
  countEdited,
  nextFlaggedPage,
  proofSheet,
  withEdit,
  type BookEdit,
  type ProofPage
} from '@core/edits'

export interface ProofSheetProps {
  /** The book as the pass read it, before any corrections. */
  document: BookDocument
  edits: BookEdit[]
  onChange: (edits: BookEdit[]) => void
  /**
   * The page thumbnail recon already has — shown at once, so the sheet is never
   * blank while the readable render is being made.
   */
  resolveScan: (pageIndex: number) => string | undefined
  /**
   * A render of the leaf big enough to read. Awaited per page rather than held
   * for the whole book: legible renders of three hundred leaves would be
   * hundreds of megabytes, and only one is ever on screen.
   *
   * The URL it returns is revoked here when the user moves on.
   */
  loadScan?: (pageIndex: number) => Promise<string | undefined>
  findings?: VerificationFinding[]
  uncertainties?: { pageIndex: number; text: string }[]
  reviewedPages?: number[]
}

/**
 * The kinds a block can be retyped to.
 *
 * Every one changes what the block *is*, which the style system then knows how
 * to set. There is deliberately no way to indent one paragraph or add a line
 * break: in a book that reflows to whatever measure the design gate settles on,
 * those are not corrections but damage that survives until someone notices the
 * page looks typed rather than set.
 */
const KINDS: { value: BlockKind; label: string }[] = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'heading', label: 'Heading' },
  { value: 'blockquote', label: 'Quotation' },
  { value: 'verse', label: 'Verse' },
  { value: 'epigraph', label: 'Epigraph' },
  { value: 'caption', label: 'Caption' },
  { value: 'list-item', label: 'List item' }
]

export function ProofSheet({
  document: doc,
  edits,
  onChange,
  resolveScan,
  loadScan,
  findings,
  uncertainties,
  reviewedPages
}: ProofSheetProps): JSX.Element {
  const pages = useMemo(
    () =>
      proofSheet({
        document: doc,
        ...(findings ? { findings } : {}),
        ...(uncertainties ? { uncertainties } : {}),
        ...(reviewedPages ? { reviewedPages } : {})
      }),
    [doc, findings, uncertainties, reviewedPages]
  )

  // Open on the first page something flagged, since that is where the app has
  // an opinion — and on the first page otherwise.
  const [pageIndex, setPageIndex] = useState<number>(
    () => nextFlaggedPage(pages, -1) ?? pages[0]?.pageIndex ?? 0
  )

  const at = pages.findIndex((p) => p.pageIndex === pageIndex)
  const page: ProofPage | undefined = pages[at < 0 ? 0 : at]
  const flaggedCount = pages.filter((p) => p.flags.length > 0).length
  const changed = countEdited(edits)

  // What each block currently says, with the edits already on it, so the boxes
  // show the corrected text rather than resetting to the misreading.
  const currentText = useMemo(() => {
    const out = new Map<string, string>()
    for (const edit of edits) if (edit.kind === 'text') out.set(edit.blockId, edit.text)
    return out
  }, [edits])
  const currentKind = useMemo(() => {
    const out = new Map<string, BlockKind>()
    for (const edit of edits) if (edit.kind === 'retype') out.set(edit.blockId, edit.blockKind)
    return out
  }, [edits])
  const dropped = useMemo(
    () => new Set(edits.filter((e) => e.kind === 'drop').map((e) => e.blockId)),
    [edits]
  )

  // The legible render of the leaf on screen, and the one before it, so the
  // previous URL is revoked exactly once when it is replaced.
  const [readable, setReadable] = useState<string | null>(null)
  const readableRef = useRef<string | null>(null)

  useEffect(() => {
    if (!loadScan) return
    let cancelled = false

    // Drop the previous leaf's render straight away. Keeping it until the new
    // one arrives would show the *wrong page's* scan beside this page's text,
    // which is worse than a moment of the right page at thumbnail size.
    setReadable(null)

    void loadScan(pageIndex).then((url) => {
      if (!url) return
      // Arrived after the user moved on: revoke it rather than leaking a
      // render nobody will see.
      if (cancelled) {
        URL.revokeObjectURL(url)
        return
      }
      if (readableRef.current) URL.revokeObjectURL(readableRef.current)
      readableRef.current = url
      setReadable(url)
    })

    return () => {
      cancelled = true
    }
  }, [pageIndex, loadScan])

  // Unmounting has to revoke the last one too, or a session's worth of leaves
  // stays resident.
  useEffect(
    () => () => {
      if (readableRef.current) URL.revokeObjectURL(readableRef.current)
      readableRef.current = null
    },
    []
  )

  const push = (edit: BookEdit): void => onChange(withEdit(edits, edit))
  const undo = (blockId: string): void =>
    onChange(edits.filter((e) => e.kind === 'anchor' || e.blockId !== blockId))

  if (!page) {
    return <div className="proof empty">There is no text to proofread.</div>
  }

  // The readable render when it has arrived, the thumbnail until then.
  const scan = readable ?? resolveScan(page.pageIndex)

  return (
    <div className="proof">
      <div className="proof-bar">
        <button
          type="button"
          disabled={at <= 0}
          onClick={() => setPageIndex(pages[Math.max(0, at - 1)]!.pageIndex)}
        >
          ‹ Previous
        </button>
        <span className="proof-where">
          Leaf {page.pageIndex + 1}
          <small>
            {at + 1} of {pages.length}
            {changed > 0 ? ` · ${changed} corrected` : ''}
          </small>
        </span>
        <button
          type="button"
          disabled={at >= pages.length - 1}
          onClick={() => setPageIndex(pages[Math.min(pages.length - 1, at + 1)]!.pageIndex)}
        >
          Next ›
        </button>
        {flaggedCount > 0 ? (
          <button
            type="button"
            className="proof-flagged"
            onClick={() => {
              const next = nextFlaggedPage(pages, page.pageIndex)
              if (next !== null) setPageIndex(next)
            }}
          >
            Next of {flaggedCount} flagged
          </button>
        ) : null}
      </div>

      {page.flags.length > 0 ? (
        <ul className="proof-flags">
          {page.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}

      <div className="proof-body">
        <figure className="proof-scan">
          {scan ? <img src={scan} alt={`Scan of leaf ${page.pageIndex + 1}`} /> : null}
          <figcaption>{readable ? 'The scan, as it came in' : 'The scan — sharpening…'}</figcaption>
        </figure>

        <div className="proof-blocks">
          {page.blocks.length === 0 ? (
            <p className="proof-note">
              No text was read off this leaf
              {page.illustrationIds.length > 0 ? ' — it carries a picture.' : '.'}
            </p>
          ) : null}

          {page.blocks.map(({ block, alsoFromPages }) => {
            const text = currentText.get(block.id) ?? block.text
            const kind = currentKind.get(block.id) ?? block.kind
            const isDropped = dropped.has(block.id)
            const edited = edits.some((e) => e.kind !== 'anchor' && e.blockId === block.id)

            return (
              <div key={block.id} className={`proof-block${isDropped ? ' dropped' : ''}`}>
                <div className="proof-block-bar">
                  <select
                    value={kind}
                    aria-label="What this is"
                    onChange={(e) =>
                      push({
                        kind: 'retype',
                        blockId: block.id,
                        blockKind: e.target.value as BlockKind,
                        ...(e.target.value === 'heading' ? { level: block.level ?? 1 } : {})
                      })
                    }
                  >
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>

                  {alsoFromPages.length > 0 ? (
                    <span className="proof-seam">
                      runs on to leaf {alsoFromPages.map((p) => p + 1).join(', ')}
                    </span>
                  ) : null}

                  <span className="proof-actions">
                    <button
                      type="button"
                      title="Join this to the one after it"
                      onClick={() => onChange([...edits, { kind: 'merge', blockId: block.id }])}
                    >
                      Join ↓
                    </button>
                    <button
                      type="button"
                      title="Not part of the book"
                      onClick={() => push({ kind: 'drop', blockId: block.id })}
                    >
                      Remove
                    </button>
                    {edited ? (
                      <button type="button" title="Undo my changes" onClick={() => undo(block.id)}>
                        Undo
                      </button>
                    ) : null}
                  </span>
                </div>

                <textarea
                  value={text}
                  spellCheck
                  rows={Math.max(2, Math.ceil(text.length / 70))}
                  aria-label={`Text of block ${block.id}`}
                  onChange={(e) => push({ kind: 'text', blockId: block.id, text: e.target.value })}
                  onSelect={(e) => {
                    // A split is "put the break where the cursor is", which is
                    // the only way to say it without inventing a syntax.
                    const el = e.currentTarget
                    el.dataset['caret'] = String(el.selectionStart)
                  }}
                />

                <div className="proof-split">
                  <button
                    type="button"
                    onClick={(e) => {
                      const area = e.currentTarget
                        .closest('.proof-block')
                        ?.querySelector('textarea')
                      const caret = Number(area?.dataset['caret'] ?? '0')
                      if (caret > 0) {
                        onChange([...edits, { kind: 'split', blockId: block.id, at: caret }])
                      }
                    }}
                  >
                    Split at the cursor
                  </button>
                </div>
              </div>
            )
          })}

          {page.illustrationIds.length > 0 ? (
            <p className="proof-note">
              {page.illustrationIds.length} illustration(s) were cut from this leaf.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
