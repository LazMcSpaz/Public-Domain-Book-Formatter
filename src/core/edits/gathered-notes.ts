/**
 * Notes a book gathers at the back of each chapter, set as footnotes.
 *
 * Some books print their notes not at the foot of the page but in a section
 * at the end of each chapter or Part — "FOOTNOTES FOR CHAPTER 1", then
 * "1. …", "2. …" — with superscript marks in the text. A reading transcribes
 * that section as it stands, as numbered paragraphs, and the marks are left
 * claiming nothing: _The Structure of Magic_ Vol. I printed 48 of them over
 * notes set as body text. This turns each section into footnote blocks on
 * the leaves it occupies, which the engine then sets under their marks.
 *
 * - A paragraph opening "N." becomes a footnote marked with N in superscript
 *   digits, the number taken off — also where it sits inside a tag, as
 *   `<b>1.</b> In fact` does. A paragraph without a number continues the
 *   note above, and goes in as a footnote with no marker, which assembly
 *   joins to the one before it. Blocks already set as footnotes are passed
 *   through, so a section half converted can be finished.
 * - The section head goes. A note named in `keep` stays as printed, head and
 *   all: the case of a note the paper prints no mark for, which is the
 *   editor's to place.
 * - Edits on a converted paragraph are carried into its new block and
 *   dropped from the list, because the block id they name is about to mean
 *   something else. A change of tags is folded in; a change of words stays a
 *   correction, re-made as a `note-text` edit, or `corrections.md` would lose
 *   its record when the paragraph became a note. An edit this cannot place
 *   with certainty is an error, never a guess.
 *
 * Then the marks. The claiming walk runs the length of the book, so anything
 * in the text set in the same superscript digits takes the next note of that
 * figure wherever it is — and _The Structure of Magic_ sets its linguistic
 * notation that way (`S¹`, `NP²`, `Noun Phrase¹`). So a superscript straight
 * after one or two capitals or a grammatical category is declared bare
 * first, by its shape; and then each note must be claimed inside its own
 * stretch of body, between the previous notes section and its own. A note
 * claimed earlier was claimed by something that is not its mark, and that
 * occurrence is declared bare too. A note claimed later has no mark in its
 * stretch at all, which is reported and stops the walk: past it every claim
 * is one note out, and whether to add a mark is the editor's.
 *
 * Measured on both volumes before it was written down: Vol. I needed 56
 * notation marks and one repeated mark declared bare, and then all 54 notes
 * sat in their own chapters; Vol. II's 21 needed one mark the editor placed.
 *
 * Pure: no DOM, no I/O.
 */
import { assembleBook, type BookBlock } from '@core/assemble'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe/schema'
import { parseInlineMarkup, withMarkup } from '@core/transcribe/markup'
import { prepareFootnotes } from '@core/layout/footnotes'
import { applyEdits, type BookEdit } from './book-edits'

export interface GatheredNotesOptions {
  /** Notes left as printed, by the leaf their section's head is on and their number. */
  keep?: readonly { headLeaf: number; note: number }[]
  /** What a section's head says. */
  head?: RegExp
}

export interface GatheredNotesResult {
  transcriptions: PageTranscription[]
  edits: BookEdit[]
  /** What was done, a line at a time, for the person running it to read. */
  report: string[]
  /** A note whose stretch of body has no mark for it, when there is one. */
  missingMark: { noteId: string; marker: string; leaf: number } | null
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const superscript = (n: number): string =>
  [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join('')
const squeeze = (t: string): string => t.replace(/\s+/g, ' ').trim()
const plain = (t: string): string => t.replace(/<[^>]+>/g, '')

/** A superscript straight after this is notation: `S¹`, `NP²`, `Noun Phrase¹`. */
const NOTATION_BEFORE = /(?:^|[^\p{L}])(?:\p{Lu}{1,2}|Noun|Phrase|Verb|Adjective|Adverb)$/u

export function gatheredNotesToFootnotes(
  transcriptions: readonly PageTranscription[],
  edits: readonly BookEdit[],
  options: GatheredNotesOptions = {}
): GatheredNotesResult {
  const headPattern = options.head ?? /FOOTNOTES FOR/
  const pages: PageTranscription[] = structuredClone([...transcriptions])
  const report: string[] = []

  const pristine = assembleBook(pages)
  const edited = applyEdits(pristine, edits)
  const editedById = new Map(edited.blocks.map((b) => [b.id, b]))
  const editsByBlock = new Map<string, BookEdit[]>()
  for (const e of edits) {
    if (!('blockId' in e) || typeof e.blockId !== 'string') continue
    const list = editsByBlock.get(e.blockId) ?? []
    list.push(e)
    editsByBlock.set(e.blockId, list)
  }
  /** The assembled blocks a transcription block's text sits in. */
  const hostsOf = (leaf: number, text: string): BookBlock[] =>
    pristine.blocks.filter(
      (b) => b.sourcePages.includes(leaf) && squeeze(b.text).includes(squeeze(text).slice(0, 60))
    )

  const superseded = new Set<BookEdit>()
  const corrections: { printed: string; markup: string }[] = []
  const heads: number[] = []
  const lastNoteLeaf: number[] = []
  let section: { keepNote: number | null } | null = null
  let note: number | null = null

  for (const page of pages) {
    const out: TranscribedBlock[] = []
    for (const block of page.blocks) {
      const text = block.text ?? ''
      if (block.kind === 'heading' && headPattern.test(plain(text))) {
        const kept = options.keep?.find((k) => k.headLeaf === page.pageIndex)
        section = { keepNote: kept ? kept.note : null }
        heads.push(page.pageIndex)
        lastNoteLeaf.push(page.pageIndex)
        note = null
        if (section.keepNote !== null) out.push(block)
        else {
          report.push(`leaf ${page.pageIndex}: head "${plain(text)}" removed`)
          for (const host of hostsOf(page.pageIndex, text)) {
            for (const e of editsByBlock.get(host.id) ?? []) {
              superseded.add(e)
              report.push(`  its ${e.kind} edit on ${host.id} dropped with it`)
            }
          }
        }
        continue
      }
      if (section && block.kind === 'heading') section = null
      if (!section) {
        out.push(block)
        continue
      }
      lastNoteLeaf[lastNoteLeaf.length - 1] = page.pageIndex
      if (block.kind === 'footnote') {
        out.push(block)
        continue
      }
      const numbered = /^(\d+)\.\s+/.exec(text)
      if (numbered) note = Number(numbered[1])
      if (section.keepNote !== null && note === section.keepNote) {
        out.push(block)
        continue
      }

      let markup = withMarkup(text, block.emphasis, block.strong)
      const hosts = hostsOf(page.pageIndex, text)
      const host = hosts.length === 1 ? hosts[0]! : null
      if (!host && hosts.some((h) => editsByBlock.has(h.id))) {
        throw new Error(
          `leaf ${page.pageIndex}: cannot tell which edited block holds "${text.slice(0, 40)}"`
        )
      }
      if (host && editsByBlock.has(host.id)) {
        const now = editedById.get(host.id)!
        if (squeeze(now.text) !== squeeze(host.text)) {
          if (host.sourcePages.length > 1) throw new Error(`${host.id}: words edited across a seam`)
          corrections.push({
            printed: squeeze(text).replace(/^\d+\.\s*/, ''),
            markup: withMarkup(now.text, now.emphasis, now.strong)
          })
          report.push(`leaf ${page.pageIndex}: ${host.id}'s correction kept as a note-text edit`)
        } else if (host.sourcePages.length === 1) {
          markup = withMarkup(now.text, now.emphasis, now.strong)
        } else {
          // Joined across a seam: a change of tags only, so this leaf's share
          // of them is found by word position.
          const all = host.text.split(/\s+/).filter(Boolean)
          const mine = text.split(/\s+/).filter(Boolean)
          let at = -1
          for (let i = 0; i + mine.length <= all.length && at < 0; i++) {
            if (mine.every((w, k) => all[i + k] === w)) at = i
          }
          if (at < 0) throw new Error(`${host.id}: leaf ${page.pageIndex}'s words not found in it`)
          const share = (xs?: readonly number[]) =>
            (xs ?? []).filter((i) => i >= at && i < at + mine.length).map((i) => i - at)
          markup = withMarkup(text, share(now.emphasis), share(now.strong))
        }
        for (const e of editsByBlock.get(host.id)!) superseded.add(e)
        report.push(`leaf ${page.pageIndex}: ${host.id} carried its edits in`)
      }

      // The number may sit inside a tag: taken out, with any pair it empties.
      const m = /^((?:<[^>]+>)*)(\d+)\.\s*/.exec(markup)
      if (m) {
        markup = (m[1]! + markup.slice(m[0].length)).replace(
          /^((?:<[^>]+>)*?)<(\w+)><\/\2>\s*/,
          '$1'
        )
      }
      const parsed = parseInlineMarkup(markup)
      out.push({
        kind: 'footnote',
        text: parsed.text,
        ...(parsed.emphasis.length ? { emphasis: parsed.emphasis } : {}),
        ...(parsed.strong.length ? { strong: parsed.strong } : {}),
        ...(m ? { marker: superscript(Number(m[2])) } : {})
      })
    }
    page.blocks = out
  }

  const result: BookEdit[] = edits.filter((e) => !superseded.has(e))
  {
    const doc = assembleBook(pages)
    for (const fix of corrections) {
      const n = doc.footnotes.find((f) => squeeze(f.text).startsWith(fix.printed.slice(0, 40)))
      if (!n) throw new Error(`no note begins "${fix.printed.slice(0, 40)}"`)
      result.push({
        kind: 'note-text',
        noteId: n.id,
        text: fix.markup.replace(/^((?:<[^>]+>)*)\d+\.\s*/, '$1')
      })
      report.push(`  → note-text on ${n.id}`)
    }
  }

  // Notation, by its shape.
  {
    const doc = applyEdits(assembleBook(pages), result)
    const markers = new Set(doc.footnotes.map((n) => n.originalMarker).filter(Boolean))
    for (const b of doc.blocks) {
      const seen = new Map<string, number>()
      for (const m of b.text.matchAll(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu)) {
        const mark = m[0]
        const nth = (seen.get(mark) ?? 0) + 1
        seen.set(mark, nth)
        if (!markers.has(mark)) continue
        const before = b.text.slice(Math.max(0, m.index! - 12), m.index!)
        if (NOTATION_BEFORE.test(before)) {
          result.push({ kind: 'bare-mark', blockId: b.id, marker: mark, nth, bare: true })
          report.push(`notation: ${b.id} ${mark} #${nth} …${before}${mark}`)
        }
      }
    }
  }

  // Then every note inside its own stretch.
  const stretchOf = (leaf: number): [number, number] => {
    const i = heads.findIndex(
      (h, k) => leaf >= h && (k + 1 === heads.length || leaf < heads[k + 1]!)
    )
    return [i > 0 ? lastNoteLeaf[i - 1]! : -1, heads[i] ?? Infinity]
  }
  let missingMark: GatheredNotesResult['missingMark'] = null
  for (let round = 0; round < 1000 && !missingMark; round++) {
    const doc = applyEdits(assembleBook(pages), result)
    const claims = new Map<string, { block: BookBlock; marker: string; nth: number }>()
    prepareFootnotes(doc.blocks, doc.footnotes, doc.bareMarks ?? []).blocks.forEach((pb, i) => {
      for (const r of pb.references) {
        if (r.printed && r.nth)
          claims.set(r.noteId, { block: doc.blocks[i]!, marker: r.printed, nth: r.nth })
      }
    })
    let declared = false
    for (const n of doc.footnotes) {
      if (!n.originalMarker || n.anchor) continue
      const [after, upTo] = stretchOf(n.pageIndex)
      const c = claims.get(n.id)
      // No mark claims it at all, or only one past its stretch: either way
      // its chapter prints no mark for it — the first when no later chapter
      // has a mark of that figure left to take it.
      if (!c) {
        missingMark = { noteId: n.id, marker: n.originalMarker, leaf: n.pageIndex }
        report.push(
          `${n.id} ${n.originalMarker} (notes on leaf ${n.pageIndex}) is claimed by no mark`
        )
        break
      }
      const leaf = Math.min(...c.block.sourcePages)
      if (leaf <= after) {
        result.push({
          kind: 'bare-mark',
          blockId: c.block.id,
          marker: c.marker,
          nth: c.nth,
          bare: true
        })
        report.push(`bare: ${c.block.id} ${c.marker} #${c.nth}, which took ${n.id}`)
        declared = true
        break
      }
      if (leaf > upTo) {
        missingMark = { noteId: n.id, marker: n.originalMarker, leaf: n.pageIndex }
        report.push(
          `${n.id} ${n.originalMarker} (notes on leaf ${n.pageIndex}) has no mark in its stretch; it was claimed at ${c.block.id}`
        )
        break
      }
    }
    if (!declared) break
  }

  return { transcriptions: pages, edits: result, report, missingMark }
}
