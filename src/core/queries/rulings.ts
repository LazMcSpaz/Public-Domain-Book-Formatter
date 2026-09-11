/**
 * The editor's answers to the queries, written down.
 *
 * A query is raised and never taken (`./index.ts`), which is the right rule and
 * was, until now, only half a channel. The question reached a sheet on the
 * shelf; the answer reached a chat session and died with it. Two rulings on
 * this book — keep the British/American spelling mix, fix an obvious
 * compositor's error — existed nowhere a later session could find them, so the
 * second session would raise the same question and the introduction would have
 * to be told from memory what the edition had decided.
 *
 * ## What a ruling is allowed to carry that a query is not
 *
 * A **corrected reading**. That asymmetry is the whole point and not an
 * oversight: `EditorialQuery` has no field for a proposed fix because a
 * suggestion beside a question is an answer in all but name — and a `Ruling`
 * has one because a ruling *is* the answer. Nothing here is written by a
 * reader. `parsePageTranscription` still refuses every field it does not know,
 * so a transcription reply cannot smuggle a ruling in through the back; these
 * live on the run, beside the queries rather than inside them.
 *
 * ## Standing rulings
 *
 * Most editorial decisions are made once and apply everywhere. A book that
 * prints `colour` on one leaf and `color` on the next will do it forty more
 * times, and asking forty times is how a sheet stops being read. So a ruling
 * may name no leaf at all and instead list the words it **covers**, in the
 * editor's own hand: an explicit list, because a policy that guessed which
 * queries it answered would silently settle one it had never been shown.
 *
 * ## What this does not do
 *
 * Apply anything. A `corrected` ruling says what the page should read; making
 * the book read that way is an ordinary `text` edit through the existing
 * machinery, exactly as a hand correction is. Keeping the two apart is what
 * lets `unapplied()` be a real check — a deterministic cross-check between what
 * the editor decided and what the book actually prints, which is worth having
 * precisely because it can come back non-empty.
 *
 * Pure: no DOM, no I/O.
 */
import { bookText, type BookDocument } from '@core/assemble'
import type { EditorialQueryKind } from '@core/transcribe'
import type { RaisedQuery } from './index'

/** What the editor decided to do about it. */
export type RulingDecision =
  /**
   * Keep what the compositor set. The default posture of a reprint, and the
   * one that needs no defence.
   */
  | 'as-printed'
  /** Set it right. `correction` says what it should read. */
  | 'corrected'
  /**
   * Keep it, and tell the reader. For a thing that is neither an error worth
   * fixing nor invisible — the spelling mix, a term the book uses two ways.
   */
  | 'noted'

export const RULING_DECISIONS: readonly RulingDecision[] = ['as-printed', 'corrected', 'noted']

export interface Ruling {
  /**
   * The leaf the query was raised on, or **null for a standing ruling** that
   * answers a class rather than a spot.
   */
  pageIndex: number | null
  /**
   * The words as printed, matching the query's `quote` exactly — or, for a
   * standing ruling, a short name for the class (`British/American spelling`).
   */
  quote: string
  kind: EditorialQueryKind
  decision: RulingDecision
  /**
   * What it should read instead. Only meaningful for `corrected`, and the one
   * field a query is forbidden to have.
   */
  correction?: string
  /** The editor's reasoning, in the editor's own words. */
  because?: string
  /**
   * Words a standing ruling settles, given literally.
   *
   * Matched case-insensitively against a query's quote. Explicit rather than
   * inferred: a policy that worked out for itself which questions it had
   * answered would quietly settle one nobody had read.
   */
  covers?: string[]
  /** ISO date, so a sheet can say when the edition decided this. */
  decidedOn: string
  /**
   * Whether the reader should be told, in the introduction's note on the text.
   *
   * Separate from `decision` because the two are genuinely independent: a
   * correction may be too small to mention and a kept spelling may be the first
   * thing a reader trips over.
   */
  mention?: boolean
}

function sameWords(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * The ruling that settles a query, if one does.
 *
 * A ruling on the spot wins over a standing one, because the editor who wrote
 * it was looking at this leaf.
 */
export function answerFor(query: RaisedQuery, rulings: readonly Ruling[]): Ruling | null {
  const onTheSpot = rulings.find(
    (r) => r.pageIndex === query.pageIndex && sameWords(r.quote, query.quote)
  )
  if (onTheSpot) return onTheSpot

  const needle = query.quote.toLowerCase()
  return (
    rulings.find(
      (r) =>
        r.pageIndex === null &&
        r.kind === query.kind &&
        (r.covers ?? []).some((word) => word.trim() !== '' && needle.includes(word.toLowerCase()))
    ) ?? null
  )
}

/**
 * Where a ruling sits: the leaf and the words, or the class a standing ruling
 * names. Two rulings with the same target are the same decision made twice.
 */
export function rulingTarget(ruling: Ruling): string {
  return `${ruling.pageIndex ?? 'standing'}:${ruling.quote.trim().toLowerCase()}`
}

/** Whether two rulings answer the same question. */
export function sameRuling(a: Ruling, b: Ruling): boolean {
  return a.pageIndex === b.pageIndex && sameWords(a.quote, b.quote)
}

/**
 * The list with this ruling in it, replacing an earlier ruling on the same
 * query **where that one stood**.
 *
 * `withEdit` removes and re-appends, because an edit list is applied in order
 * and the later one has to win. Rulings are not applied in order — nothing
 * reads two rulings on one query — so moving one to the end would only make a
 * diff out of nothing, on a shelf whose whole point is that git keeps every
 * version. Ruling on a query a second time is the editor changing their mind,
 * and the later answer is the one that counts.
 */
export function withRuling(rulings: readonly Ruling[], ruling: Ruling): Ruling[] {
  const at = rulings.findIndex((r) => sameRuling(r, ruling))
  if (at < 0) return [...rulings, ruling]
  const out = [...rulings]
  out[at] = ruling
  return out
}

/** The queries still waiting on a person. */
export function outstanding(
  queries: readonly RaisedQuery[],
  rulings: readonly Ruling[]
): RaisedQuery[] {
  return queries.filter((query) => answerFor(query, rulings) === null)
}

/** Each query with whatever settled it, for a sheet that shows both columns. */
export function settled(
  queries: readonly RaisedQuery[],
  rulings: readonly Ruling[]
): { query: RaisedQuery; ruling: Ruling }[] {
  return queries.flatMap((query) => {
    const ruling = answerFor(query, rulings)
    return ruling ? [{ query, ruling }] : []
  })
}

/**
 * Rulings that say the book should read one way while it reads another.
 *
 * The deterministic cross-check this module is shaped around. A `corrected`
 * ruling is a decision that has not happened until an edit lands, and the gap
 * between deciding and applying is exactly where a book quietly keeps the error
 * its editor is certain was fixed.
 *
 * It takes the **document**, not a string, and asks `bookText` what the book
 * says. That is not fussiness: the caller used to join `doc.blocks` and call it
 * the book, which left out every footnote and stripped the emphasis out of the
 * text, so a correction landing in a note — or one whose wording carried an
 * `<i>` — was reported outstanding forever. A check that cries wolf is what
 * stops anyone reading the check, so the rule for what counts as the book lives
 * in one place and no caller gets to decide it.
 *
 * ## Why the comparison is made twice
 *
 * `bookText` puts the markup back, and the doc comment there says a ruling's
 * correction is quoted from those strings. On this book that turned out not to
 * hold. A ruling is written from the **query sheet**, and a query's quote is
 * written by whoever raised it — a reader working from a render, in plain
 * prose. Leaf 285 of *Isis Unveiled* Vol. I was raised as `extinguished on
 * acount of the desecration` where the book carries `on acount of the
 * <i>desecration.</i>`, so the ruling was applied, the word was mended, and
 * the check went on reporting it outstanding because the tags sat inside the
 * quoted phrase.
 *
 * So each side is asked in both notations, and either answer counts. What that
 * cannot see is a ruling **about** the markup — "set this title in italic" —
 * whose two forms are the same words and differ only in tags: stripped, its
 * correction equals its quote and every such ruling would read as already
 * applied. That case is named rather than lost, and compared with the tags
 * left in.
 */
export function unapplied(rulings: readonly Ruling[], book: BookDocument): Ruling[] {
  const marked = bookText(book).toLowerCase()
  const plain = stripInlineMarkup(marked)
  return rulings.filter((ruling) => {
    if (ruling.decision !== 'corrected') return false
    const wanted = (ruling.correction ?? '').trim().toLowerCase()
    if (wanted === '') return true
    const quote = ruling.quote.trim().toLowerCase()

    // A ruling whose two forms are the same words once the tags come off is a
    // ruling about the emphasis and nothing else. Stripping would make it
    // compare equal to itself, so it is read with the markup left in.
    const aboutMarkupOnly = stripInlineMarkup(wanted) === stripInlineMarkup(quote)
    const has = (needle: string): boolean =>
      aboutMarkupOnly
        ? marked.includes(needle)
        : marked.includes(needle) || plain.includes(stripInlineMarkup(needle))

    if (!has(wanted)) return true

    // The printed form still being in the book usually means the correction
    // half-landed — one occurrence mended and another missed. It means nothing
    // when the correction *contains* the printed form, which is what a
    // correction that only adds something does: closing a quotation turns
    // `he awoke.` into `he awoke.”`, and the first will always be inside the
    // second. Asking then reports every such ruling as unapplied forever.
    if (wanted.includes(quote)) return false
    return has(quote)
  })
}

/**
 * The inline notation removed, leaving the words.
 *
 * Only the tags the book's own notation uses — `parseInlineMarkup` reads `<i>`,
 * `<em>`, `<b>` and `<strong>` and nothing else, so nothing else is taken out.
 * A stray `<` in the text stays where it is rather than eating the rest of the
 * line, which a general tag-stripper would do to a note quoting an inequality.
 */
function stripInlineMarkup(text: string): string {
  return text.replace(/<\/?(?:i|em|b|strong)>/gi, '')
}

const HEADING: Record<RulingDecision, string> = {
  corrected: 'Set right',
  'as-printed': 'Kept as printed',
  noted: 'Kept, and told to the reader'
}

/**
 * The record, for the shelf.
 *
 * Beside `queries.md` rather than inside it, because the two are read on
 * different occasions: the queries file is a thing to work through and empties
 * as it is answered, while this one only ever grows and is what a session six
 * months from now reads to find out what this edition already decided.
 */
export function rulingsMarkdown(
  book: { title: string; fileName: string },
  rulings: readonly Ruling[]
): string {
  const lines: string[] = [
    `# Editorial rulings — ${book.title}`,
    '',
    'What this edition decided, and when. Written by the editor; nothing here',
    'was proposed by a reader.',
    ''
  ]

  if (rulings.length === 0) {
    lines.push('Nothing has been ruled on yet.', '')
    return lines.join('\n')
  }

  lines.push(
    `${rulings.length} ruling${rulings.length === 1 ? '' : 's'}, from \`${book.fileName}\`.`,
    ''
  )

  for (const decision of RULING_DECISIONS) {
    const group = rulings.filter((r) => r.decision === decision)
    if (group.length === 0) continue
    lines.push(`## ${HEADING[decision]}`, '')
    lines.push('| Leaf | As printed | Reads | Why | Decided |', '| --- | --- | --- | --- | --- |')
    for (const ruling of group) {
      const where = ruling.pageIndex === null ? '*standing*' : String(ruling.pageIndex)
      const reads = ruling.correction ? `\`${cell(ruling.correction)}\`` : '—'
      lines.push(
        `| ${where} | \`${cell(ruling.quote)}\` | ${reads} | ${cell(ruling.because ?? '')} | ${ruling.decidedOn} |`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

function cell(text: string): string {
  return text.replace(/\|/gu, '\\|').replace(/\n+/gu, ' ')
}

/**
 * The sentences the introduction owes the reader.
 *
 * A reprint that silently mends its original is not being faithful and is not
 * being honest, and one that silently keeps an obvious error looks careless.
 * Either way the fix is the same: say what was done, once, in the note on the
 * text. So the rulings the editor marked `mention` come back here as material
 * to write from — never as finished prose, because the introduction is written
 * in the editor's voice and this module has none.
 *
 * Ordered kept-things first, then corrections, which is the order a note on the
 * text reads best in: what the reader will see, then what they will not.
 */
export function toMention(rulings: readonly Ruling[]): {
  kept: Ruling[]
  corrected: Ruling[]
} {
  const wanted = rulings.filter((r) => r.mention)
  return {
    kept: wanted.filter((r) => r.decision !== 'corrected'),
    corrected: wanted.filter((r) => r.decision === 'corrected')
  }
}

/**
 * Every query in one place with what became of it — the sheet an independent
 * reader is handed.
 *
 * `queries.md` empties as it is answered and `rulings.md` only ever grows, and
 * between them a question that was settled is on one sheet while the question
 * it answered is off the other. That is right for working through them and
 * wrong for checking the work: somebody auditing an edition wants **every**
 * query the reading raised, in book order, with what the page says, what was
 * decided, what it now reads, and the reasoning — without holding two files
 * open and matching them up by hand.
 *
 * Derived from the run, so it cannot drift from the book the way a written
 * summary would. What it deliberately does *not* do is judge: it puts the
 * decision beside the words it was made about and leaves the reading to a
 * person.
 */
export function reviewMarkdown(
  book: { title: string; fileName: string },
  raised: readonly RaisedQuery[],
  rulings: readonly Ruling[]
): string {
  const byLeaf = [...raised].sort((a, b) => a.pageIndex - b.pageIndex)
  const settledCount = byLeaf.filter((q) => answerFor(q, rulings) !== null).length

  const lines: string[] = [
    `# Every editorial query, and what became of it — ${book.title}`,
    '',
    'For review. Each query is a place the reading found where being faithful to',
    'the 1877 setting and being correct pull apart. **The reading never decided',
    'one of these**; it transcribed the page as printed and raised the question.',
    'What is decided here was decided by the editor, or by a ruling the editor',
    'made on a case like it — and where that is so, the reasoning says which.',
    '',
    `${byLeaf.length} raised, ${settledCount} settled, ${byLeaf.length - settledCount} still waiting.`,
    ''
  ]

  if (byLeaf.length === 0) {
    lines.push('Nothing was raised.', '')
    return lines.join('\n')
  }

  lines.push(
    '| Leaf | As printed | Decided | Now reads | Why it was raised | Why it was decided that way |',
    '| ---: | --- | --- | --- | --- | --- |'
  )
  for (const query of byLeaf) {
    const ruling = answerFor(query, rulings)
    const decision = ruling === null ? '**waiting**' : HEADING[ruling.decision]
    const reads =
      ruling?.decision === 'corrected' && ruling.correction ? `\`${cell(ruling.correction)}\`` : '—'
    const standing = ruling !== null && ruling.pageIndex === null ? ' *(standing ruling)*' : ''
    lines.push(
      `| ${query.pageIndex} | \`${cell(query.quote)}\` | ${decision}${standing} | ${reads} | ` +
        `${cell(query.why)} | ${cell(ruling?.because ?? '')} |`
    )
  }
  lines.push('')

  const standing = rulings.filter((r) => r.pageIndex === null)
  if (standing.length > 0) {
    lines.push(
      '## Standing rulings',
      '',
      'Decisions that answer a class rather than a spot, listed because they',
      'settle queries above without appearing against any one leaf.',
      '',
      '| Covers | Decided | Why |',
      '| --- | --- | --- |'
    )
    for (const ruling of standing) {
      lines.push(
        `| \`${cell((ruling.covers ?? [ruling.quote]).join('`, `'))}\` | ` +
          `${HEADING[ruling.decision]} | ${cell(ruling.because ?? '')} |`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}
