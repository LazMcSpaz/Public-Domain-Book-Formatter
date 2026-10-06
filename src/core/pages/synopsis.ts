/**
 * The original contents page, kept for its prose and stripped of its numbers.
 *
 * Front matter is replaced rather than transcribed, and the scanned contents is
 * the clearest case: its page numbers describe a pagination this edition does
 * not have, so printing them would send the reader to the wrong page. That rule
 * is right and it threw away more than it needed to.
 *
 * Older books — this one calls it "SYNOPSIS OF THE LESSONS" — set a paragraph
 * under each chapter saying what is in it. That paragraph is *editorial work*,
 * written by whoever made the book, and it is the reason a contents page of
 * this kind is worth reading rather than scanning. Nothing about it is stale.
 * Only the folio beside it was ever the problem.
 *
 * So this reads the entries back out of the transcribed contents leaves, and
 * the regenerated contents can carry each synopsis under its chapter with the
 * page number this edition actually prints. A restoration, not an invention:
 * every word comes off the paper, and where the parse is unsure it says so
 * rather than guessing.
 *
 * Pure.
 */

/** One chapter as the original contents page described it. */
export interface SynopsisEntry {
  /** The number line, where the contents prints one — "LESSON I", "CHAPTER IV". */
  label: string
  /** The chapter's title, as the contents gives it. */
  title: string
  /** The description, joined back together when it ran across a leaf. */
  synopsis: string
  /**
   * The original edition's folio.
   *
   * Kept precisely so it can be *discarded* knowingly. It is never printed —
   * the whole reason the scanned contents was dropped is that this number lies
   * about this edition. It earns its place as evidence: an entry that found one
   * was almost certainly parsed correctly, and a run of them should ascend, so
   * `synopsisLooksSound` can say whether the parse is worth offering at all.
   */
  originalFolio: number | null
  /**
   * The folio was printed in roman numerals: front matter's sequence, which
   * restarts beside the body's arabic one (`PREFACE ........ iv` above
   * chapter one at 1). Present only when true.
   */
  romanFolio?: true
  /**
   * The contents block the entry opened with, `p{leaf}b{block}` — the name a
   * correction to this synopsis is written against. Present only when the
   * blocks handed in carried ids.
   */
  id?: string
  /** The contents leaves the entry was read from, where the blocks said. */
  pages?: number[]
  /**
   * The original edition's page references inside `synopsis`, for an entry
   * that carries them — see {@link ContentsReference}. Present (possibly
   * empty) on exactly the entries of the shape that prints them, and nowhere
   * else, so a contents of the older kind parses to what it always did.
   */
  references?: ContentsReference[]
}

/**
 * A page reference inside a synopsis: `; 52-3.` closing a group of topics.
 *
 * *The Mahatma Letters* (1923) gives its references this way, after every
 * group of topics rather than once per entry, and each one names a page of
 * the 1923 printing. Printed in this edition as they stand they would send the
 * reader to the wrong page, and dropped they would take away the half of the
 * contents that says where things are. So they are kept as structure beside
 * the prose — never as prose — and set at layout to this edition's pages.
 *
 * `start` and `end` bound the digits in the synopsis text, half-open: the
 * `; ` before them and the full stop after them are the prose's own
 * punctuation and stay where they are. `from` and `to` are the original's
 * pages, an abbreviated range already expanded (`489-92` is 489 to 492); a
 * single page has the two equal.
 */
export interface ContentsReference {
  start: number
  end: number
  from: number
  to: number
}

/**
 * Where a synopsis the book carries was read from, and what in it is a page
 * reference — kept beside the synopsis wherever it travels, so a correction
 * can name it and the contents can set its references.
 */
export interface SynopsisSource {
  /** The contents block the entry opened with: what a `synopsis-text` edit names. */
  id: string
  /** The contents leaves it was read from, for asking what one leaf prints. */
  pages: number[]
  /** See {@link SynopsisEntry.references}. Absent on the older shape. */
  references?: ContentsReference[]
}

/** The blocks this reads. Structural only — no platform types, no pixels. */
export interface SynopsisBlock {
  kind: string
  text: string
  /**
   * The block's own id, `p{leaf}b{block}`, so an entry can say which block it
   * opened with. Optional: a caller with nothing to correct need not say.
   */
  id?: string
  /** The leaf the block was read from. */
  page?: number
}

/**
 * The contents page's own title, which is not an entry.
 *
 * Matched rather than assumed-first, because a contents that runs to six leaves
 * repeats nothing at the top of the later ones and the first block of leaf two
 * is the *continuation of a synopsis*, not a title.
 */
const CONTENTS_TITLE = /^\s*(synopsis|contents|table of contents)\b/i

/**
 * The original folio, printed on its own line.
 *
 * Seen as a paragraph on some leaves and a caption on others — the same page
 * furniture read two ways by a model going at speed, which is exactly why this
 * matches on what the line *says* rather than on what it was called.
 */
const FOLIO_LINE = /^\s*page\s+([0-9ivxlc]+)\s*\.?\s*$/i

/**
 * The far commoner form: the folio at the end of the entry's own line, reached
 * by a row of leader dots.
 *
 * `Chapter I. What Is the Human Aura............. 5`
 *
 * A contents that sets `Page 5` on a line by itself is one shape of the thing;
 * this is the other, and the parser knew only the first — so a book set this
 * way came back with every folio null, and `synopsisLooksSound` refused a parse
 * that was in fact perfect. The dots are required, not optional: without them
 * this would strip the `4` off `Chapter IV` and the year off a title ending in
 * one.
 */
const TRAILING_FOLIO = /^(.*?)[.\u2026\s]{4,}\s*([0-9ivxlc]+)\s*$/i

/** A number line rather than a title: "LESSON I", "CHAPTER 4", "PART TWO". */
const NUMBER_LINE = /^\s*(lesson|chapter|part|book|section)\b[\s.]*[0-9ivxlcdm]*\s*\.?\s*$/i

/**
 * The same thing with the word left off: a heading that is a numeral and
 * nothing else.
 *
 * Plenty of books set the number alone — *Uncommon Therapy* opens each chapter
 * with a large `I` beside the title, and prints the word "chapter" nowhere. A
 * heading of one bare numeral is a number line by the only reading available,
 * and refusing it split every such chapter into two: one called "I" with no
 * text under it, and one called "STRATEGIC THERAPY" with no number over it.
 *
 * Safe here in a way it would not be in running text, where `I` is the
 * commonest pronoun in English and `I AM THAT I AM` is a real chapter title:
 * this is asked only of a *heading*, and only of one whose entire content is
 * the numeral. `speakHeadingNumbers` has drawn the line in that same place
 * since it was written, so the two modules now agree rather than differing on
 * what counts as a number.
 */
const BARE_NUMBER_LINE = /^\s*[0-9]+\s*\.?\s*$|^\s*[ivxlcdm]+\s*\.?\s*$/i

/**
 * A number line that names its series: `MANUSCRIPT LECTURE No. 3`, `TALK No. 5`.
 *
 * Hall's lectures were issued as a numbered series and each opens with its
 * number over its title. Read as a complete heading, the number became a
 * chapter of its own, opening recto and carrying no text, which cost every
 * lecture in the collection two leaves. A word or two may stand before the
 * series noun only when `No.` introduces the number: without it they are a
 * title that names a division (`SUMMARY OF PART III`, `PREFACE TO PART II.`),
 * complete in itself. The number is required, unlike in `NUMBER_LINE`:
 * `THE LAST LECTURE` is a title.
 */
const NAMED_NUMBER_LINE =
  /^(?:(?:[a-z]+\s+){1,2}(?:lesson|chapter|part|book|section|lecture|talk|discourse)\s+(?:no\.?\s*|number\s+)|(?:lecture|talk|discourse)\s+(?:(?:no\.?\s*|number\s+))?)(?:[0-9]+|[ivxlcdm]+)\s*\.?$/i

/**
 * Whether a heading is a bare number line — `LESSON III.`, `CHAPTER IV` — as
 * against a title that happens to begin with one of those words.
 *
 * Shared with `deriveChapters`, which needs the same distinction for a
 * different reason: a number line belongs to the heading after it and the two
 * are one chapter opening, while `BOOK TWO — THE ASTRAL WORLD` is complete in
 * itself and stands above what follows. A second copy of this regex in the
 * assembler is exactly the kind of thing that drifts.
 */
export function isNumberLine(text: string): boolean {
  const trimmed = text.trim()
  return (
    NUMBER_LINE.test(trimmed) || BARE_NUMBER_LINE.test(trimmed) || NAMED_NUMBER_LINE.test(trimmed)
  )
}

/**
 * The same thing with the title after it on one line, which is how most
 * contents pages are set: `Chapter III. The Astral Colors`.
 *
 * Split rather than left whole, because `label` exists for exactly this and
 * because the body names its chapters without the number — `deriveChapters`
 * takes the title from the last heading of a run and keeps the number as the
 * identifier. Leaving them joined means `synopsisKey` compares
 * `chapteriiitheastralcolors` against `theastralcolors` and every entry misses.
 */
const NUMBER_THEN_TITLE =
  /^\s*((?:lesson|chapter|part|book|section)\b[\s.]*[0-9ivxlcdm]+\s*\.?)\s+(\S.*)$/i

/**
 * The inline notation a contents block may carry when it comes from a
 * correction or from `drive.mjs body`: `<sc>Letter No.</sc> XX<sc>a</sc>`.
 * Markup, not words — the entry is read through it.
 */
const NOTATION = /<\/?(?:[bi]|sc|em|strong)>/giu

/**
 * A label at the head of a paragraph, ended by an em dash: `Letter No. XXa.—`,
 * and `Letter No. XVI,—` where the compositor set a comma for the point.
 *
 * The other way an analytical contents opens an entry. The heading form puts
 * the number and the title on lines of their own and the description under
 * them; a book of letters has no titles, and sets the number run into the
 * paragraph that describes it. Held to the form the label takes there — a
 * word and a numeral after `No.` — so a description that merely begins with a
 * capital and a dash (`Dr. C.—`) is not taken for the start of an entry, and
 * a contents of the older shape that runs a part's name in after its number
 * (`BOOK II.—PART II. ANTHROPOGENESIS`, *The Secret Doctrine*) reads as it
 * always did. A book that numbers its run-in entries without `No.` is the
 * case to widen this for, with that book's contents beside the change.
 */
const LABEL_DASH =
  /^((?:\p{Lu}\p{L}*\.?\s+)?(?:No|NO|Number|NUMBER)\.?\s*(?:\d+|[IVXLCDM]+)[a-z]?)\s*[.,]?\s*[—–]\s*/u

/**
 * A paragraph opened by a title in capitals and a full stop: `MARS AND
 * MERCURY. Sinnett reopens the controversy—…`. An entry of the run-in kind with
 * a name instead of a number, which is how *The Mahatma Letters* lists the
 * paper in its appendix. Four capitals at least, so `H.P.B. demands` and
 * `I. The` — initials and a numeral — are not titles.
 *
 * Read only in a contents that has already shown the run-in shape with a
 * numbered entry. Elsewhere a paragraph in capitals is the older shape's
 * furniture — `PAGE`, `BIBLIOGRAPHY. . . . 263`, `CHAPTER XII. SOME
 * CONSPICUOUS PATTERNS 3` — and taking it for an entry changed the parse of
 * five books on the shelf that this reader had no business changing.
 */
const CAPS_TITLE = /^(\p{Lu}[\p{Lu}\s’'&,-]*\p{Lu})\.\s+(\S.*)$/u

/**
 * A reference in a synopsis: `; 52-3.` closing a group of topics.
 *
 * The digits must be followed by a full stop, a semicolon or the end — the
 * book closes most groups with a point and a few with `; 328;` — which keeps
 * a number that is part of a phrase (`; 7 objective globes`) out. What it
 * cannot keep out is a count that opens a group, `; 4. Europeans on
 * probation`, which has exactly the shape of a reference; the sequence is
 * what tells them apart (see `readReferences`).
 */
const REFERENCE = /;\s*(\d{1,4})(?:\s*([-–])\s*(\d{1,4}))?(?=\s*(?:[.;]|$))/gu

/**
 * A range as the book abbreviates it, expanded: `52-3` is 52 to 53, `489-92`
 * is 489 to 492, `79-81` is itself. Null for a range that runs backwards once
 * expanded, which is not a range.
 */
function expandRange(fromText: string, toText: string | undefined): [number, number] | null {
  const from = Number(fromText)
  if (toText === undefined) return [from, from]
  const to =
    toText.length < fromText.length
      ? Number(fromText.slice(0, fromText.length - toText.length) + toText)
      : Number(toText)
  return to >= from ? [from, to] : null
}

/**
 * The page references in a run of synopses, in contents order.
 *
 * Each candidate is a `; <page>.` and the run is read as one sequence: a
 * contents lists its letters in the order the book prints them, so the
 * references ascend through the whole run, entry after entry, and the ones
 * that are references are the longest stretch of candidates that never goes
 * backwards. A count shaped like a reference falls out of it: on leaf 30 of
 * *The Mahatma Letters*, `lacking in intuition; 4. Europeans on probation`
 * sits between `328` and `329`, and a page 4 there would be a reference to
 * the first leaf of the book from the middle of letter LVII. Read entry by
 * entry, the same `4` would stand at the head of a letter with nothing before
 * it to contradict it — the reason the sequence is the whole run.
 *
 * Equal neighbours are allowed: two letters printed on one page each say so,
 * and a group can end on the page the next begins on.
 */
export function readReferences(texts: readonly string[]): ContentsReference[][] {
  const candidates: { entry: number; ref: ContentsReference }[] = []
  texts.forEach((text, entry) => {
    for (const m of text.matchAll(REFERENCE)) {
      const range = expandRange(m[1]!, m[3])
      if (!range) continue
      const start = m.index! + m[0].indexOf(m[1]!)
      candidates.push({
        entry,
        ref: { start, end: m.index! + m[0].length, from: range[0], to: range[1] }
      })
    }
  })
  // Longest non-decreasing subsequence by `from`, patience-style. `tails[k]`
  // is the candidate ending the best run of length k+1 found so far; ties go
  // to the later candidate, so equal pages extend a run rather than replace it.
  const tails: number[] = []
  const before: number[] = new Array<number>(candidates.length).fill(-1)
  candidates.forEach((c, i) => {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (candidates[tails[mid]!]!.ref.from <= c.ref.from) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) before[i] = tails[lo - 1]!
    tails[lo] = i
  })
  const kept = new Set<number>()
  for (let i = tails[tails.length - 1] ?? -1; i >= 0; i = before[i]!) kept.add(i)
  const out: ContentsReference[][] = texts.map(() => [])
  candidates.forEach((c, i) => {
    if (kept.has(i)) out[c.entry]!.push(c.ref)
  })
  return out
}

/**
 * Two pieces of an entry joined where a leaf turned in the middle of it.
 *
 * Topics are run together with an em dash and no space, so a leaf that ends
 * on a dash continues the next without one (`conspiracy—` over
 * `correspondence`). A word broken at the foot of the leaf is healed where
 * the second half is lower case (`the per-` over `fect square`), and keeps
 * its hyphen where it is a name (`Pai-` over `Wouen-Yen-Fu`). Anything else
 * is two words.
 */
function joinRunIn(left: string, right: string): string {
  if (left.length === 0) return right
  if (/[—–]$/u.test(left)) return left + right
  if (/\p{L}-$/u.test(left)) {
    return /^\p{Ll}/u.test(right) ? left.slice(0, -1) + right : left + right
  }
  return `${left} ${right}`
}

/**
 * Where an entry of the run-in kind begins, if this paragraph begins one: its
 * label or its title, and the description after it.
 */
function runInEntry(
  text: string,
  shapeShown: boolean
): { label: string; title: string; rest: string } | null {
  const labelled = LABEL_DASH.exec(text)
  if (labelled) {
    return { label: labelled[1]!.trim(), title: '', rest: text.slice(labelled[0].length) }
  }
  if (!shapeShown) return null
  const titled = CAPS_TITLE.exec(text)
  if (titled && titled[1]!.replace(/[^\p{Lu}]/gu, '').length >= 4) {
    return { label: '', title: titled[1]!.trim(), rest: titled[2]! }
  }
  return null
}

function romanToNumber(text: string): number | null {
  const plain = Number(text)
  if (Number.isFinite(plain) && plain > 0) return plain
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }
  const chars = text.toLowerCase().split('')
  if (!chars.every((c) => c in values)) return null
  let total = 0
  for (let i = 0; i < chars.length; i++) {
    const here = values[chars[i]!]!
    const next = i + 1 < chars.length ? values[chars[i + 1]!]! : 0
    total += here < next ? -here : here
  }
  return total > 0 ? total : null
}

/**
 * Read the entries off the transcribed contents leaves.
 *
 * The leaves must arrive in reading order, and every one of them: an entry's
 * description routinely begins on one leaf and finishes on the next, so a
 * parser handed them singly would truncate one description per leaf boundary
 * and never know.
 *
 * ## Two shapes, one reader
 *
 * The older contents puts each entry's number and title on lines of their own
 * \u2014 headings \u2014 with the description under them and a folio to close it. *The
 * Mahatma Letters* sets a letter run into its own paragraph instead: `Letter
 * No. XXa.\u2014From A. O. Hume to K.H. Queries re \u2026; 123. Death by drink\u2014\u2026; 124.`
 * The label ends at the dash, the topics follow joined by dashes, and every
 * group of them closes on the page of the original it is found on. Such a
 * paragraph opens an entry of its own (as does `MARS AND MERCURY. Sinnett
 * reopens\u2026`, the same thing named rather than numbered), closes whatever was
 * open, and is continued by any paragraph that opens nothing \u2014 which is how an
 * entry that ran over a leaf arrives. Headings keep their meaning: `SECTION I`
 * over `THE OCCULT WORLD SERIES` is still an entry, closed by the first letter
 * under it.
 *
 * The references in a run-in entry are kept as structure beside the prose
 * (`references`), read across the whole run at once (see `readReferences`),
 * and the first of them is the entry's `originalFolio`. A contents of the
 * older shape carries no `references` at all, so it reads exactly as it did.
 */
export function readSynopsis(blocks: readonly SynopsisBlock[]): SynopsisEntry[] {
  const entries: SynopsisEntry[] = []
  let label = ''
  let title = ''
  let description: string[] = []
  // Which description lines were topics with a folio of their own. See below.
  let topics: boolean[] = []
  let folio: number | null = null
  let roman = false
  let open = false
  // Whether the open entry was opened by a paragraph (`Letter No. I.\u2014\u2026`)
  // rather than by headings.
  let runIn = false
  // Whether a numbered run-in entry has been read yet: the evidence that this
  // contents is of the run-in shape, which a title in capitals needs.
  let numbered = false
  let id: string | undefined
  let pages: number[] = []
  const folioOf = (text: string): number | null => {
    roman = /[ivxlc]/i.test(text)
    return romanToNumber(text)
  }
  const from = (block: SynopsisBlock): void => {
    if (id === undefined && block.id !== undefined) id = block.id
    if (block.page !== undefined && !pages.includes(block.page)) pages.push(block.page)
  }

  const close = (): void => {
    if (!open) return
    // An analytical contents sets its matter one topic to a line, each with its
    // own folio, where the other kind sets a paragraph. The folios go, for the
    // reason the whole page does, and the topics run in as the old reprints set
    // them: joined by a dash. A line that is only part of a topic (it wrapped,
    // and the folio is on the line after) joins the next with a space.
    const synopsis = runIn
      ? description.reduce(joinRunIn, '').replace(/\s+/g, ' ').trim()
      : description
          .map((line, i) => (i === 0 ? line : `${topics[i - 1] ? ' \u2014 ' : ' '}${line}`))
          .join('')
          .replace(/\s+/g, ' ')
          .trim()
    if (title || label)
      entries.push({
        label,
        title,
        synopsis,
        originalFolio: folio,
        ...(roman && folio !== null ? { romanFolio: true as const } : {}),
        ...(id !== undefined ? { id } : {}),
        ...(pages.length > 0 ? { pages } : {}),
        // Filled in below, once the whole run has been read.
        ...(runIn ? { references: [] } : {})
      })
    label = ''
    title = ''
    description = []
    topics = []
    folio = null
    roman = false
    open = false
    runIn = false
    id = undefined
    pages = []
  }

  for (const block of blocks) {
    // Read through the notation: `<sc>Letter No.</sc> XX<sc>a</sc>` is the
    // label `Letter No. XXa`, and the tags are not words of it.
    const text = block.text.replace(NOTATION, '').trim()
    if (!text) continue

    const asFolio = FOLIO_LINE.exec(text)
    if (asFolio) {
      // The folio ends its entry wherever it appears, whatever the block was
      // called. This is the one unambiguous full stop on the page.
      folio = folioOf(asFolio[1]!)
      close()
      continue
    }

    if (block.kind === 'heading') {
      // A heading arriving mid-entry means the previous one never printed a
      // folio. Closing here rather than merging keeps two chapters from being
      // run into one entry with both descriptions stuck together.
      //
      // So does a known folio: in the leader-dot form the folio is on the
      // entry's own line (`PREFACE ........ i`), so an entry that has one and
      // meets another heading is complete, not the first half of a title.
      //
      // And a run-in entry is complete the moment anything but its own
      // continuation arrives: its label was on its first line.
      if (description.length > 0 || folio !== null || runIn) close()
      if (!open && CONTENTS_TITLE.test(text)) continue
      // A number line under a title that has no number of its own starts a new
      // entry: the title was a part or volume heading standing over the
      // chapters, `THE “INFALLIBILITY” OF RELIGION.` over `CHAPTER I.`, and
      // run on it would be read as the first half of chapter one's name.
      if (open && title && !label && isNumberLine(text)) close()
      open = true
      from(block)

      // Leader dots and a number at the end of the line: the folio belongs to
      // *this* entry, which is the one difference from the `Page 5` form,
      // where it closes the entry above.
      const trailing = TRAILING_FOLIO.exec(text)
      const heading = trailing ? trailing[1]!.trim() : text
      if (trailing) folio = folioOf(trailing[2]!)

      const split = NUMBER_THEN_TITLE.exec(heading)
      if (split && !label) {
        label = split[1]!.trim()
        title = title ? `${title} ${split[2]!.trim()}` : split[2]!.trim()
      } else if (NUMBER_LINE.test(heading) && !label) {
        label = heading
      } else {
        title = title ? `${title} ${heading}` : heading
      }
      continue
    }

    // A paragraph that opens an entry of its own closes whatever was open:
    // the section heading standing over the letters, or the letter before.
    const opening = runInEntry(text, numbered)
    if (opening) {
      close()
      open = true
      runIn = true
      if (opening.label) numbered = true
      from(block)
      label = opening.label
      title = opening.title
      if (opening.rest.trim()) description.push(opening.rest.trim())
      continue
    }

    // Anything else is description — but only once an entry has been opened.
    // Text before the first heading is the contents' own title or a stray
    // running head, and attaching it to nothing would invent an entry.
    //
    // A description line with leader dots and a folio is one topic of an
    // analytical contents. Its folio is stripped here as the heading's is, and
    // the first one found stands for the entry's where the heading printed
    // none, since that is where the chapter's matter begins.
    if (!open) continue
    from(block)
    if (runIn) {
      // The rest of a run-in entry, carried over a leaf.
      description.push(text)
      continue
    }
    const topic = TRAILING_FOLIO.exec(text)
    if (topic) {
      if (folio === null) folio = folioOf(topic[2]!)
      description.push(topic[1]!.trim())
      topics.push(true)
    } else {
      description.push(text)
      topics.push(false)
    }
  }
  close()

  // The references, read across every run-in entry at once, because the
  // sequence they make is what tells a page from a count (`readReferences`).
  const runIns = entries.filter((e) => e.references !== undefined)
  readReferences(runIns.map((e) => e.synopsis)).forEach((refs, i) => {
    const entry = runIns[i]!
    entry.references = refs
    entry.originalFolio = refs[0]?.from ?? null
  })
  return entries
}

/**
 * Whether a parse is worth offering to the user at all.
 *
 * The contents of an old book is regular, so a *correct* parse looks regular
 * too: entries that mostly carry a description, and folios that ascend. A parse
 * that comes back ragged means the page was not laid out the way this reader
 * assumes, and the honest response is to leave the original contents discarded
 * rather than print a mangled one under the author's name.
 *
 * Deliberately a measurement of the parse and not of anybody's confidence in
 * it (SPEC §4): both halves are counted off the entries themselves.
 */
export function synopsisLooksSound(entries: readonly SynopsisEntry[]): boolean {
  // The chapters, which are what the rules below are about. A line that has
  // neither a number nor a description — `PREFACE ........ i`, or a part
  // heading standing over the chapters — is the contents listing something
  // else, and its folio counts in another sequence: the preface's roman `i`
  // is 1, and so is chapter one's page, which is not a folio going backwards.
  const chapters = entries.filter((e) => e.label || e.synopsis)
  if (chapters.length < 2) return false
  const described = chapters.filter((e) => e.synopsis.length > 40).length
  if (described < chapters.length * 0.6) return false
  const found = chapters.filter((e) => e.originalFolio !== null)
  if (found.length < chapters.length * 0.6) return false
  // Roman folios are front matter's own sequence and are left out of the
  // ascending rule when the contents also has arabic ones: a preface at iv
  // above chapter one at 1 is two sequences, not a folio going backwards.
  const arabic = found.filter((e) => !e.romanFolio)
  const sequence = arabic.length > 0 ? arabic : found
  // Two run-in entries may share a page, and say so: their folio is the first
  // reference in each, and *The Mahatma Letters* gives letters XIX and XXa both
  // as `123` because both begin on it. Between entries of the older shape,
  // whose folio is where a chapter opens, the rule stays strict.
  return sequence.every((e, i) => {
    if (i === 0) return true
    const before = sequence[i - 1]!
    const n = e.originalFolio!
    const previous = before.originalFolio!
    return (
      n > previous ||
      (n === previous && e.references !== undefined && before.references !== undefined)
    )
  })
}

/**
 * Match a synopsis entry to a chapter heading in the body.
 *
 * Compared on letters and digits only. A contents page and a chapter opening
 * are typeset differently — full capitals against small capitals, a full stop
 * after the number on one and not the other — and none of that is a difference
 * in what the chapter is called.
 *
 * A reference mark is not part of the name either. A heading that carries a
 * note's mark in superscript — `LETTER No. X¹` — would otherwise key as
 * `letternox1`, the decomposition turning the mark into a digit, and miss the
 * contents' `Letter No. X.` for the sake of a footnote.
 */
export function synopsisKey(text: string): string {
  return text
    .replace(/[¹²³⁰-⁹]+/gu, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * A range of this edition's pages in the form the book prints its own:
 * `52-3`, `178-9`, `489-92`, `79-81`, and a single page where both ends fall
 * on one. The digits the two ends share at the front are written once, as the
 * book writes them; ends of different lengths are written whole.
 */
export function abbreviatedRange(from: string, to: string, separator = '-'): string {
  if (from === to) return from
  if (!/^\d+$/u.test(from) || !/^\d+$/u.test(to) || from.length !== to.length) {
    return `${from}${separator}${to}`
  }
  let shared = 0
  while (shared < from.length - 1 && from[shared] === to[shared]) shared++
  return `${from}${separator}${to.slice(shared)}`
}
