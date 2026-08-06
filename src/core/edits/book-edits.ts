/**
 * Corrections to a book that has already been read.
 *
 * Two things go wrong that no amount of care upstream will prevent. The vision
 * pass misreads a word, and there is no gate at which that can be caught by
 * cross-checking — OCR disagreeing is a *hint*, not a verdict, and a page that
 * both witnesses read the same wrong way looks clean. And structure is a
 * judgment: a line the pass called a paragraph really was a heading, or a
 * caption, and only a person looking at the page can say so.
 *
 * Before this module the app had no answer to either. The term grid at Gate 1
 * feeds vocabulary into the *prompt*; it edits nothing. Gate 2 offers to re-read
 * a page, which costs money and may return the same reading. So a book could be
 * exported with a wrong word in it and the user had no way to fix that word.
 *
 * ## Why an edit *list* and not edited text
 *
 * The same reasoning as the image op stack, for the same reason. The
 * transcription is the one artifact the user paid for, so it stays pristine and
 * corrections are re-applied over it every time:
 *
 *   - a correction can be undone, and shown as a correction rather than
 *     silently becoming the text;
 *   - re-assembly is free, so removing a page or accepting a different picture
 *     re-derives the book with the edits still on it;
 *   - what has to be persisted is a handful of small records rather than a
 *     second copy of the book that could drift from the first.
 *
 * Pure: array and string work. No DOM, no I/O.
 */
import type { BlockKind } from '@core/transcribe'
import type { BookBlock, BookDocument } from '@core/assemble'

/**
 * One correction, naming the block it applies to.
 *
 * Deliberately small and closed. Every member is a statement about *content* —
 * what the page says, or what kind of thing it is. None of them is a statement
 * about presentation: there is no "indent this paragraph" or "break the line
 * here", because in a book that reflows to whatever measure the design gate
 * settles on, those are not corrections. They are damage that survives until
 * someone notices the page looks hand-typed. Presentation belongs to the style
 * profile, which applies it to every block of a kind at once.
 */
export type BookEdit =
  /** The pass misread it. `text` replaces the block's text entirely. */
  | { kind: 'text'; blockId: string; text: string }
  /** It is not the kind of thing the pass took it for. */
  | { kind: 'retype'; blockId: string; blockKind: BlockKind; level?: number }
  /** It is not part of the book — a stray running head, a shelf mark. */
  | { kind: 'drop'; blockId: string }
  /**
   * Two paragraphs were run together. Splits at `at`, a character offset into
   * the block's *current* text — after any `text` edit already applied to it.
   */
  | { kind: 'split'; blockId: string; at: number }
  /** One paragraph was broken in two. Joins this block with the one after it. */
  | { kind: 'merge'; blockId: string }
  /**
   * The picture belongs somewhere else. `afterBlockId` is the block it should
   * follow, or null to put it at the very front of the body.
   */
  | { kind: 'anchor'; illustrationId: string; afterBlockId: string | null }
  /**
   * A note the *editor* wrote, attached to a point in a block.
   *
   * The one addition here that is not a correction. It is also the reason this
   * module can offer one at all: a reprint of a public-domain work has to carry
   * something of its editor's to be worth publishing, and an annotation is the
   * cheapest honest way to add it — the footnote machinery already places,
   * renumbers and collects notes, and does not care who wrote them.
   *
   * `at` is a character offset into the block's *current* text, as `split`'s is.
   */
  | { kind: 'note'; noteId: string; blockId: string; at: number; text: string }
  /**
   * A picture the *editor* supplied — a portrait, a map, a photograph of the
   * binding — placed after a block of the editor's choosing.
   *
   * It carries the pixel dimensions rather than the pixels, for the same reason
   * `ImageItem` does: the bytes travel beside the document, keyed by id. Unlike
   * a picture cut out of the scan this one has no source leaf, so `afterBlockId`
   * is the only thing that says where it goes.
   */
  | {
      kind: 'image'
      imageId: string
      afterBlockId: string | null
      sourceWidth: number
      sourceHeight: number
      caption?: string
    }

/** How a split block's halves are named, so the ids stay deterministic. */
const splitId = (id: string, half: number): string => `${id}/${half}`

/**
 * Apply corrections to an assembled book.
 *
 * Order matters and is the caller's: edits are applied in the order given, so a
 * `text` edit followed by a `split` splits the corrected text, which is what
 * someone fixing a run-together paragraph means. An edit naming a block that no
 * longer exists — because an earlier edit dropped or merged it — is skipped
 * rather than throwing. That is not laxness: the list outlives any one session,
 * and a book re-assembled without a page the user later removed genuinely has
 * fewer blocks in it. Refusing to lay the book out at all would be a worse
 * answer than dropping a correction that has nothing left to correct.
 *
 * Pure: returns a new document and never touches the one it was given.
 */
export function applyEdits(doc: BookDocument, edits: readonly BookEdit[]): BookDocument {
  if (edits.length === 0) return doc

  let blocks: BookBlock[] = doc.blocks.map((b) => ({ ...b, sourcePages: [...b.sourcePages] }))
  // Notes the editor wrote, keyed so a later edit to the same one replaces it
  // rather than adding a second note at the same spot.
  const authored = new Map<string, BookEdit & { kind: 'note' }>()
  /** Pictures the editor added, keyed so re-captioning one replaces it. */
  const supplied = new Map<string, BookEdit & { kind: 'image' }>()
  // Illustration anchors are held as an override map and folded in at the end,
  // so a picture re-anchored to a block that a later edit drops falls back to
  // where the engine would have put it rather than vanishing.
  const anchors = new Map<string, string | null>()

  /**
   * Follow an anchor when the block it names stops existing under that name.
   *
   * A split renames a block and a merge removes one, and in both cases "after
   * that block" is still a meaningful place — just a differently-named one.
   * Without this, ordinary editing would silently unpin pictures.
   */
  const rename = (from: string, to: string): void => {
    for (const [id, after] of anchors) if (after === from) anchors.set(id, to)
    for (const [id, image] of supplied) {
      if (image.afterBlockId === from) supplied.set(id, { ...image, afterBlockId: to })
    }
  }

  for (const edit of edits) {
    if (edit.kind === 'anchor') {
      anchors.set(edit.illustrationId, edit.afterBlockId)
      continue
    }

    if (edit.kind === 'note') {
      authored.set(edit.noteId, edit)
      continue
    }

    if (edit.kind === 'image') {
      supplied.set(edit.imageId, edit)
      continue
    }

    const index = blocks.findIndex((b) => b.id === edit.blockId)
    if (index < 0) continue
    const block = blocks[index]!

    switch (edit.kind) {
      case 'text':
        blocks[index] = { ...block, text: edit.text }
        break

      case 'retype': {
        const { level, ...rest } = block
        blocks[index] = {
          ...rest,
          kind: edit.blockKind,
          // A level only means anything on a heading, and carrying a stale one
          // onto a paragraph would put it in the contents.
          ...(edit.blockKind === 'heading' ? { level: edit.level ?? level ?? 1 } : {})
        }
        break
      }

      case 'drop':
        blocks.splice(index, 1)
        break

      case 'split': {
        const at = Math.max(0, Math.min(block.text.length, edit.at))
        const first = block.text.slice(0, at).trim()
        const second = block.text.slice(at).trim()
        // A split with nothing on one side of it is not a split. Silently
        // keeping the block whole beats leaving an empty paragraph in the book.
        if (first.length === 0 || second.length === 0) break
        blocks.splice(index, 1, {
          ...block,
          id: splitId(block.id, 1),
          text: first,
          // The first half no longer runs on: the second half is what follows
          // it, and it is right here.
          continuesNext: false
        })
        blocks.splice(index + 1, 0, {
          ...block,
          id: splitId(block.id, 2),
          text: second,
          continuesPrevious: false
        })
        // Anything pinned *after* this block belongs after the whole of it,
        // which is now its second half. Without this, splitting a paragraph
        // would quietly unpin every picture that followed it.
        rename(block.id, splitId(block.id, 2))
        break
      }

      case 'merge': {
        const next = blocks[index + 1]
        if (!next) break
        blocks.splice(index, 2, {
          ...block,
          text: `${block.text.trim()} ${next.text.trim()}`.trim(),
          sourcePages: [...new Set([...block.sourcePages, ...next.sourcePages])].sort(
            (a, b) => a - b
          ),
          ...(next.continuesNext === undefined ? {} : { continuesNext: next.continuesNext })
        })
        // The block that was absorbed no longer exists, but "after it" is still
        // a place — it is after the block that absorbed it.
        rename(next.id, block.id)
        break
      }
    }
  }

  // Blocks left empty by a correction are dropped: someone clearing the text of
  // a stray running head means "this is not part of the book", and an empty
  // paragraph still takes a line and an indent on the page.
  blocks = blocks.filter((b) => b.text.trim().length > 0)

  const byId = new Set(blocks.map((b) => b.id))

  // Authored notes join the book's own. A note whose block is gone — dropped,
  // or merged away, or on a page the user later removed — is left out rather
  // than kept as an orphan: unlike a scanned note, nothing was lost by dropping
  // it, because the editor still has what they wrote and can put it back.
  const blockById = new Map(blocks.map((b) => [b.id, b]))
  const footnotes = [...doc.footnotes]
  for (const note of authored.values()) {
    const block = blockById.get(note.blockId)
    if (!block || note.text.trim().length === 0) continue
    footnotes.push({
      id: note.noteId,
      // No printed marker: this note was never on the page. `anchor` is what
      // locates it, and an empty marker is what keeps the regex search off it.
      originalMarker: '',
      text: note.text.trim(),
      pageIndex: block.sourcePages[0] ?? 0,
      orphaned: false,
      anchor: { blockId: note.blockId, at: note.at }
    })
  }
  const suppliedIllustrations = [...supplied.values()]
    .filter((image) => image.afterBlockId === null || byId.has(image.afterBlockId))
    .map((image) => ({
      id: image.imageId,
      // A supplied picture has no source leaf. The field is kept at -1 rather
      // than made nullable so nothing downstream has to special-case it; the
      // `origin` below is what actually says not to trust it.
      pageIndex: -1,
      sourceWidth: image.sourceWidth,
      sourceHeight: image.sourceHeight,
      caption: image.caption?.trim() ? image.caption.trim() : null,
      anchorAfterBlockId: image.afterBlockId,
      origin: 'supplied' as const
    }))

  const illustrations = doc.illustrations.map((illustration) => {
    if (!anchors.has(illustration.id)) return illustration
    const after = anchors.get(illustration.id) ?? null
    // An anchor pointing at a block that is gone is dropped rather than
    // honoured, which returns the picture to the engine's own placement.
    if (after !== null && !byId.has(after)) return illustration
    return { ...illustration, anchorAfterBlockId: after }
  })

  return {
    ...doc,
    blocks,
    footnotes,
    illustrations: [...illustrations, ...suppliedIllustrations],
    // Chapters are derived from the blocks, so retyping a paragraph into a
    // heading has to be able to add one — and dropping a heading has to be able
    // to remove one. Recomputed rather than patched, for the same reason the
    // engine re-runs instead of mutating.
    chapters: chaptersOf(blocks)
  }
}

/** Chapter entries, derived from whatever the blocks now are. */
function chaptersOf(blocks: readonly BookBlock[]): BookDocument['chapters'] {
  return blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.kind === 'heading')
    .map(({ b, i }) => ({
      title: b.text.trim(),
      level: b.level ?? 1,
      blockIndex: i,
      sourcePage: b.sourcePages[0] ?? 0
    }))
}

/**
 * The block an edit is attached to, or null when it is attached to none.
 *
 * Exists so callers do not each grow their own `kind === 'a' || kind === 'b'`
 * disjunction — which is how adding a kind silently breaks a filter somewhere
 * else that was written before it existed.
 */
export function blockOf(edit: BookEdit): string | null {
  if (edit.kind === 'anchor' || edit.kind === 'image') return null
  return edit.blockId
}

/** How many blocks an edit list actually changes, for telling the user. */
export function countEdited(edits: readonly BookEdit[]): number {
  const touched = new Set<string>()
  for (const edit of edits) {
    if (edit.kind === 'anchor') touched.add(edit.illustrationId)
    else if (edit.kind === 'note') touched.add(edit.noteId)
    else if (edit.kind === 'image') touched.add(edit.imageId)
    else touched.add(edit.blockId)
  }
  return touched.size
}

/**
 * Replace any edit that names the same target and does the same job.
 *
 * Typing in a box produces an edit per keystroke; keeping all of them would
 * grow the saved list without bound and make "how many blocks did I change?"
 * meaningless. Splits and merges are *not* collapsed — two splits of one
 * paragraph are two different corrections.
 */
export function withEdit(edits: readonly BookEdit[], edit: BookEdit): BookEdit[] {
  const collapsible =
    edit.kind === 'text' ||
    edit.kind === 'retype' ||
    edit.kind === 'anchor' ||
    edit.kind === 'note' ||
    edit.kind === 'image'
  if (!collapsible) return [...edits, edit]

  const target = targetOf(edit)
  const kept = edits.filter((e) => e.kind !== edit.kind || targetOf(e) !== target)
  return [...kept, edit]
}

/**
 * What an edit is *about* — the thing two edits must share to collapse.
 *
 * A note is keyed by the note, not by the block it hangs off: two annotations
 * on one paragraph are two annotations, and keying them by the block would make
 * writing the second one erase the first.
 */
function targetOf(edit: BookEdit): string {
  if (edit.kind === 'anchor') return edit.illustrationId
  if (edit.kind === 'note') return edit.noteId
  if (edit.kind === 'image') return edit.imageId
  return edit.blockId
}
