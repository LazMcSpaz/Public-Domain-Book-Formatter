/**
 * Greek that the conversion read as Latin letters, and came out word-shaped.
 *
 * TUP's ClearScan layer turned the Greek in *The Secret Doctrine* into Latin
 * junk, and most of it is junk any shape check sees: `1rpwr6”yoPoP`,
 * `<Fro*x<Za`, `Av8pw11`. Those `garbled` already catches. What it cannot
 * catch is the remainder that came out made of letters alone — `Moipa` for
 * `Μοῖρα`, `Xpbvos` for `Χρόνος`, `TOU Oavrirov` for `τοῦ θανάτου`. Every
 * character is an ordinary letter and the token is a plausible-looking word,
 * so the only thing wrong with it is what language it is in.
 *
 * Two questions are asked of a word the book uses once or twice, and both are
 * measured rather than listed:
 *
 * - **Does it look more like garbled Greek than like this book's English?**
 *   Two letter-trigram models, one trained on Greek words passed through the
 *   OCR's own confusions (`π` read as `n` or `r`, `ρ` as `p`, `ν` as `v`,
 *   `ω` as `w`), the other on every word this book sets, with the word being
 *   scored taken back out of it. The score is the difference in average
 *   log-probability per trigram. A transliterated Sanskrit name scores low on
 *   both, which is why a ratio and not either model alone.
 *
 *   Leaving the word out is what made the English side work. Trained only on
 *   words the book sets often, it called most English words set once Greek,
 *   and *Uncommon Therapy* reported `odor` and `data`; a word set once shares
 *   its trigrams with the rest of the book's English, and garbled Greek does
 *   not, because nothing else in the book is spelt `rwv`. What it cannot
 *   clear is English made of Greek, `pneumonia` and `zero`, whose trigrams
 *   really are Greek ones.
 * - **Could it be a known Greek word, garbled?** Matched letter by letter
 *   through the same confusions against the seed and the book's own Greek, so
 *   `Moipa` finds `Μοῖρα` where the trigrams are unsure — but only through at
 *   least one reading a transliterator would never write, or `daimonion`
 *   would be reported for being `δαιμόνιον` spelt on purpose.
 *
 * Measured before it was written down, on the 122 passages of the two TUP
 * volumes a reader had restored from the paper, with a seed that held none of
 * their Greek: the shape checks in `damage.ts` name 105, this names 6 more,
 * and of the 11 neither names most are words of four letters or fewer. Over
 * the corrected text of the whole shelf it lists 0 to 12 words in a book with
 * no Greek in it (rare names, `Fylfot`, `pneumonia`) and 10 and 20 in the two
 * volumes, where it found passages the reading had missed. That is a list to
 * read, never a gate: `shape`, and not counted by `damage --check`.
 *
 * Pure: no DOM, no I/O.
 */
import { GREEK_SEED } from './greek-seed'

/**
 * What OCR makes of each Greek letter, accents stripped. Read off the
 * restorations on the shelf: every option here occurs in at least one of
 * them. Lower case only, since both sides are compared lower-cased, so a
 * capital's own reading rides on its small letter: `Μ` read as `M` is why `μ`
 * may become `m`.
 */
const CONFUSIONS: Readonly<Record<string, readonly string[]>> = {
  α: ['a'],
  β: ['b', 'f'],
  γ: ['y', 'r'],
  δ: ['o', 'd'],
  ε: ['e'],
  ζ: ['t', 'z'],
  η: ['n', 'r', 'h'],
  θ: ['o', 'e'],
  ι: ['i', 't', 'l'],
  κ: ['k'],
  λ: ['a', 'x'],
  μ: ['p', 'u', 'jj', 'j', 'm'],
  ν: ['v', 'n'],
  ξ: ['e', 't'],
  ο: ['o'],
  π: ['n', 'r', 'ir', 'rr', 'ii'],
  ρ: ['p'],
  σ: ['u', 'a', 'o'],
  ς: ['s', 'r'],
  τ: ['r', 't'],
  υ: ['u', 'v', 'y'],
  φ: ['q', 'c', 'f'],
  χ: ['x'],
  ψ: ['y', 'l'],
  ω: ['w', 'o', 'n', 'fl']
}

/** Accents, breathings and the iota subscript off; final sigma kept. */
export function bareGreek(word: string): string {
  return word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('el')
    .replace(/σ(?!\p{L})/gu, 'ς')
}

const GREEK = /[Ͱ-Ͽἀ-῿]/u

/** Greek-script words of three letters or more in a text. */
export function greekWordsIn(text: string): string[] {
  return [...text.matchAll(/[Ͱ-Ͽἀ-῿]{3,}/gu)].map((m) => m[0])
}

export function hasGreek(text: string): boolean {
  return GREEK.test(text)
}

/** A letter-trigram model: counts of each trigram and of its two-letter context. */
interface Trigrams {
  grams: Map<string, number>
  contexts: Map<string, number>
}

function gramsOf(word: string): string[] {
  const w = `^${word}$`
  const out: string[] = []
  for (let i = 1; i < w.length; i++) out.push(w.slice(Math.max(0, i - 2), i + 1))
  return out
}

function train(words: Iterable<[string, number]>): Trigrams {
  const grams = new Map<string, number>()
  const contexts = new Map<string, number>()
  for (const [word, weight] of words) {
    for (const g of gramsOf(word)) {
      grams.set(g, (grams.get(g) ?? 0) + weight)
      const c = g.slice(0, -1)
      contexts.set(c, (contexts.get(c) ?? 0) + weight)
    }
  }
  return { grams, contexts }
}

/**
 * Average log-probability per trigram, add-½ smoothed over a 30-letter
 * alphabet, with `without` taken back off every count first: the weight the
 * word itself put into the model, so a word is never its own evidence.
 */
function logProb(model: Trigrams, word: string, without = 0): number {
  const gs = gramsOf(word)
  let sum = 0
  for (const g of gs) {
    const seen = Math.max(0, (model.grams.get(g) ?? 0) - without)
    const context = Math.max(0, (model.contexts.get(g.slice(0, -1)) ?? 0) - without)
    sum += Math.log((seen + 0.5) / (context + 15))
  }
  return sum / gs.length
}

/**
 * The ways a Greek word comes out in Latin letters. Deterministic: variant
 * `v` takes option `(v + i) mod n` at letter `i`, so four variants cover every
 * option of every letter without enumerating the product.
 */
function garblings(word: string): string[] {
  const letters = [...bareGreek(word)]
  if (!letters.every((ch) => CONFUSIONS[ch] !== undefined)) return []
  const out = new Set<string>()
  for (let v = 0; v < 4; v++) {
    out.add(
      letters
        .map((ch, i) => {
          const options = CONFUSIONS[ch]!
          return options[(v + i) % options.length]
        })
        .join('')
    )
  }
  return [...out]
}

/**
 * The readings a transliterator would also write: `δ` as `d`, `μ` as `m`.
 * A match made of these alone is `daimonion` for `δαιμόνιον`, which is the
 * book romanising a word on purpose and not the conversion failing.
 */
const TRANSLITERATED: Readonly<Record<string, readonly string[]>> = {
  α: ['a'],
  β: ['b'],
  δ: ['d'],
  ε: ['e'],
  ζ: ['z'],
  ι: ['i'],
  κ: ['k'],
  μ: ['m'],
  ν: ['n'],
  ο: ['o'],
  ς: ['s'],
  τ: ['t'],
  υ: ['u', 'y'],
  χ: ['x'],
  ω: ['o']
}

/**
 * How Greek word `greek` (bare) can come out as Latin `latin` (lower case,
 * letters only), counted in *tells*: readings no transliterator writes, `ρ`
 * as `p` or `θ` as `o`. The fewest a match needs, or `undefined` if none
 * exists.
 */
function fewestTells(latin: string, greek: string): number | undefined {
  const g = [...greek]
  const memo = new Map<string, number | undefined>()
  const walk = (i: number, j: number): number | undefined => {
    if (j === g.length) return i === latin.length ? 0 : undefined
    const key = `${i},${j}`
    if (memo.has(key)) return memo.get(key)
    let best: number | undefined
    for (const option of CONFUSIONS[g[j]!] ?? []) {
      if (!latin.startsWith(option, i)) continue
      const rest = walk(i + option.length, j + 1)
      if (rest === undefined) continue
      const tell = (TRANSLITERATED[g[j]!] ?? []).includes(option) ? 0 : 1
      if (best === undefined || rest + tell < best) best = rest + tell
    }
    memo.set(key, best)
    return best
  }
  return walk(0, 0)
}

/**
 * A garbling has at least one tell and is mostly letters OCR got looking
 * right: `Moipa` is `Μοῖρα` with one (`ρ` as `p`). Past two in five the match
 * is the confusions being loose enough to reach anything — `orator` comes
 * out of `Δήλιος` with five.
 */
const MOST_TELLS = 0.4

export interface GreekModel {
  /** Score a Latin word: above zero looks more like garbled Greek than like this book. */
  score(letters: string): number
  /** The known Greek word this could be a garbling of, if any. */
  couldBe(letters: string): string | undefined
}

/**
 * Build the two models for one book.
 *
 * @param vocabulary every alphabetic word the book sets, lower-cased, with its count
 * @param ownGreek   the Greek words the book itself prints, added to the seed
 */
export function greekModel(
  vocabulary: ReadonlyMap<string, number>,
  ownGreek: Iterable<string> = []
): GreekModel {
  const words = new Set<string>([...GREEK_SEED, ...ownGreek].filter((w) => [...w].length >= 3))
  const garbled = train(
    [...words].flatMap((w) => garblings(w).map((g): [string, number] => [g, 1]))
  )
  const latin = train([...vocabulary].map(([w, n]): [string, number] => [w, Math.min(n, 5)]))
  const byLength = new Map<number, string[]>()
  for (const w of words) {
    const bare = bareGreek(w)
    if (![...bare].every((ch) => CONFUSIONS[ch] !== undefined)) continue
    const list = byLength.get(bare.length) ?? []
    list.push(w)
    byLength.set(bare.length, list)
  }
  return {
    score: (letters) => {
      const word = letters.toLowerCase()
      const own = Math.min(vocabulary.get(word) ?? 0, 5)
      return logProb(garbled, word) - logProb(latin, word, own)
    },
    couldBe: (letters) => {
      const latinWord = letters.toLowerCase()
      // A Greek letter becomes one or two Latin ones, so the Greek word is
      // between half the length and the whole of it.
      for (let n = Math.ceil(latinWord.length / 2); n <= latinWord.length; n++) {
        for (const w of byLength.get(n) ?? []) {
          const tells = fewestTells(latinWord, bareGreek(w))
          if (tells !== undefined && tells >= 1 && tells <= Math.max(1, n * MOST_TELLS)) return w
        }
      }
      return undefined
    }
  }
}
