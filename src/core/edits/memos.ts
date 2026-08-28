/**
 * Memos: notes the editor leaves in the document for the assistant.
 *
 * The editorial query (`@core/queries`) carries decisions to the person,
 * because the judgment is theirs. This is the same channel pointed the other
 * way: "this page breaks badly", "check this word against the scan" — work
 * that is mechanical and checkable, anchored where it was noticed, so an
 * editing pass never stalls on something outside the word processor's
 * vocabulary. The editor keeps moving; the assistant sweeps the memos after.
 *
 * A memo never prints — `applyEdits` skips the kind entirely — and its
 * resolution is a ledger rather than a deletion: the assistant writes what
 * was done, and the editor clears the memo once they have seen it. Both
 * halves are the same rule: silence is the failure mode.
 *
 * Pure: array and string work over the edit list and an assembled document.
 */
import { withMarkup } from '@core/transcribe'
import type { BookDocument } from '@core/assemble'
import type { BookEdit } from './book-edits'

export type MemoEdit = BookEdit & { kind: 'memo' }

/** One memo, with enough of its surroundings to be acted on from a sheet. */
export interface MemoContext {
  memoId: string
  blockId: string
  at: number
  text: string
  /** What the assistant did about it, or null while it waits. */
  resolved: string | null
  /**
   * The current text of the block it is anchored in, markup on — the same
   * string `body` hands back and an edit must be written in terms of. Null
   * when the anchor is gone (the block was dropped or merged away), which is
   * reported rather than hidden: the memo still says what it says, and the
   * words are the editor's.
   */
  blockText: string | null
  /** The leaves the block came from; empty for a written block or a lost anchor. */
  sourcePages: number[]
  /** The last few words before the anchor, so a memo reads as a place. */
  where: string
}

/** The memos on an edit list, in the order they were left. */
export function memosOf(edits: readonly BookEdit[]): MemoEdit[] {
  return edits.filter((e): e is MemoEdit => e.kind === 'memo')
}

/** The memos still waiting on the assistant. */
export function openMemos(edits: readonly BookEdit[]): MemoEdit[] {
  return memosOf(edits).filter((m) => !m.resolved)
}

/** The last few words before a point, so a memo can say where it sits. */
function whereabouts(text: string, at: number): string {
  const before = text.slice(0, Math.max(0, Math.min(text.length, at))).trimEnd()
  const words = before.split(/\s+/u).filter(Boolean).slice(-4).join(' ')
  return words.length > 0 ? `…${words}` : 'the start'
}

/**
 * Every memo, in document order, with the text it is anchored in.
 *
 * The document is the one `applyEdits` produced — the book as it stands,
 * sections included, because a memo on a glossary entry is anchored in a
 * section block that exists nowhere else. A memo whose block is gone keeps
 * its place at the end of the sheet with `blockText: null` rather than being
 * dropped: unlike an authored note, its words are a message that has not been
 * delivered yet, and losing it silently is exactly what the channel exists to
 * prevent.
 */
export function memoSheet(doc: BookDocument, edits: readonly BookEdit[]): MemoContext[] {
  const memos = memosOf(edits)
  if (memos.length === 0) return []

  // Reading order: divisions set before the body, the body, divisions after.
  const ordered = [
    ...doc.sections.filter((s) => s.placement === 'front').flatMap((s) => s.blocks),
    ...doc.blocks,
    ...doc.sections.filter((s) => s.placement === 'back').flatMap((s) => s.blocks)
  ]
  const position = new Map(ordered.map((b, i) => [b.id, i]))
  const blockById = new Map(ordered.map((b) => [b.id, b]))

  return memos
    .map((memo) => {
      const block = blockById.get(memo.blockId)
      return {
        memoId: memo.memoId,
        blockId: memo.blockId,
        at: memo.at,
        text: memo.text,
        resolved: memo.resolved ?? null,
        blockText: block ? withMarkup(block.text, block.emphasis, block.strong) : null,
        sourcePages: block ? [...block.sourcePages] : [],
        where: block ? whereabouts(block.text, memo.at) : 'a block that is no longer in the book'
      }
    })
    .sort(
      (a, b) =>
        (position.get(a.blockId) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(b.blockId) ?? Number.MAX_SAFE_INTEGER)
    )
}

/**
 * Record what was done about a memo.
 *
 * The memo stays on the list, outcome attached, until the editor clears it —
 * resolution is the assistant's half of the exchange, and the editor seeing
 * it is the other half. Resolving a memo that does not exist changes nothing,
 * for the same reason `applyEdits` skips an edit whose block is gone: the
 * list outlives any one session.
 */
export function resolveMemo(
  edits: readonly BookEdit[],
  memoId: string,
  outcome: string
): BookEdit[] {
  return edits.map((e) =>
    e.kind === 'memo' && e.memoId === memoId ? { ...e, resolved: outcome } : e
  )
}

/** Remove a memo — the editor has seen the resolution, or withdraws the ask. */
export function clearMemo(edits: readonly BookEdit[], memoId: string): BookEdit[] {
  return edits.filter((e) => e.kind !== 'memo' || e.memoId !== memoId)
}
