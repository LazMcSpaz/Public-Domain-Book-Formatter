/**
 * Chapter numbers, said rather than spelled.
 *
 * Measured on a real reading: `LESSON VIII` comes back as **"lesson roman
 * eight"** — the phonemizer announces the numeral system before the number, in
 * every chapter of every book on this shelf. `LESSON I` is worse and quieter: it
 * comes back as **"lesson eye"**, which sounds like a word and so passes any
 * check that is listening for something obviously broken.
 *
 * The fix is deterministic and belongs before the voice ever sees the text.
 * What needs care is not the conversion but knowing when a numeral is a
 * numeral: `I` is also the commonest pronoun in English, and an occult shelf is
 * exactly where a chapter called `I AM THAT I AM` turns up. So this converts in
 * only the two places a chapter number actually appears — after a divider word,
 * and standing alone as the whole heading — and leaves every other `I` alone.
 *
 * Pure.
 */

/** Words a chapter number follows on a title page or a chapter opening. */
const DIVIDERS = new Set([
  'lesson',
  'chapter',
  'part',
  'book',
  'section',
  'act',
  'scene',
  'appendix',
  'volume',
  'canto',
  'stanza'
])

const VALUES: ReadonlyArray<readonly [string, number]> = [
  ['M', 1000],
  ['CM', 900],
  ['D', 500],
  ['CD', 400],
  ['C', 100],
  ['XC', 90],
  ['L', 50],
  ['XL', 40],
  ['X', 10],
  ['IX', 9],
  ['V', 5],
  ['IV', 4],
  ['I', 1]
]

/**
 * A Roman numeral's value, or null if the token is not one.
 *
 * Strict rather than forgiving: the token has to be exactly what the canonical
 * spelling of its own value would be, so `IIII`, `VV` and `IC` are refused. A
 * lenient parser here would turn the word `MIX` into 1009 and `DID` into 999.
 */
export function romanValue(token: string): number | null {
  if (!/^[MDCLXVI]+$/u.test(token)) return null
  let value = 0
  let at = 0
  for (const [numeral, amount] of VALUES) {
    while (token.startsWith(numeral, at)) {
      value += amount
      at += numeral.length
    }
  }
  if (at !== token.length || value === 0) return null
  // Canonical only. This is what refuses `MIX`, `DID` and `IIII`, which parse to
  // a number under a lenient reading and stop being words when they do.
  return canonicalRoman(value) === token ? value : null
}

function canonicalRoman(value: number): string {
  let left = value
  let out = ''
  for (const [numeral, amount] of VALUES) {
    while (left >= amount) {
      out += numeral
      left -= amount
    }
  }
  return out
}

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen'
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

/** A number as English words. Chapter numbers, so hundreds are the ceiling. */
export function spellNumber(value: number): string {
  if (value < 0 || !Number.isInteger(value)) return ''
  if (value < 20) return ONES[value]
  if (value < 100) {
    const rest = value % 10
    return rest === 0
      ? TENS[Math.floor(value / 10)]
      : `${TENS[Math.floor(value / 10)]}-${ONES[rest]}`
  }
  if (value < 1000) {
    const rest = value % 100
    const hundreds = `${ONES[Math.floor(value / 100)]} Hundred`
    return rest === 0 ? hundreds : `${hundreds} ${spellNumber(rest)}`
  }
  return ''
}

/**
 * A heading with its chapter number written out.
 *
 * Only a heading: body prose is left alone entirely, because there is no
 * reading of `I` in a sentence that this should touch.
 */
export function speakHeadingNumbers(heading: string): string {
  const tokens = heading.split(/(\s+)/u)
  const words = tokens.filter((t) => t.trim().length > 0)

  // The whole heading is a number — a chapter opening that prints "VIII" and
  // nothing else.
  if (words.length === 1) {
    const bare = stripPunctuation(words[0])
    const said = numberWord(bare)
    return said === null ? heading : heading.replace(bare, said)
  }

  let previous = ''
  return tokens
    .map((token) => {
      if (token.trim().length === 0) return token
      const bare = stripPunctuation(token)
      const said = DIVIDERS.has(previous.toLowerCase()) ? numberWord(bare) : null
      previous = bare
      return said === null ? token : token.replace(bare, said)
    })
    .join('')
}

/**
 * A numeral token as words, or null to leave it exactly as it is.
 *
 * Above a thousand `spellNumber` has nothing to say — a chapter number never
 * goes there, and a Roman year on a title page wants "nineteen sixteen" rather
 * than "one thousand nine hundred and sixteen", which is a different question
 * and not this one. Leaving it alone is the honest outcome; half-converting it
 * is not.
 */
function numberWord(token: string): string | null {
  const value = romanValue(token)
  if (value === null) return null
  const said = spellNumber(value)
  return said.length > 0 ? said : null
}

/** A token without the full stops and colons a heading hangs off it. */
function stripPunctuation(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}
