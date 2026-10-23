/**
 * The words a book uses that no dictionary knows, graded by how alone they are.
 *
 * This is the check Amazon runs on a submitted interior and this shelf never
 * did. It was left out on purpose, and the reason was sound as far as it went:
 * these books are made of words no English dictionary carries — Sanskrit,
 * Tibetan, Hebrew, the transliterations of 1888 — so a spell-check reports a
 * thousand false alarms and gets switched off. What it missed is that the
 * false alarms have a shape. A real term is used again: in the same book, in
 * another on the shelf, in Blavatsky's own glossary. A conversion fault is
 * used once, because it is not a word. So the list is not "unknown words" but
 * **unknown words that stand alone**, and graded so a reader can take the
 * likeliest first.
 *
 * Measured on the Hall lectures the day KDP's report arrived: 10,310 distinct
 * words, 718 unknown to a 274,000-word dictionary, **203** of those alone on
 * the shelf — a list read in ten minutes, and it held every word Amazon
 * flagged (`sthough`, `miving`, `Whenthe`, `aleep`) and twenty more it had not
 * (`arithmatic`, `consistant`, `similiar`, `fascimile`, `lanouas`). The 515
 * that were not alone were every Sanskrit term the book shares with the shelf.
 *
 * What the check is not: it never proposes a spelling, and it is not a gate.
 * `brethern` is on the list and is how Hall's typist spelt it seven times; the
 * edition note promises to mend typing slips, and whether that is one is the
 * editor's. A word's grade says how much company it has, not whether it is
 * wrong.
 *
 * Pure: the dictionary and the shelf's word counts come in as arguments, so
 * the same function runs under Node over `books/*` and in a test with ten
 * words. Tokens are runs of letters of four or more; shorter ones and anything
 * with a digit or an apostrophe are left to the damage check.
 */

export interface SpellingSuspect {
  /** The word as it first appears in the book. */
  word: string
  /** How many times the book uses it, in any capitalisation. */
  count: number
  /** How many times the rest of the shelf uses it. */
  shelf: number
  /** Every occurrence began with a capital: likely a name. */
  capitalised: boolean
  /** The first block it appears in. */
  blockId: string
  /** A few words either side of its first use. */
  context: string
}

export interface SpellingReport {
  /** Once in the book, under `shelfFloor` times on the shelf: read these first. */
  alone: SpellingSuspect[]
  /** Unknown to the dictionary but used again, here or elsewhere: usually a term. */
  repeated: SpellingSuspect[]
  /** Distinct words of four or more letters the book uses. */
  vocabulary: number
}

export interface SpellingOptions {
  /** A word used fewer times than this across the rest of the shelf is alone there. */
  shelfFloor?: number
}

const TOKEN = /\p{L}[\p{L}]{3,}/gu

/** The words of a text, tags stripped, as they are written. */
export function spellingTokens(text: string): string[] {
  return text.replace(/<[^>]+>/g, ' ').match(TOKEN) ?? []
}

export function checkSpelling(
  blocks: readonly { id: string; text: string }[],
  dictionary: ReadonlySet<string>,
  shelf: ReadonlyMap<string, number> = new Map(),
  options: SpellingOptions = {}
): SpellingReport {
  const shelfFloor = options.shelfFloor ?? 3
  const seen = new Map<
    string,
    { word: string; count: number; capitalised: boolean; blockId: string; context: string }
  >()
  for (const block of blocks) {
    const plain = block.text.replace(/<[^>]+>/g, ' ')
    for (const m of plain.matchAll(TOKEN)) {
      const word = m[0]
      const key = word.toLowerCase()
      const have = seen.get(key)
      const capital = /^\p{Lu}/u.test(word)
      if (have) {
        have.count++
        have.capitalised = have.capitalised && capital
        continue
      }
      const at = m.index ?? 0
      seen.set(key, {
        word,
        count: 1,
        capitalised: capital,
        blockId: block.id,
        context: plain.slice(Math.max(0, at - 40), at + word.length + 40).replace(/\s+/g, ' ')
      })
    }
  }
  const alone: SpellingSuspect[] = []
  const repeated: SpellingSuspect[] = []
  for (const [key, s] of seen) {
    if (dictionary.has(key)) continue
    const onShelf = shelf.get(key) ?? 0
    const suspect: SpellingSuspect = { ...s, shelf: onShelf }
    if (s.count === 1 && onShelf < shelfFloor) alone.push(suspect)
    else repeated.push(suspect)
  }
  const byWord = (a: SpellingSuspect, b: SpellingSuspect) =>
    a.word.toLowerCase().localeCompare(b.word.toLowerCase())
  alone.sort(byWord)
  repeated.sort(byWord)
  return { alone, repeated, vocabulary: seen.size }
}
