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
import { standingFor, type HeldQuery } from './standing'
import { bookText, type BookDocument } from '@core/assemble'
import { withMarkup, type EditorialQueryKind } from '@core/transcribe'
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
 * Only a ruling made **on the spot** settles. A standing ruling whose covers
 * reach the query used to settle it here as well, silently, so the query
 * never reached the gate; the editor ruled that such a query is *held* —
 * pre-filled with the standing ruling's decision and filed only when a
 * person approves it. `standingFor` (`./standing.ts`) says which ruling
 * holds it, and `held` lists them.
 */
export function answerFor(query: RaisedQuery, rulings: readonly Ruling[]): Ruling | null {
  return (
    rulings.find((r) => r.pageIndex === query.pageIndex && sameWords(r.quote, query.quote)) ?? null
  )
}

/**
 * The queries still waiting that a standing ruling holds an answer for.
 *
 * A subset of `outstanding`: every one of these is unsettled, and every one
 * arrives at the gate pre-filled. Listed apart because they are a different
 * amount of work — a look and a nod each, rather than a decision.
 */
export function held(queries: readonly RaisedQuery[], rulings: readonly Ruling[]): HeldQuery[] {
  return outstanding(queries, rulings).flatMap((query) => {
    const ruling = standingFor(query, rulings)
    return ruling ? [{ query, ruling }] : []
  })
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
  const views = NOTATIONS.map((fold) => fold(marked))
  const leaves = new Map<number, string[]>()
  const onLeaf = (page: number): string[] => {
    let found = leaves.get(page)
    if (!found) {
      const text = leafText(book, page).toLowerCase()
      found = text === '' ? views : NOTATIONS.map((fold) => fold(text))
      leaves.set(page, found)
    }
    return found
  }
  return rulings.filter((ruling) => {
    if (ruling.decision !== 'corrected') return false
    const written = (ruling.correction ?? '').trim().toLowerCase()
    if (written === '') return true
    const quote = ruling.quote.trim().toLowerCase()
    const placed = inPlace(written, quote)

    // A word written as it should read, which the query already quotes that
    // way: a broken sort transcribed whole. There is nothing to apply, and the
    // question left is only whether the book still has the word.
    if (placed === 'confirms') return !has(views, NOTATIONS.length - 1, written)
    const printed = ruling.pageIndex === null ? views : onLeaf(ruling.pageIndex)
    return !placed.some((wanted) => landed(wanted, quote, views, printed))
  })
}

/**
 * Does the book read `wanted` rather than `quote`?
 *
 * `printed` is where the printed form is looked for: the ruling's own leaf,
 * where it has one. A ruling is about a place, and a short quote is ordinary
 * prose somewhere else: `teacher or guru,` ends an entry wrongly on leaf 133
 * of the Glossary and is right in the middle of a sentence on leaf 368, and
 * asked of the whole book the mended ruling read as half-landed for ever. A
 * standing ruling, which names no leaf, is still asked of the whole book.
 */
function landed(
  wanted: string,
  quote: string,
  views: readonly string[],
  printed: readonly string[]
): boolean {
  // The loosest notation in which the two forms still differ. A ruling whose
  // two forms are the same words once the tags come off is a ruling about the
  // emphasis, and is read with the markup left in; one that differs only in
  // an accent is read with the accents in; and so on down the ladder.
  let level = NOTATIONS.length - 1
  while (level > 0 && NOTATIONS[level](wanted) === NOTATIONS[level](quote)) level--

  if (!has(views, level, wanted)) return false

  // The printed form still being in the book usually means the correction
  // half-landed — one occurrence mended and another missed. It means nothing
  // when the correction *contains* the printed form, which is what a
  // correction that only adds something does: closing a quotation turns
  // `he awoke.` into `he awoke.”`, and the first will always be inside the
  // second. Asking then reports every such ruling as unapplied forever.
  if (NOTATIONS[level](wanted).includes(NOTATIONS[level](quote))) return true
  return !has(printed, level, quote)
}

/**
 * What one leaf prints: the body and set-apart blocks drawn from it — a block
 * joined across a seam belongs to both of its leaves — and the notes printed
 * at its foot. Empty for a leaf nothing in the book came from, and the caller
 * then asks the whole book, since an answer about nothing is no answer.
 */
function leafText(doc: BookDocument, page: number): string {
  const marked = (b: { text: string; emphasis?: number[]; strong?: number[] }): string =>
    withMarkup(b.text, b.emphasis, b.strong)
  return [
    ...[...doc.blocks, ...doc.asides].filter((b) => b.sourcePages.includes(page)).map(marked),
    ...doc.footnotes.filter((n) => n.pageIndex === page).map(marked)
  ].join('\n')
}

/**
 * Is this passage in the book, in any notation up to `level`?
 *
 * Either answer counts, for the reason the doc comment above gives: a quote is
 * written by a person from a sheet, and the book carries tags, spacing and
 * accents the person did not type.
 */
function has(views: readonly string[], level: number, needle: string): boolean {
  for (let i = 0; i <= level; i++) if (views[i].includes(NOTATIONS[i](needle))) return true
  return false
}

/**
 * The ways a quote and the book can differ without differing in what they say,
 * strictest first. Each includes the one before it.
 *
 * - **As written**, tags and all.
 * - **Tags off** (`stripInlineMarkup`).
 * - **Spacing folded.** A book that sets a thin space inside its quotation
 *   marks and before `;` — the Glossary does, by ruling, `“ God ”` — reads to
 *   a person as `“God”`, which is how a ruling gets written. Every space
 *   beside a quotation mark and before closing pointing goes.
 * - **Accents folded.** A later ruling on a name's accent (`Pandavas` to
 *   `Pândavas`) must not make an earlier ruling on the same sentence read as
 *   undone.
 */
const NOTATIONS: readonly ((text: string) => string)[] = [
  (text) => text,
  (text) => stripInlineMarkup(text),
  (text) => foldSpacing(stripInlineMarkup(text)),
  (text) => foldAccents(foldSpacing(stripInlineMarkup(text)))
]

function foldSpacing(text: string): string {
  return text
    .replace(/\s*([\u201c\u201d\u2018\u2019"])\s*/gu, '$1')
    .replace(/\s+([,;:.!?)\]])/gu, '$1')
    .replace(/([([])\s+/gu, '$1')
}

function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '')
}

/**
 * A correction written as the part of the quote that changes, put back into
 * the quote — every way it can be, see below — or `'confirms'` where the part
 * it names is already there.
 *
 * Standing ruling 1 has the reader raise a broken sort "carrying the word as
 * it should read", so a ruling is as often `guru.` against the quote `teacher
 * or guru,` as it is the whole passage mended. Checked as written, such a
 * correction is either missing from the book (`guru.` beside the leaf-368
 * `guru, having`) or present while the quote is too, and on the Glossary
 * fifteen of twenty-six rulings reported outstanding were one or the other,
 * every one already read by the book.
 *
 * So the correction's words are found in the quote — once, at word boundaries
 * — and the pointing either side of them is taken from the correction where it
 * gives any and from the quote where it does not: `God”` in `translated
 * “God’,` reads `translated “God”,`, and `Moon` in `the Moon, called` keeps
 * its comma. A correction that is the whole quote, or not found in it once, is
 * returned as written.
 *
 * What this cannot see, and says so: a ruling whose entire fix is deleting the
 * pointing beside a word, written as the bare word (`et` for `et. seq.`), reads
 * as the word confirmed. Write such a ruling as the passage (`et seq.`).
 */
function inPlace(correction: string, quote: string): string[] | 'confirms' {
  if (correction.includes(quote)) return [correction]
  const parts = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(correction)
  if (!parts) return [correction]
  const [, lead, core, trail] = parts
  if (core === '' || core.length >= quote.length) return [correction]
  // Pointing the correction sets apart with a space is not pointing on the
  // word: `(See “ Suryavansa ”.)` is a whole passage retyped, not a fragment.
  if (/\s/u.test(lead) || /\s/u.test(trail)) return [correction]
  const word = /[\p{L}\p{N}]/u
  // Found through the accents, because the commonest fragment is the accent
  // itself put right — `They` for the quote's `Thèy` — and the place in the
  // quote is the same place either way. Folded a character at a time so the
  // offsets still count in the quote's own characters.
  const bare = [...quote].map((c) => foldAccents(c)).join('')
  const needle = foldAccents(core)
  if (bare.length !== quote.length || needle.length !== core.length) return [correction]
  const at: number[] = []
  for (let i = bare.indexOf(needle); i !== -1; i = bare.indexOf(needle, i + 1)) {
    const before = quote[i - 1] ?? ' '
    const after = quote[i + core.length] ?? ' '
    if (!word.test(before) && !word.test(after)) at.push(i)
  }
  if (at.length !== 1) return [correction]
  const from = at[0]
  const to = from + core.length
  const edge = (c: string | undefined): boolean =>
    c !== undefined && !/\s/u.test(c) && !word.test(c)
  let first = from
  while (edge(quote[first - 1])) first--
  let last = to
  while (edge(quote[last])) last++

  // How much of the quote's own pointing the correction's replaces is not
  // written down: `(Sk.)` against `(Sk). Lit.` replaces the `)` and keeps the
  // stop after it, `India—` against `India--“ they` replaces the two hyphens
  // and keeps the quotation mark. So every reach is tried, and the ruling has
  // landed if the book reads any of them. Where the correction gives no
  // pointing on a side, the quote's stays.
  const starts = lead ? range(first, from) : [from]
  const ends = trail ? range(to, last) : [to]
  const puts = new Set<string>()
  for (const s of starts)
    for (const e of ends)
      puts.add(
        quote.slice(0, s) +
          (lead || quote.slice(s, from)) +
          core +
          (trail || quote.slice(to, e)) +
          quote.slice(e)
      )
  if (!puts.has(quote)) return [...puts]
  // A single word the quote already has is a confirmation. Several words that
  // come out unchanged are not: `the cat` against `the the cat` is a doubled
  // word being taken out, and must be checked as written.
  return /\s/u.test(core) ? [correction] : 'confirms'
}

function range(from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i <= to; i++) out.push(i)
  return out
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
    'What this edition decided, and when. Every one of these was settled by the',
    'editor. Where the decision was taken from a reading proposal rather than',
    'written from scratch, the reason says so — see `proposals.md`.',
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
  const heldCount = held(byLeaf, rulings).length

  const lines: string[] = [
    `# Every editorial query, and what became of it — ${book.title}`,
    '',
    'For review. Each query is a place the reading found where being faithful to',
    'the original setting and being correct pull apart. **The reading never decided',
    'one of these**; it transcribed the page as printed and raised the question.',
    'What is decided here was decided by the editor, or by a ruling the editor',
    'made on a case like it — and where that is so, the reasoning says which.',
    '',
    `${byLeaf.length} raised, ${settledCount} settled, ` +
      (heldCount > 0 ? `${heldCount} held under a standing ruling for approval, ` : '') +
      `${byLeaf.length - settledCount - heldCount} still waiting.`,
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
    const holding = ruling === null ? standingFor(query, rulings) : null
    // A held query is not decided: the standing ruling's answer is shown as
    // what it *would* be, marked so, and the row stays a waiting one.
    const decision =
      ruling !== null
        ? HEADING[ruling.decision]
        : holding !== null
          ? `**held** — ${HEADING[holding.decision]} under the standing ruling “${cell(holding.quote)}”, awaiting approval`
          : '**waiting**'
    const reads =
      ruling?.decision === 'corrected' && ruling.correction ? `\`${cell(ruling.correction)}\`` : '—'
    lines.push(
      `| ${query.pageIndex} | \`${cell(query.quote)}\` | ${decision} | ${reads} | ` +
        `${cell(query.why)} | ${cell(ruling?.because ?? '')} |`
    )
  }
  lines.push('')

  const standing = rulings.filter((r) => r.pageIndex === null)
  if (standing.length > 0) {
    lines.push(
      '## Standing rulings',
      '',
      'Decisions that answer a class rather than a spot. A query one of these',
      'reaches is **held**, not settled: it arrives at the gate with this',
      'decision pre-filled and is filed when the editor approves it.',
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
