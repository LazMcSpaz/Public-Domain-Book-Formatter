/**
 * The checks the readiness command does itself, as pure functions over text:
 * working notes left in the book (C11), italic and bold lost to a sweep (C12),
 * our own markup printed in the PDF (R5), the covers' page counts (R7) and
 * the EPUB's pictures without a description (R11). The command reads the
 * files and hands the text here.
 */

export interface PlacedText {
  /** Where the text is: a section's title, a note's block, a sheet's name. */
  where: string
  text: string
}

export interface NoteHit {
  where: string
  line: number
  word: string
  context: string
}

/**
 * Words that, in brackets, are an instruction to whoever edits next and never
 * a word the book prints: "(delete)", "(check)", "(TK)". Measured on the shelf,
 * the brackets the books do print hold glosses like "(aura)" and "(within)",
 * which a person reads; these fail outright.
 */
export const WORKING_NOTE_WORDS: ReadonlySet<string> = new Set([
  'add',
  'check',
  'cite',
  'citation',
  'cut',
  'del',
  'delete',
  'fix',
  'fixme',
  'here',
  'insert',
  'move',
  'moved',
  'placeholder',
  'query',
  'ref',
  'remove',
  'source',
  'stet',
  'tbd',
  'tk',
  'todo',
  'verify',
  'xxx'
])

const ROMAN = /^(?=[ivxlc]{1,6}$)(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/u

/** A list mark, "(a)" or "(iv)", or the editor's "(sic)": printed on purpose. */
function ordinary(word: string): boolean {
  return word.length === 1 || word === 'sic' || ROMAN.test(word)
}

export interface WorkingNotes {
  /** Working-note words: each one fails the check. */
  notes: NoteHit[]
  /** Every other bracketed word, for a person to read. */
  toRead: NoteHit[]
  /** List marks and "(sic)", not counted. */
  ordinary: number
}

/** C11: every lower-case "(word)" in the texts, as `checking.md`'s grep finds them. */
export function workingNotes(texts: readonly PlacedText[]): WorkingNotes {
  const out: WorkingNotes = { notes: [], toRead: [], ordinary: 0 }
  for (const t of texts) {
    t.text.split(/\r?\n/u).forEach((line, i) => {
      for (const m of line.matchAll(/\(([a-z]+)\)/gu)) {
        const word = m[1]!
        if (ordinary(word)) {
          out.ordinary++
          continue
        }
        const at = m.index ?? 0
        const context = line.slice(Math.max(0, at - 40), at + m[0].length + 40).trim()
        const hit = { where: t.where, line: i + 1, word, context }
        if (WORKING_NOTE_WORDS.has(word)) out.notes.push(hit)
        else out.toRead.push(hit)
      }
    })
  }
  return out
}

/** R5: how many of our own tags (`<i>`, `<b>`, `<sc>`, open or closed) a text prints. */
export function countMarkup(text: string): number {
  return [...text.matchAll(/<\/?(?:i|b|sc)>/gu)].length
}

type Tag = 'i' | 'b' | 'sc'
const TAGS: readonly Tag[] = ['i', 'b', 'sc']
type Tally = Record<Tag, number>

function tally(text: string): Tally {
  const t: Tally = { i: 0, b: 0, sc: 0 }
  for (const tag of TAGS) t[tag] = text.split(`<${tag}>`).length - 1
  return t
}

export interface EmphasisLoss {
  id: string
  tag: Tag
  was: number
  now: number
}

export interface EmphasisSurvival {
  losses: EmphasisLoss[]
  /** Blocks found in both faces and compared. */
  compared: number
  /** First-reading blocks with no corrected block of the same id (merged or removed). */
  uncompared: number
  totals: { pristine: Tally; edited: Tally }
}

interface BodyBlock {
  id: string
  text: string
}

/**
 * C12: per block, the `<i>`, `<b>` and `<sc>` the first reading had against
 * the corrected text. A block that now carries fewer of any is listed; a
 * correction may mean it (a wrong-fount letter set roman), so a person reads
 * the list. Blocks merged into their neighbour have no id to compare under and
 * are counted, not guessed at.
 */
export function emphasisSurvival(body: {
  pristine: readonly BodyBlock[]
  edited: readonly BodyBlock[]
}): EmphasisSurvival {
  const edited = new Map(body.edited.map((b) => [b.id, b.text]))
  const sum = (blocks: readonly BodyBlock[]): Tally => {
    const t: Tally = { i: 0, b: 0, sc: 0 }
    for (const b of blocks) {
      const one = tally(b.text)
      for (const tag of TAGS) t[tag] += one[tag]
    }
    return t
  }
  const losses: EmphasisLoss[] = []
  let compared = 0
  let uncompared = 0
  for (const b of body.pristine) {
    const now = edited.get(b.id)
    if (now === undefined) {
      uncompared++
      continue
    }
    compared++
    const was = tally(b.text)
    const is = tally(now)
    for (const tag of TAGS) {
      if (is[tag] < was[tag]) losses.push({ id: b.id, tag, was: was[tag], now: is[tag] })
    }
  }
  return {
    losses,
    compared,
    uncompared,
    totals: { pristine: sum(body.pristine), edited: sum(body.edited) }
  }
}

export interface CoverCount {
  /** softcover or hardcover */
  cover: string
  /** `pageCount` in its spec, or null when the spec has none. */
  pageCount: number | null
}

/** R7: each cover spec whose `pageCount` is not the interior's page count, with why. */
export function coverCountsDisagree(
  interiorPages: number,
  covers: readonly CoverCount[]
): string[] {
  return covers.flatMap((c) =>
    c.pageCount === null
      ? [`covers/${c.cover}.json gives no pageCount`]
      : c.pageCount !== interiorPages
        ? [`covers/${c.cover}.json says ${c.pageCount} pages; the interior has ${interiorPages}`]
        : []
  )
}

export interface PictureReport {
  pictures: number
  undescribed: { file: string; src: string }[]
}

function attribute(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'iu').exec(tag)
  return m ? (m[2] ?? m[3] ?? '') : null
}

/**
 * R11: every `<img>` in the EPUB's pages, and those with no description: no
 * `alt`, an empty one, or the bare "Figure" a reader who cannot see the
 * picture would otherwise hear.
 */
export function undescribedPictures(
  pages: readonly { name: string; text: string }[]
): PictureReport {
  const out: PictureReport = { pictures: 0, undescribed: [] }
  for (const p of pages) {
    for (const m of p.text.matchAll(/<img\b[^>]*>/giu)) {
      out.pictures++
      const alt = attribute(m[0], 'alt')?.trim() ?? ''
      if (alt === '' || /^figure$/iu.test(alt)) {
        out.undescribed.push({ file: p.name, src: attribute(m[0], 'src') ?? '?' })
      }
    }
  }
  return out
}
