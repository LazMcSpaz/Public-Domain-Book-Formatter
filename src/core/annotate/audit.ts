/**
 * Reading the editor's own prose back, looking for the thumb on the scale.
 *
 * Every other check in this app exists because the thing being checked cannot
 * be trusted to check itself: OCR is the independent witness against the vision
 * pass, `verifyBook` compares leaves the model read separately, `checkProposals`
 * lists the claims a note makes that the book never made. SPEC §4 puts it as a
 * rule — escalation is decided by deterministic cross-checks, never by a
 * model's opinion of its own output.
 *
 * The bias this module measures is exactly that shape. The shelf is occult and
 * esoteric books, and anything writing about them carries a lean whether or not
 * it was asked for: the natural register for "astral body" comes out a shade
 * more guarded than the register for "endocrine gland". Nobody argues the case,
 * and a reader going down the page absorbs it anyway. Asking the writer whether
 * they were even-handed is worthless — they will say yes, and mean it. So this
 * counts instead.
 *
 * ## What is actually measured
 *
 * **Hedge asymmetry** is the headline and the only one of these that catches
 * the real defect. Sentences are sorted into those about the tradition and
 * those about material science, hedges are counted in each, and the two rates
 * are compared. Any single hedge may be perfectly honest — "held to be" is the
 * correct way to report a doctrine — so no individual match means anything. The
 * *ratio* means something: hedging the tradition three times as often as the
 * science is a verdict delivered by grammar, and it shows up here as a number
 * whatever the writer intended.
 *
 * A floor of `MIN_SENTENCES` on each side before a ratio is reported at all,
 * for the reason `verify-book.ts` has quorums: a passage with two sentences
 * about science in it can produce any ratio you like out of noise, and a check
 * that cries wolf on short texts gets switched off.
 *
 * **Dismissals** and **banned phrasing** are plain lexical scans. They catch
 * less, and what they catch is unambiguous: "worthless", "exploded",
 * "nothing more than" are verdicts however they are framed.
 *
 * What is *not* measured is flatness — whether an entry is so dry nobody would
 * want to try anything. That one needs a reader, and pretending a word list
 * could stand in for one would be the same error this module exists to catch.
 *
 * Pure: no I/O, no network, no model.
 */

/** Words that mark a sentence as being about the tradition's own subject. */
const TRADITION = [
  'astral',
  'aura',
  'auric',
  'akasha',
  'akashic',
  'prana',
  'pranic',
  'clairvoyan',
  'clairaudien',
  'psychic',
  'psychometr',
  'occult',
  'esoteric',
  'theosoph',
  'etheric',
  'thought-form',
  'thought form',
  'siddhi',
  'telepath',
  'telekine',
  'medium',
  'seer',
  'adept',
  'magic',
  'mystic',
  'spirit',
  'soul',
  'vibration',
  'plane',
  'chakra',
  'karma',
  'reincarnat',
  'second sight',
  'prevision',
  'subtle',
  'emanation',
  'invisible world',
  'higher plane',
  'scrying',
  'crystal-gaz',
  'trance',
  'meditat'
]

/** Words that mark a sentence as being about material science or its findings. */
const SCIENCE = [
  'gland',
  'secret',
  'melatonin',
  'hormone',
  'neuro',
  'nerve',
  'nervous system',
  'brain',
  'cortex',
  'physiolog',
  'anatom',
  'molecul',
  'atom',
  'chemic',
  'physic',
  'experiment',
  'laborator',
  'measur',
  'observ',
  'wavelength',
  'radiation',
  'electric',
  'magnetis',
  'microscop',
  'telescop',
  'astronom',
  'geolog',
  'evidence',
  'statistic',
  'commission',
  'research',
  'scientif',
  'medicin',
  'clinical'
]

/** Constructions that hold a statement at arm's length. */
const HEDGES = [
  'supposed',
  'purported',
  'alleged',
  'so-called',
  'said to be',
  'said to',
  'held to be',
  'claimed to',
  'believed to',
  'thought to be',
  'is claimed',
  'are claimed',
  'ostensibl',
  'apparent',
  'would-be'
]

/** Verdicts, which are never in this editor's gift however they are dressed. */
const DISMISSALS = [
  'worthless',
  'nonsense',
  'exploded',
  'disproved',
  'debunked',
  'mere superstition',
  'nothing more than',
  // Anchored to a copula. Bare "nothing but" is an ordinary intensifier —
  // "thinking of nothing but that letter" is the book's own advice on
  // concentration — and flagging it taught this check to cry wolf on the first
  // piece of real prose it was pointed at.
  'is nothing but',
  'was nothing but',
  'are nothing but',
  'were nothing but',
  'no such thing',
  'has no known function',
  'sheer invention',
  'pure invention',
  'imaginary'
]

/**
 * Phrasing the house rules and the voice card rule out.
 *
 * The last group is the method stated in the reader's own prose. How an
 * edition was made is between the editor and whoever makes it: a glossary
 * that announces it will not tell you what to read raises a doubt about the
 * editor that nothing on the page had raised, and reads as a defence of
 * something nobody accused him of.
 */
const BANNED = [
  'fascinating',
  'intriguing',
  'curiously',
  'it is worth noting',
  'worth noticing',
  'the present editor',
  'cf.',
  'q.v.',
  'tells anyone what to read',
  'is offered as a verdict',
  'nothing here is offered',
  // The standard comfort formula of this genre. It quietly tells the reader
  // the question does not matter. It does; this editor simply does not presume
  // to settle it for them.
  'whether or not you believe',
  'dear reader',
  'gentle reader'
]

/**
 * Telling the reader where to go next, which is not this editor's to do.
 *
 * The rule and its line: naming the book a quotation comes from **identifies**
 * it and is owed to the reader; "the best place to go from here" **directs**,
 * and that choice is the reader's own. The one exception is a book set in this
 * series, which may be mentioned as available, because that is a fact about
 * what the reader already has to hand.
 *
 * Worth a mechanical scan because the rule was settled, applied once by hand,
 * and then broke four more times across two glossaries — one of them in a
 * preamble announcing the practice as a feature. A ruling that lives only in
 * somebody's intention is a ruling that leaks back in.
 *
 * Anchored tightly. "Start with" is ordinary English about method — *start
 * with the hand against something black* is the book's own first exercise —
 * so only the reading senses are matched.
 */
const DIRECTIONS = [
  'where a reader should',
  'a reader should go',
  'a reader should start',
  'should go for the fuller',
  'best place to go',
  'go from here',
  'the natural book',
  'the natural place',
  'to read next',
  'read after this',
  'books to start with',
  'start with her',
  'start with his',
  'start with their',
  'the obvious place to'
]

/**
 * A dash doing the work of a comma, a colon or a bracket.
 *
 * Kept out of this editor's prose by request, and worth a mechanical check
 * rather than a good intention: it is the single most recognisable habit of
 * machine-written English, and a reader who has noticed it once notices it
 * everywhere after. Hyphens inside compounds are untouched — only a dash with
 * space around it, or an em dash anywhere, is the construction meant.
 */
const DASH = /\u2014|\u2013/gu

/**
 * How many sentences of each kind are needed before a ratio is reported.
 *
 * Below this the number is noise. Same reasoning as the quorums in
 * `verify-book.ts`: a check that fires on a short passage is a check somebody
 * learns to ignore.
 */
import { parseInlineMarkup } from '@core/transcribe'
export const MIN_SENTENCES = 6

/**
 * The longest a leading fragment can be and still be only a headword.
 *
 * "Aerolite." is one word; "Lavater, Johann Kaspar (1741-1801)." is four. A
 * real opening sentence is longer than either.
 */
export const HEADWORD_WORDS = 5

/**
 * How much more hedged the tradition may be before it is worth saying so.
 *
 * Secondary, and kept because it catches a lean in either direction. It is not
 * the main measure and was wrong when it was: symmetry with the science is not
 * what this editor is after. See `ProseAudit.hedgedTeaching`.
 */
export const HEDGE_RATIO_LIMIT = 1.6

/**
 * How many hedges are needed on the tradition side before a ratio means
 * anything.
 *
 * `MIN_SENTENCES` puts a floor under the denominator; nothing put one under the
 * numerator, so a clean document with a single legitimate hedge in it and none
 * on the science side divided one by zero and reported an infinite lean. A
 * check that flags good prose is a check that gets ignored, which this module's
 * own notes say twice and then did anyway.
 */
export const MIN_HEDGES = 3

export type BiasKind =
  'dismissal' | 'banned' | 'hedge' | 'dash' | 'direction' | 'rhythm' | 'person' | 'placeholder'

export interface BiasFinding {
  kind: BiasKind
  /** The phrase that matched. */
  match: string
  /** The sentence it sits in, for judging whether it is fair in context. */
  sentence: string
  /** Whether that sentence was about the tradition. Only set for hedges. */
  tradition?: boolean
}

export interface ProseAudit {
  findings: BiasFinding[]
  sentences: { tradition: number; science: number; total: number }
  hedges: { tradition: number; science: number }
  /** The same counts over opening sentences only. See `openingRatio`. */
  openings: { tradition: number; science: number }
  openingHedges: { tradition: number; science: number }
  /**
   * The asymmetry where it actually lives, or null when either side is thin.
   *
   * Measured across a whole document the effect washes out: the first version
   * of a real glossary on this shelf hedged its doctrinal *definitions* three
   * times over — "the supposed imperishable record", "matter said to
   * interpenetrate the physical" — and still came out at 0.72 overall, because
   * two hundred sentences about people and places and dates diluted it to
   * nothing. The check reported even and the prose was not.
   *
   * The opening sentence of an entry is where the definition lives, and a hedge
   * there colours everything under it. Counting those separately is what
   * catches the thing this module was built for.
   */
  openingRatio: number | null
  /**
   * Tradition hedge rate over science hedge rate, or null when either side is
   * too thin to say. Above `HEDGE_RATIO_LIMIT` is the finding that matters.
   */
  ratio: number | null
  /**
   * Flesch-Kincaid grade level, and the average sentence length behind it.
   *
   * Reported rather than enforced. There is no correct grade for an
   * introduction and a glossary is not a school reader, but the number moves
   * when prose gets tangled and it is the fastest way to see that a draft has
   * drifted upwards while nobody was watching. Sentence length is given beside
   * it because that is almost always the lever: long words are usually the
   * subject's fault, long sentences are the writer's.
   */
  reading: { grade: number; wordsPerSentence: number }
  /**
   * Every hedge sitting on a sentence about the tradition, to be read and
   * judged one at a time.
   *
   * This is the list that matters, and it took a correction from the editor to
   * see why. The first version of this module measured whether the tradition
   * was hedged *more than the science was*, as though the job were even-handed
   * arbitration between two parties. It is not. This editor holds the
   * established teaching to be true and writes about it accordingly; what the
   * scientific method gets is respect, not equal billing. So a glossary with
   * four doctrines hedged into vagueness scored a comfortable 1.41 "even",
   * because the science had been hedged a bit too.
   *
   * No lexicon can tell an established teaching from a contested claim, and
   * both take the same words. So nothing here is a fault on its own: the
   * astral cord stated plainly is right, and second sight reported as a
   * regional reputation is also right. They are listed because each one is a
   * decision, there are rarely more than a handful, and the decision is a
   * person's.
   */
  hedgedTeaching: BiasFinding[]
  /** True when nothing here needs a person to look at it. */
  /** Three or more sentences running in one length band. Reported, not enforced. */
  flatStretches: BiasFinding[]
  /**
   * Sentences opening on a placeholder subject, and the rate.
   *
   * `overLimit` is the flag; the list is the reading. See
   * `PLACEHOLDER_OPENER_BASELINE` for where the number came from.
   */
  placeholders: { findings: BiasFinding[]; rate: number; overLimit: boolean }
  /**
   * Names and figures per thousand words. Reported, never enforced.
   *
   * See `concretenessOf`. A piece far below the editor's own sixty is a
   * question about what the writer was given before it is one about the prose.
   */
  concreteness: { properNouns: number; numerals: number; perThousand: number }
  clean: boolean
}

/**
 * How much of the prose is made of things with names.
 *
 * Reported and never enforced, because there is no correct density: a book
 * that names nobody cannot have an introduction that names anybody, and
 * forcing the number would be an instruction to invent. It is here because it
 * is the measurement that found the largest fault in this whole arrangement.
 *
 * The editor's own accepted introduction runs about sixty proper nouns per
 * thousand words — Röntgen, the Curies, Marconi, the Fox sisters, Kardec,
 * Blavatsky, Crookes, Oliver Lodge, Ypres, Rhine, the Creery children, an
 * address on South Oxford Avenue. A draft of the same book came back at six.
 * That looked like a failure of the writer and was not: the briefing had been
 * handing over a list of chapter titles while `synopsis.ts` sat on the
 * analytical contents, which is where an old book keeps its names and its
 * figures. Nothing in the audit could see that, and the number is the only
 * reason it was found. So it is printed on every run, and a piece that comes
 * back an order of magnitude below the editor's own is a question about the
 * briefing before it is a question about the prose.
 *
 * A proper noun is a capitalised word that is not opening its sentence. That
 * over-counts a title-cased phrase and under-counts a name at the head of a
 * sentence, which is fine for a quantity being read as "six or sixty".
 */
function concretenessOf(text: string): {
  properNouns: number
  numerals: number
  perThousand: number
} {
  const sentences = sentencesOf(text.replace(/\n\s*\n/gu, ' '))
  let properNouns = 0
  for (const sentence of sentences) {
    for (const word of sentence.split(/\s+/u).slice(1)) {
      if (/^[A-Z][a-z]{2,}/u.test(word)) properNouns += 1
    }
  }
  const words = text.split(/\s+/u).filter(Boolean)
  const numerals = words.filter((w) => /\d/u.test(w)).length
  return {
    properNouns,
    numerals,
    perThousand: words.length > 0 ? (1000 * (properNouns + numerals)) / words.length : 0
  }
}

/**
 * Sentences that open on a placeholder subject instead of on something.
 *
 * "It is", "There is", "This is", "What X is is" — the constructions that put
 * a grammatical placeholder where a subject belongs, and defer the actual
 * content past a copula. Every one of them can be rewritten with the thing
 * itself in front. "It is a fair warning of what is actually here" against
 * "That warning is fair"; "What reading it is like is the ordinary experience
 * of being taught by a careful man" against "Reading it is being taught by a
 * careful man".
 *
 * Not banned, and the limit is not zero. The editor's own approved
 * introduction uses eleven of them in a hundred and twenty-three sentences,
 * and one of them — "That is the whole of it." — is the best sentence in its
 * paragraph. Used deliberately the construction slows a line down and lands
 * it. Used by default it is the most recognisable tic in machine-written
 * English, and a draft written to the same briefing came back at nearly twice
 * the rate.
 *
 * So this is a rate against a measured baseline rather than a lexical ban,
 * which is the same shape as the hedge ratio and for the same reason: the
 * words are not the fault, the proportion is.
 */
const PLACEHOLDER_OPENER =
  /^(it (is|was|would be|has been)|there (is|are|was|were|has been|have been)|this is|these are|that is|what [^.?!]{2,60} is)\b/iu

/**
 * The rate in the front matter this editor has accepted, measured on the files.
 *
 * All four introductions on the shelf, counted by this function: 9%, 8%, 9%,
 * 11%. They cluster tightly, which is what makes the number worth having — one
 * file would be an anecdote. A draft written to the same briefing came back at
 * 17%, outside all of them.
 *
 * Kept as a number rather than as "sparingly" because a card that says "vary
 * hard" and "prefer the concrete" is giving adjectives to something countable,
 * and a writer given an adjective cannot tell whether it has complied.
 */
export const PLACEHOLDER_OPENER_BASELINE = 0.09

/** How far past the baseline is worth a person's attention. */
export const PLACEHOLDER_OPENER_LIMIT = 0.15

/** Below this many sentences the rate says nothing. */
const MIN_PLACEHOLDER_SENTENCES = 25

/**
 * Syllables, by the usual heuristic: vowel groups, with a silent final e.
 *
 * Wrong on "fire" and on "business", right often enough for a grade level,
 * which is a coarse instrument being used as a coarse instrument.
 */
function syllablesIn(word: string): number {
  const w = word.toLocaleLowerCase().replace(/[^a-z]/gu, '')
  if (!w) return 0
  return Math.max(1, (w.replace(/(?<!^)e$/u, '').match(/[aeiouy]+/gu) ?? []).length)
}

/** Flesch-Kincaid, and the sentence length that usually explains it. */
function readingOf(text: string): { grade: number; wordsPerSentence: number } {
  const sentences = sentencesOf(text.replace(/\n\s*\n/gu, ' '))
  const words = text.match(/[A-Za-z][A-Za-z'-]*/gu) ?? []
  if (sentences.length === 0 || words.length === 0) {
    return { grade: 0, wordsPerSentence: 0 }
  }
  const syllables = words.reduce((n, w) => n + syllablesIn(w), 0)
  const wordsPerSentence = words.length / sentences.length
  return {
    grade: 0.39 * wordsPerSentence + 11.8 * (syllables / words.length) - 15.59,
    wordsPerSentence
  }
}

/** Sentence-ish. Abbreviations make this approximate, and approximate is fine. */
/**
 * Which length band a sentence sits in.
 *
 * The rule is "never three consecutive sentences in the same length band", and
 * the bands are set where they are because the editor's own model passage
 * clears them. Calibrated against that passage rather than chosen: a band
 * scheme that flags known-good prose is a check that gets switched off.
 */
function band(sentence: string): 'short' | 'medium' | 'long' {
  const words = sentence.trim().split(/\s+/u).filter(Boolean).length
  if (words <= 11) return 'short'
  return words <= 26 ? 'medium' : 'long'
}

/**
 * Three sentences running in the same band, which is the flat rhythm the voice
 * exists to avoid. Reported per paragraph: a run cannot cross a paragraph
 * break, because the break is itself a change of pace.
 */
function flatRuns(paragraph: string): string[] {
  const sentences = sentencesOf(paragraph).filter((x) => x.trim().split(/\s+/u).length > 2)
  const runs: string[] = []
  let start = 0
  for (let i = 1; i <= sentences.length; i++) {
    if (i < sentences.length && band(sentences[i]!) === band(sentences[start]!)) continue
    if (i - start >= 3) runs.push(sentences.slice(start, i).join(' '))
    start = i
  }
  return runs
}

/** Does one man speak in this? The voice is first person singular throughout. */
const FIRST_PERSON = /\b(I|I'm|I'd|I've|I'll|me|my|mine|myself)\b/u

function sentencesOf(text: string): string[] {
  return text
    .replace(/[ \t]+/gu, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * What a sentence is about, falling back to the paragraph around it.
 *
 * Sentence-by-sentence classification loses the subject, and the sentences it
 * loses it on are the ones that matter: "The world of subtle matter said to
 * interpenetrate the physical" is unmistakably about the tradition and contains
 * no word a list would catch, so the hedge in it went uncounted — which was the
 * first thing this check got wrong when it was tried on real prose.
 *
 * An entry is a paragraph about one thing, so an unmarked sentence takes the
 * paragraph's subject. Only when the paragraph is unambiguous: where a
 * paragraph talks about both, an unmarked sentence in it is genuinely unclear
 * and counting it on both sides would inflate the rates it is there to compare.
 */
function classify(
  sentence: string,
  paragraph: { tradition: boolean; science: boolean }
): { tradition: boolean; science: boolean } {
  const lower = sentence.toLocaleLowerCase()
  const tradition = has(lower, TRADITION).length > 0
  const science = has(lower, SCIENCE).length > 0
  if (tradition || science) return { tradition, science }
  if (paragraph.tradition !== paragraph.science) return paragraph
  return { tradition: false, science: false }
}

const has = (haystack: string, needles: readonly string[]): string[] =>
  needles.filter((n) => haystack.includes(n))

/**
 * Audit a piece of the editor's prose.
 *
 * `text` is whatever was written — an introduction, a glossary, the notes of a
 * chapter run together. Sentence classification is deliberately crude: a
 * sentence mentioning both a gland and an aura counts for both sides, because
 * that is exactly the sentence where the asymmetry does its work.
 */
export interface AuditOptions {
  /**
   * Require the first person singular.
   *
   * True for the editor's own front matter, where one man is speaking and has
   * to be in the room. False for a glossary, where the impersonal register is
   * correct: nobody wants "I think an aerolite is a meteorite." The rule is
   * about the introduction, so the caller says which kind of piece this is
   * rather than the check guessing from the words.
   */
  firstPerson?: boolean
}

export function auditProse(raw: string, options: AuditOptions = {}): ProseAudit {
  // Inline markup is notation, not prose, and it wrecks the sentence splitter:
  // `<b>Aerolite.</b> A stony meteorite.` has its full stop followed by `<`
  // rather than a space, so the two sentences read as one. A glossary with 126
  // bold headwords in it moved the reading grade from 9.1 to 13.4 without a
  // word changing. Stripped through the same parser the book is set from, so
  // the audit sees exactly the words a reader will.
  const text = parseInlineMarkup(raw).text
  const findings: BiasFinding[] = []
  /**
   * Held apart from `findings`, which is the list of things that are wrong.
   *
   * At the editor's own rate this construction is not wrong — it is one of the
   * ways he lands a line — so a report that filed it beside a banned phrase
   * would be a report somebody eventually tunes until it stops firing. The
   * rate is the finding; the sentences are the reading.
   */
  const placeholderFindings: BiasFinding[] = []
  let traditionSentences = 0
  let scienceSentences = 0
  let traditionHedges = 0
  let scienceHedges = 0

  let total = 0
  let openTradition = 0
  let openScience = 0
  let openTraditionHedged = 0
  let openScienceHedged = 0

  for (const paragraph of text.split(/\n\s*\n/u)) {
    if (!paragraph.trim()) continue
    const context = paragraph.toLocaleLowerCase()
    const around = {
      tradition: has(context, TRADITION).length > 0,
      science: has(context, SCIENCE).length > 0
    }

    // Which sentence is the *definition*, as against the headword.
    //
    // A glossary entry opens "Akashic Records. The supposed imperishable
    // record…", and a sentence splitter quite correctly makes "Akashic
    // Records." a sentence of its own — so measuring "the opening sentence"
    // measured the term and never the definition, and the check reported no
    // hedged openings at all on prose that was full of them. The definition is
    // the first sentence long enough to be one.
    const sentences = sentencesOf(paragraph)
    const opening = sentences.findIndex((x) => x.split(/\s+/u).length > HEADWORD_WORDS)

    for (const run of flatRuns(paragraph)) {
      findings.push({ kind: 'rhythm', match: band(sentencesOf(run)[0] ?? run), sentence: run })
    }

    let index = -1
    for (const sentence of sentences) {
      index += 1
      total += 1
      const lower = sentence.toLocaleLowerCase()
      const { tradition: isTradition, science: isScience } = classify(sentence, around)
      if (isTradition) traditionSentences += 1
      if (isScience) scienceSentences += 1

      if (index === opening) {
        // A glossary headword sits in its own opening sentence, so the opener
        // is classified on its own terms and not by inheritance — inheriting
        // here would let the rest of an entry decide what its definition was
        // about.
        if (isTradition) openTradition += 1
        if (isScience) openScience += 1
        if (has(lower, HEDGES).length > 0) {
          if (isTradition) openTraditionHedged += 1
          if (isScience) openScienceHedged += 1
        }
      }

      const hedges = has(lower, HEDGES)
      if (hedges.length > 0) {
        if (isTradition) traditionHedges += 1
        if (isScience) scienceHedges += 1
        // Reported so a person can read them in context, not as faults: the
        // count is what carries the argument, and any one of these may be the
        // honest way to report a doctrine.
        for (const match of hedges) {
          findings.push({ kind: 'hedge', match, sentence, tradition: isTradition })
        }
      }
      for (const match of has(lower, DISMISSALS)) {
        findings.push({ kind: 'dismissal', match, sentence })
      }
      for (const match of has(lower, BANNED)) findings.push({ kind: 'banned', match, sentence })
      for (const match of has(lower, DIRECTIONS)) {
        findings.push({ kind: 'direction', match, sentence })
      }
      for (const match of sentence.match(DASH) ?? []) {
        findings.push({ kind: 'dash', match, sentence })
      }
      const placeholder = sentence.match(PLACEHOLDER_OPENER)
      if (placeholder) {
        placeholderFindings.push({ kind: 'placeholder', match: placeholder[0], sentence })
      }
    }
  }

  const placeholderRate = total > 0 ? placeholderFindings.length / total : 0

  const enough =
    traditionSentences >= MIN_SENTENCES &&
    scienceSentences >= MIN_SENTENCES &&
    traditionHedges + scienceHedges >= MIN_HEDGES
  // Rates rather than counts: a text with four times as many sentences about
  // the tradition would otherwise look biased for being about its subject.
  const ratio = enough
    ? traditionHedges / traditionSentences / Math.max(scienceHedges / scienceSentences, 1e-9)
    : null

  const enoughOpeners =
    openTradition >= MIN_SENTENCES &&
    openScience >= MIN_SENTENCES &&
    openTraditionHedged + openScienceHedged >= MIN_HEDGES
  const openingRatio = enoughOpeners
    ? openTraditionHedged / openTradition / Math.max(openScienceHedged / openScience, 1e-9)
    : null

  // One man is speaking, and he has to be in the room. A piece of any length
  // with no first person singular in it has slipped into the impersonal
  // register this voice was written against, and that is not a phrase a lexical
  // scan can catch: it is an absence.
  if (options.firstPerson === true && total > 3 && !FIRST_PERSON.test(text)) {
    findings.push({
      kind: 'person',
      match: 'no first person singular',
      sentence: sentencesOf(text.replace(/\n\s*\n/gu, ' '))[0] ?? ''
    })
  }

  // Rhythm is reported and not enforced, for the same reason the reading grade
  // is. "Never three consecutive sentences in the same length band" is a rule
  // for the writer, and the editor's own model passage breaks it: its first
  // paragraph runs 14, 20, 19 and 17 words. Failing prose the editor himself
  // would write is how a check gets switched off, so this one surfaces flat
  // stretches for a person to judge and leaves the verdict alone.
  const serious = findings.some((f) => f.kind !== 'hedge' && f.kind !== 'rhythm')
  const leaning = (r: number | null): boolean => r !== null && r > HEDGE_RATIO_LIMIT
  return {
    findings,
    sentences: {
      tradition: traditionSentences,
      science: scienceSentences,
      total
    },
    hedges: { tradition: traditionHedges, science: scienceHedges },
    ratio,
    openings: { tradition: openTradition, science: openScience },
    openingHedges: { tradition: openTraditionHedged, science: openScienceHedged },
    openingRatio,
    hedgedTeaching: findings.filter((f) => f.kind === 'hedge' && f.tradition),
    flatStretches: findings.filter((f) => f.kind === 'rhythm'),
    placeholders: {
      findings: placeholderFindings,
      rate: placeholderRate,
      // Silent on a short piece, for the same reason the hedge ratio is: a
      // rate built from three sentences flags good prose, and a check that
      // does that gets switched off.
      overLimit: total >= MIN_PLACEHOLDER_SENTENCES && placeholderRate > PLACEHOLDER_OPENER_LIMIT
    },
    reading: readingOf(text),
    concreteness: concretenessOf(text),
    clean: !serious && !leaning(ratio) && !leaning(openingRatio)
  }
}
