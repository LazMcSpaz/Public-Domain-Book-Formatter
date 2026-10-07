/**
 * What the tradition's own books say about a glossary term, found the way a
 * reader would look it up.
 *
 * The glossary of the Hall collection was rewritten on Blavatsky's own
 * definitions, and the material that made that possible was a packet per
 * entry: her *Theosophical Glossary* entry for the word, the places it stands
 * in *The Key to Theosophy*, *The Secret Doctrine* and *Isis Unveiled*, and
 * the author's own sentences where the circle sits. The packets were built by
 * a script in one session's scratchpad, so the first session to end took the
 * only thing that could build them again. This is that script as a pure
 * module, so the next glossary gets the same footing.
 *
 * Two kinds of source, asked two different questions. A **dictionary** (the
 * *Theosophical Glossary*) is asked for the entry *headed* by the term: an
 * entry whose body merely mentions "adept" is not the definition of Adept,
 * and handing it over as one is how a writer ends up building an entry on
 * the wrong paragraph. Every other book is asked where the term *stands*,
 * a few passages each, cut at word boundaries.
 *
 * Matching is on letters as a reader sees them: tags stripped, diacritics
 * folded (`Mahâtma` is `Mahatma`), case ignored, hyphen and space alike, and
 * a plural on either side (Hall writes `Mahatmas`, Blavatsky heads `Mahâtma`).
 * A match must be a whole word: `Manu` is not found in `manual`.
 *
 * Nothing here writes anything. A packet is evidence for a writer, and what
 * is built on it is checked as everything else here is checked: quotations
 * against the packet, prose against the audit, and the result by a person.
 */
import { headwordTerms } from './marks'

export interface SourceBlock {
  id: string
  text: string
}

export interface SourceBook {
  /** How the book is named to the writer, e.g. "The Key to Theosophy". */
  title: string
  blocks: readonly SourceBlock[]
  /** True for a dictionary: asked for the entry headed by the term. */
  dictionary?: boolean
}

export interface Passage {
  id: string
  text: string
}

export interface GlossaryPacket {
  head: string
  /** The words the headword offers (`headwordTerms`). */
  terms: string[]
  /** The entry as it stands, where there is one. */
  current?: string
  /** Dictionary entries headed by one of the terms, by source title. */
  definitions: Record<string, string[]>
  /** Passages where a term stands, by source title. */
  elsewhere: Record<string, string[]>
  /** The book's own uses, circled ones first. */
  authorUses: Passage[]
}

export interface PacketOptions {
  /** Passages per non-dictionary source. */
  perSource?: number
  /** The book's own uses to carry. */
  authorUses?: number
  /** Characters either side of a match. */
  window?: number
  /**
   * Other spellings to look the term up under in the sources, by term:
   * `{ Cabbalist: ['Kabalist'] }`. For the variants no rule can fold, which
   * are a matter of which book the author learnt the word from. The author's
   * own uses are still found under his spelling.
   */
  aliases?: Readonly<Record<string, readonly string[]>>
}

const MARKS = /\p{M}/gu

/** One character as it is compared: no diacritic, lower case. */
function foldChar(c: string): string {
  return c.normalize('NFD').replace(MARKS, '').toLowerCase()
}

/** Text with its tags gone, the way the reader sees the words. */
export function plainOf(text: string): string {
  return text.replace(/<\/?(?:i|b|em|strong|sc)>/gi, '')
}

/**
 * The text folded for comparison, with a map from each folded character back
 * to the character of the plain text it came from, so a match can be cut out
 * of the text a writer will quote.
 */
function folded(plain: string): { text: string; at: number[] } {
  let text = ''
  const at: number[] = []
  for (let i = 0; i < plain.length; i++) {
    const f = foldChar(plain[i]!)
    for (const ch of f) {
      text += ch
      at.push(i)
    }
  }
  return { text, at }
}

const foldCache = new Map<string, { text: string; at: number[] }>()

/** `folded`, remembered: a packet run asks the same book once per entry. */
function foldedOnce(plain: string): { text: string; at: number[] } {
  let f = foldCache.get(plain)
  if (!f) {
    f = folded(plain)
    if (foldCache.size > 200_000) foldCache.clear()
    foldCache.set(plain, f)
  }
  return f
}

/** A term as a whole-word pattern over folded text, plural allowed. */
function termPattern(term: string): RegExp | null {
  const words = folded(term)
    .text.split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (words.length === 0) return null
  const last = words.length - 1
  // A singular term finds its plural, and a plural term its singular.
  words[last] = words[last]!.replace(/(?:es|s)$/, '') + '(?:es|s)?'
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\s-]+')}(?![\\p{L}\\p{N}])`, 'gu')
}

/**
 * A heading's words as compared: folded, separators alike, and no plural on
 * any word, so `Dweller on the Threshold` meets `Dwellers on the Threshold`.
 */
function key(s: string): string {
  return folded(s)
    .text.replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.replace(/(?:es|s)$/, ''))
    .join(' ')
}

/**
 * The words a dictionary entry is headed by: everything before its first
 * bracket or full stop, split on commas and "or", so `Abba, or Abba Amona` is
 * two heads and `Ânanda-Lahari (Sk.).` is one. A bracket that is not a
 * language tag names the word too: `Atmâ (or Atman)` is also Atman, and
 * `Dwellers (on the Threshold)` is also Dwellers on the Threshold.
 */
export function entryHeads(text: string): string[] {
  const plain = plainOf(text).trim()
  const end = plain.search(/\s\(|\.(\s|$)|:/)
  const head = (end === -1 ? plain.slice(0, 60) : plain.slice(0, end)).trim()
  const heads = head
    .split(/,|\bor\b/)
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
  // The brackets straight after the head, before the definition begins.
  const rest = end === -1 ? '' : plain.slice(end)
  for (const m of rest.matchAll(/^\s*\(([^)]*)\)|(?<=\))\s*\(([^)]*)\)/g)) {
    const inside = (m[1] ?? m[2] ?? '').trim()
    // A language label, dotted or not, is capitalised: (Sk.), (Greco-Sanskrit).
    // A variant opens on "or", and a completion of the head in lower case.
    if (/^or\s/i.test(inside)) heads.push(inside.replace(/^or\s+/i, ''))
    else if (/^\p{Ll}/u.test(inside) && !inside.includes('.') && heads[0]) {
      heads.push(`${heads[0]} ${inside}`)
    }
  }
  return heads
}

/** How much of an entry counts as its first line, for a variant spelling. */
const FIRST_LINE = 100

/**
 * Blavatsky transliterates Sanskrit without the h an English reader expects
 * (`Âkâsa` for akasha, `Siva` for Shiva), and closes up compounds an English
 * writer hyphenates (`Mûlaprakriti`, `Kamaloka`). Asked second, after the
 * plain comparison, so an English word is never folded unless nothing else
 * matched.
 */
const transliterated = (k: string): string =>
  k
    .replace(/sh/g, 's')
    .replace(/ /g, '')
    // A Sanskrit stem in -an is cited either way: Atma and Atman, Sutratma and
    // Sûtrâtman.
    .replace(/an$/, 'a')

/** The words that mark a variant spelling in a dictionary's first line. */
const VARIANT_CUE = /\b(?:written|spelt|spelled|pronounced|also called|known as)\b/

/**
 * Dictionary entries headed by any of the terms, asked in tiers so a looser
 * tier is reached only when every term has failed the stricter one: an alias
 * that heads an entry outranks a term that merely appears near the head of
 * another.
 *
 * 1. headed by the term as it is spelt;
 * 2. headed by it as Blavatsky transliterates (`transliterated`);
 * 3. heading an entry whose head goes on past it, `Kundalini Sakti` for
 *    Kundalini and `Hiram Abiff` for Hiram;
 * 4. naming it in an entry's first line after a word that marks a variant,
 *    which is how a dictionary records one: `Arahat (Sk.). Also pronounced
 *    and written Arhat`. Not any mention: an entry that names the word in
 *    passing is not its definition, and "the priests who served the Fire-God
 *    in Aryan antiquity" is not the entry for Aryan.
 */
export function definitionsOf(
  term: string | readonly string[],
  blocks: readonly SourceBlock[]
): SourceBlock[] {
  const terms = (typeof term === 'string' ? [term] : term).filter((t) => key(t))
  if (terms.length === 0) return []
  const wants = terms.map(key)
  const headed = blocks.filter((b) => entryHeads(b.text).some((h) => wants.includes(key(h))))
  if (headed.length > 0) return headed
  const loose = wants.map(transliterated)
  const translit = blocks.filter((b) =>
    entryHeads(b.text).some((h) => loose.includes(transliterated(key(h))))
  )
  if (translit.length > 0) return translit
  const longer = blocks.filter((b) =>
    entryHeads(b.text).some((h) => wants.some((w) => key(h).startsWith(`${w} `)))
  )
  if (longer.length > 0) return longer
  const patterns = terms.map(termPattern).filter((p): p is RegExp => p !== null)
  return blocks.filter((b) => {
    const opening = foldedOnce(plainOf(b.text).slice(0, FIRST_LINE)).text
    return patterns.some((p) => {
      p.lastIndex = 0
      const m = p.exec(opening)
      return m !== null && VARIANT_CUE.test(opening.slice(0, m.index))
    })
  })
}

/** A term as Blavatsky would spell it, for a second look in her books. */
function looseForms(terms: readonly string[]): string[] {
  return terms.flatMap((t) => {
    const f = folded(t).text
    const forms = [
      f.replace(/sh/g, 's'),
      f.replace(/[\s-]+/g, ''),
      f.replace(/sh/g, 's').replace(/[\s-]+/g, '')
    ]
    return forms.filter((x) => x !== f)
  })
}

/** The stretch round a match, cut at word boundaries and marked where cut. */
function snippet(plain: string, from: number, to: number, window: number): string {
  let start = Math.max(0, from - window)
  let end = Math.min(plain.length, to + window)
  if (start > 0) {
    const space = plain.indexOf(' ', start)
    start = space === -1 || space > from ? start : space + 1
  }
  if (end < plain.length) {
    const space = plain.lastIndexOf(' ', end)
    end = space <= to ? end : space
  }
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`
}

/**
 * Up to `limit` passages where a term stands, one per block, in book order.
 * `prefer` puts the blocks it accepts first, keeping book order within each
 * group: the author's own circled uses lead his packet.
 */
export function passagesOf(
  terms: readonly string[],
  blocks: readonly SourceBlock[],
  limit: number,
  window: number,
  prefer?: (matched: string) => boolean
): Passage[] {
  const patterns = terms.map(termPattern).filter((p): p is RegExp => p !== null)
  const hits: (Passage & { preferred: boolean })[] = []
  for (const b of blocks) {
    const plain = plainOf(b.text)
    const f = foldedOnce(plain)
    for (const p of patterns) {
      p.lastIndex = 0
      const m = p.exec(f.text)
      if (!m) continue
      const from = f.at[m.index]!
      const to = f.at[m.index + m[0].length - 1]! + 1
      const after = plain.slice(to, to + 1)
      hits.push({
        id: b.id,
        text: snippet(plain, from, to, window),
        preferred: prefer ? prefer(plain.slice(from, to) + after) : false
      })
      break
    }
  }
  const ordered = [...hits.filter((h) => h.preferred), ...hits.filter((h) => !h.preferred)]
  return ordered.slice(0, limit).map(({ id, text }) => ({ id, text }))
}

/**
 * Everything a writer needs for one entry: the tradition's definition, where
 * else the tradition uses the word, and where the author does.
 */
export function glossaryPacket(
  head: string,
  current: string | undefined,
  sources: readonly SourceBook[],
  book: readonly SourceBlock[],
  options: PacketOptions = {}
): GlossaryPacket {
  const perSource = options.perSource ?? 3
  const window = options.window ?? 280
  const terms = headwordTerms(head)
  const aliases = options.aliases ?? {}
  const lookup = [
    ...terms,
    ...terms.flatMap((t) =>
      Object.entries(aliases)
        .filter(([from]) => key(from) === key(t))
        .flatMap(([, to]) => to)
    )
  ]
  const definitions: Record<string, string[]> = {}
  const elsewhere: Record<string, string[]> = {}
  for (const source of sources) {
    if (source.dictionary) {
      const found = definitionsOf(lookup, source.blocks)
      const unique = [...new Map(found.map((b) => [b.id, plainOf(b.text)])).values()]
      if (unique.length > 0) definitions[source.title] = unique
    } else {
      // Her own spelling only when the author's finds nothing in that book.
      let found = passagesOf(lookup, source.blocks, perSource, window)
      if (found.length === 0) {
        found = passagesOf(looseForms(lookup), source.blocks, perSource, window)
      }
      if (found.length > 0) elsewhere[source.title] = found.map((p) => p.text)
    }
  }
  const authorUses = passagesOf(terms, book, options.authorUses ?? 3, window, (m) =>
    m.endsWith('°')
  )
  return { head, terms, ...(current ? { current } : {}), definitions, elsewhere, authorUses }
}

/** A quotation shorter than this is a gloss ("he who has attained"), not a citation. */
const QUOTE_WORDS = 5

/**
 * The quotations in an entry that its packet does not carry.
 *
 * The brief says quote Blavatsky or the author exactly or not at all, and a
 * writer working from memory produces a quotation that reads right and is
 * not in either book. Every passage of five words or more inside quotation
 * marks is looked for in the packet (the entry as it stood, her definitions,
 * the passages, the author's uses), letters only, so a curly quote or a
 * spacing difference is not a miss. What comes back is a list to read: a
 * quotation from a book the packet did not reach is possible, and that is
 * exactly the one to check by hand.
 */
export function quotesNotInPacket(text: string, packet: GlossaryPacket): string[] {
  const letters = (s: string) =>
    folded(plainOf(s))
      .text.replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const haystack = letters(
    [
      packet.current ?? '',
      ...Object.values(packet.definitions).flat(),
      ...Object.values(packet.elsewhere).flat(),
      ...packet.authorUses.map((u) => u.text)
    ].join(' \u0000 ')
  )
  const quotes = [...plainOf(text).matchAll(/[“"]([^”"]+)[”"]/gu)].map((m) => m[1]!.trim())
  return quotes.filter(
    (q) => q.split(/\s+/).length >= QUOTE_WORDS && !haystack.includes(letters(q))
  )
}
