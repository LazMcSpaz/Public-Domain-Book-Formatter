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
import { ImageEditor } from './ImageEditor'
import type { ImageEditOp } from '@core/model'
import {
  blockOf,
  countEdited,
  nextFlaggedPage,
  proofSheet,
  withEdit,
  type Attention,
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
  /**
   * Take a picture the editor picked and make it part of the book: decode it,
   * keep its bytes for the writer, and hand back the id and pixel size the
   * document needs. Returns null when the file could not be read.
   */
  addImage?: (
    file: File,
    afterBlockId: string
  ) => Promise<{ imageId: string; sourceWidth: number; sourceHeight: number } | null>
  /** A preview URL for a picture as it currently stands, retouched and all. */
  imagePreview?: (imageId: string) => string | undefined
  /**
   * Every picture in the book that can be retouched, cut from the scan or
   * supplied — the editing mode applies to both, since a crop out of a scan is
   * exactly the thing most likely to need straightening.
   */
  pictures?: {
    id: string
    /** Pixel size before any retouching — what a crop is measured against. */
    sourceWidth: number
    sourceHeight: number
    /** Pixel size after it — what the book will actually print with. */
    currentWidth: number
    currentHeight: number
    /** The leaf it was cut from, or null for one the editor supplied. */
    pageIndex: number | null
  }[]
  findings?: VerificationFinding[]
  uncertainties?: { pageIndex: number; text: string }[]
  reviewedPages?: number[]
  /** Leaves the user asked to be brought back to at the uncertainty gate. */
  attention?: Attention[]
}

/** The last few words before a point, so a note can say what it is attached to. */
function snippet(text: string, at: number): string {
  const before = text.slice(0, Math.max(0, Math.min(text.length, at))).trimEnd()
  const words = before.split(/\s+/u).filter(Boolean).slice(-4).join(' ')
  return words.length > 0 ? `…${words}` : 'the start'
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
  { value: 'list-item', label: 'List item' },
  { value: 'table', label: 'Table' }
]

export function ProofSheet({
  document: doc,
  edits,
  onChange,
  resolveScan,
  loadScan,
  addImage,
  imagePreview,
  pictures,
  findings,
  uncertainties,
  reviewedPages,
  attention
}: ProofSheetProps): JSX.Element {
  const pages = useMemo(
    () =>
      proofSheet({
        document: doc,
        ...(findings ? { findings } : {}),
        ...(uncertainties ? { uncertainties } : {}),
        ...(reviewedPages ? { reviewedPages } : {}),
        ...(attention ? { attention } : {})
      }),
    [doc, findings, uncertainties, reviewedPages, attention]
  )

  // Open on the first page something flagged, since that is where the app has
  // an opinion — and on the first page otherwise. Deliberately not on the first
  // leaf the user marked: the sheet is read in page order, and the marked ones
  // have their own jump button rather than jumping the queue.
  const [pageIndex, setPageIndex] = useState<number>(
    () => nextFlaggedPage(pages, -1) ?? pages[0]?.pageIndex ?? 0
  )

  const at = pages.findIndex((p) => p.pageIndex === pageIndex)
  const page: ProofPage | undefined = pages[at < 0 ? 0 : at]
  const flaggedCount = pages.filter((p) => p.flags.length > 0).length
  // Leaves the user themselves put on the list. They get their own jump button:
  // a to-do that has to be found among forty cross-check warnings is a to-do
  // that gets missed.
  const markedPages = useMemo(() => pages.filter((p) => p.marked), [pages])
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

  // The editor's own notes, grouped by the block they hang off.
  const notesByBlock = useMemo(() => {
    const out = new Map<string, (BookEdit & { kind: 'note' })[]>()
    for (const edit of edits) {
      if (edit.kind !== 'note') continue
      const list = out.get(edit.blockId) ?? []
      list.push(edit)
      out.set(edit.blockId, list)
    }
    for (const list of out.values()) list.sort((a, b) => a.at - b.at)
    return out
  }, [edits])

  const push = (edit: BookEdit): void => onChange(withEdit(edits, edit))
  // Notes survive an undo of the block's corrections: they are the editor's own
  // writing, not a correction to be reverted.
  const undo = (blockId: string): void =>
    onChange(edits.filter((e) => e.kind === 'note' || blockOf(e) !== blockId))
  const removeNote = (noteId: string): void =>
    onChange(edits.filter((e) => e.kind !== 'note' || e.noteId !== noteId))

  /** Pictures the editor added, grouped by the block they follow. */
  const imagesByBlock = useMemo(() => {
    const out = new Map<string, (BookEdit & { kind: 'image' })[]>()
    for (const edit of edits) {
      if (edit.kind !== 'image' || edit.afterBlockId === null) continue
      const list = out.get(edit.afterBlockId) ?? []
      list.push(edit)
      out.set(edit.afterBlockId, list)
    }
    return out
  }, [edits])

  const removeImage = (imageId: string): void =>
    onChange(edits.filter((e) => e.kind !== 'image' || e.imageId !== imageId))

  /** The op stack currently on each picture. */
  const opsById = useMemo(() => {
    const out = new Map<string, ImageEditOp[]>()
    for (const edit of edits) if (edit.kind === 'retouch') out.set(edit.illustrationId, edit.ops)
    return out
  }, [edits])

  const setOps = (illustrationId: string, ops: ImageEditOp[]): void =>
    onChange(
      ops.length === 0
        ? edits.filter((e) => e.kind !== 'retouch' || e.illustrationId !== illustrationId)
        : withEdit(edits, { kind: 'retouch', illustrationId, ops })
    )

  /** Pictures cut from the leaf on screen, so they can be retouched from here. */
  const picturesOnLeaf = (pageIndex: number) =>
    (pictures ?? []).filter((p) => p.pageIndex === pageIndex)
  const pictureById = (id: string) => (pictures ?? []).find((p) => p.id === id)

  /** The divisions the editor has written, in the order they will be set. */
  const sections = useMemo(
    () => edits.filter((e): e is BookEdit & { kind: 'section' } => e.kind === 'section'),
    [edits]
  )
  const removeSection = (sectionId: string): void =>
    onChange(edits.filter((e) => e.kind !== 'section' || e.sectionId !== sectionId))

  /** The caret in a block's text box, for "put it where I am looking". */
  const caretOf = (el: Element | null): number =>
    Number(el?.closest('.proof-block')?.querySelector('textarea')?.dataset['caret'] ?? '0')

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
        {markedPages.length > 0 ? (
          <button
            type="button"
            className="proof-flagged proof-marked"
            onClick={() => {
              const next = nextFlaggedPage(markedPages, page.pageIndex)
              if (next !== null) setPageIndex(next)
            }}
          >
            Next of {markedPages.length} to fix
          </button>
        ) : null}
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
        <ul className={page.marked ? 'proof-flags marked' : 'proof-flags'}>
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
            const edited = edits.some((e) => blockOf(e) === block.id)

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

                {kind === 'table' ? (
                  <p className="proof-hint">
                    One row to a line, cells separated by a vertical bar. The columns are measured
                    and set to this edition’s page, so the original’s spacing and leader dots are
                    not needed.
                  </p>
                ) : null}

                <textarea
                  value={text}
                  spellCheck={kind !== 'table'}
                  className={kind === 'table' ? 'proof-table' : undefined}
                  rows={
                    kind === 'table'
                      ? Math.max(2, text.split('\n').length)
                      : Math.max(2, Math.ceil(text.length / 70))
                  }
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
                      const caret = caretOf(e.currentTarget)
                      if (caret > 0) {
                        onChange([...edits, { kind: 'split', blockId: block.id, at: caret }])
                      }
                    }}
                  >
                    Split at the cursor
                  </button>
                  {addImage ? (
                    <label className="proof-add-image">
                      Add a picture after this
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          // Cleared so picking the same file twice still fires.
                          e.target.value = ''
                          if (!file) return
                          void addImage(file, block.id).then((added) => {
                            if (added)
                              onChange([
                                ...edits,
                                { kind: 'image', ...added, afterBlockId: block.id }
                              ])
                          })
                        }}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    title="Attach a note of your own at the cursor"
                    onClick={(e) => {
                      const at = caretOf(e.currentTarget) || text.length
                      onChange([
                        ...edits,
                        {
                          kind: 'note',
                          // Minted from the clock rather than counted, so an id
                          // is never reused after a note is removed — a reused
                          // one would silently overwrite a note in the saved list.
                          noteId: `ed${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
                          blockId: block.id,
                          at,
                          text: ''
                        }
                      ])
                    }}
                  >
                    Add a note here
                  </button>
                </div>

                {(imagesByBlock.get(block.id) ?? []).map((image) => {
                  const preview = imagePreview?.(image.imageId)
                  return (
                    <div key={image.imageId} className="proof-picture">
                      <span className="proof-annotation-bar">
                        <span className="proof-annotation-label">
                          Your picture — {image.sourceWidth}×{image.sourceHeight} pixels
                        </span>
                        <button type="button" onClick={() => removeImage(image.imageId)}>
                          Remove picture
                        </button>
                      </span>
                      <input
                        type="text"
                        value={image.caption ?? ''}
                        placeholder="Caption (optional) — set under the picture"
                        aria-label="Caption for your picture"
                        onChange={(e) => push({ ...image, caption: e.target.value })}
                      />
                      <ImageEditor
                        previewUrl={preview}
                        sourceWidth={image.sourceWidth}
                        sourceHeight={image.sourceHeight}
                        currentWidth={pictureById(image.imageId)?.currentWidth ?? image.sourceWidth}
                        currentHeight={
                          pictureById(image.imageId)?.currentHeight ?? image.sourceHeight
                        }
                        ops={opsById.get(image.imageId) ?? []}
                        onChange={(ops) => setOps(image.imageId, ops)}
                      />
                    </div>
                  )
                })}

                {(notesByBlock.get(block.id) ?? []).map((note) => (
                  <div key={note.noteId} className="proof-annotation">
                    <span className="proof-annotation-bar">
                      <span className="proof-annotation-label">
                        Your note, after “{snippet(text, note.at)}”
                      </span>
                      <button type="button" onClick={() => removeNote(note.noteId)}>
                        Remove note
                      </button>
                    </span>
                    <textarea
                      value={note.text}
                      spellCheck
                      rows={2}
                      placeholder="Your note — it is set at the foot of the page this falls on."
                      aria-label="Your note"
                      onChange={(e) => push({ ...note, text: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            )
          })}

          {picturesOnLeaf(page.pageIndex).map((picture) => (
            <div key={picture.id} className="proof-picture">
              <span className="proof-annotation-bar">
                <span className="proof-annotation-label">Cut from this leaf</span>
              </span>
              <ImageEditor
                previewUrl={imagePreview?.(picture.id)}
                sourceWidth={picture.sourceWidth}
                sourceHeight={picture.sourceHeight}
                currentWidth={picture.currentWidth}
                currentHeight={picture.currentHeight}
                ops={opsById.get(picture.id) ?? []}
                onChange={(ops) => setOps(picture.id, ops)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Divisions belong to the book rather than to any one leaf, so they sit
          below the sheet and stay put as the user pages through it. */}
      <div className="proof-sections">
        <div className="proof-sections-bar">
          <span className="proof-annotation-label">Writing of your own</span>
          <span className="proof-actions">
            <button type="button" onClick={() => onChange([...edits, newSection('front')])}>
              Add an introduction
            </button>
            <button type="button" onClick={() => onChange([...edits, newSection('back')])}>
              Add an afterword
            </button>
          </span>
        </div>

        {sections.length === 0 ? (
          <p className="proof-note">
            An introduction or an afterword of your own is set as a division of the book, listed in
            the contents — and is what makes a public-domain reprint yours.
          </p>
        ) : null}

        {sections.map((section) => (
          <div key={section.sectionId} className="proof-section">
            <div className="proof-block-bar">
              <input
                type="text"
                className="proof-section-title"
                value={section.title}
                aria-label="Title of this division"
                onChange={(e) => push({ ...section, title: e.target.value })}
              />
              <span className="proof-seam">
                {section.placement === 'front' ? 'before the book' : 'after the book'}
              </span>
              <span className="proof-actions">
                <button type="button" onClick={() => removeSection(section.sectionId)}>
                  Remove
                </button>
              </span>
            </div>
            <textarea
              value={section.text}
              spellCheck
              rows={8}
              placeholder={
                'Write here. Leave a blank line between paragraphs — the book is set from ' +
                'them, so there is no formatting to learn.'
              }
              aria-label={`Text of ${section.title}`}
              onChange={(e) => push({ ...section, text: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** A fresh division, named so the editor can see what it will be called. */
function newSection(placement: 'front' | 'back'): BookEdit {
  return {
    kind: 'section',
    // Minted from the clock so an id is never reused after one is removed.
    sectionId: `sec${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
    placement,
    title: placement === 'front' ? 'Introduction' : 'Afterword',
    text: ''
  }
}
