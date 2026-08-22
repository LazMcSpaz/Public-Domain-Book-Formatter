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
}

/** The blocks this reads. Structural only — no platform types, no pixels. */
export interface SynopsisBlock {
  kind: string
  text: string
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

/** A number line rather than a title: "LESSON I", "CHAPTER 4", "PART TWO". */
const NUMBER_LINE = /^\s*(lesson|chapter|part|book|section)\b[\s.]*[0-9ivxlcdm]*\s*\.?\s*$/i

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
 */
export function readSynopsis(blocks: readonly SynopsisBlock[]): SynopsisEntry[] {
  const entries: SynopsisEntry[] = []
  let label = ''
  let title = ''
  let description: string[] = []
  let folio: number | null = null
  let open = false

  const close = (): void => {
    if (!open) return
    const synopsis = description.join(' ').replace(/\s+/g, ' ').trim()
    if (title || label) entries.push({ label, title, synopsis, originalFolio: folio })
    label = ''
    title = ''
    description = []
    folio = null
    open = false
  }

  for (const block of blocks) {
    const text = block.text.trim()
    if (!text) continue

    const asFolio = FOLIO_LINE.exec(text)
    if (asFolio) {
      // The folio ends its entry wherever it appears, whatever the block was
      // called. This is the one unambiguous full stop on the page.
      folio = romanToNumber(asFolio[1]!)
      close()
      continue
    }

    if (block.kind === 'heading') {
      // A heading arriving mid-entry means the previous one never printed a
      // folio. Closing here rather than merging keeps two chapters from being
      // run into one entry with both descriptions stuck together.
      if (description.length > 0) close()
      if (!open && CONTENTS_TITLE.test(text)) continue
      open = true
      if (NUMBER_LINE.test(text) && !label) label = text
      else title = title ? `${title} ${text}` : text
      continue
    }

    // Anything else is description — but only once an entry has been opened.
    // Text before the first heading is the contents' own title or a stray
    // running head, and attaching it to nothing would invent an entry.
    if (open) description.push(text)
  }
  close()
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
  if (entries.length < 2) return false
  const described = entries.filter((e) => e.synopsis.length > 40).length
  if (described < entries.length * 0.6) return false
  const folios = entries.map((e) => e.originalFolio).filter((n): n is number => n !== null)
  if (folios.length < entries.length * 0.6) return false
  return folios.every((n, i) => i === 0 || n > folios[i - 1]!)
}

/**
 * Match a synopsis entry to a chapter heading in the body.
 *
 * Compared on letters and digits only. A contents page and a chapter opening
 * are typeset differently — full capitals against small capitals, a full stop
 * after the number on one and not the other — and none of that is a difference
 * in what the chapter is called.
 */
export function synopsisKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
}
