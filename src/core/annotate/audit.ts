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

/** Phrasing the house rules and the voice card rule out. */
const BANNED = [
  'fascinating',
  'intriguing',
  'curiously',
  'it is worth noting',
  'worth noticing',
  'the present editor',
  'cf.',
  'q.v.'
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
const DASH = /\u2014|\s\u2013\s/gu

/**
 * How many sentences of each kind are needed before a ratio is reported.
 *
 * Below this the number is noise. Same reasoning as the quorums in
 * `verify-book.ts`: a check that fires on a short passage is a check somebody
 * learns to ignore.
 */
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

export type BiasKind = 'dismissal' | 'banned' | 'hedge' | 'dash'

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
  clean: boolean
}

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
export function auditProse(text: string): ProseAudit {
  const findings: BiasFinding[] = []
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
      for (const match of sentence.match(DASH) ?? []) {
        findings.push({ kind: 'dash', match, sentence })
      }
    }
  }

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

  const serious = findings.some((f) => f.kind !== 'hedge')
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
    reading: readingOf(text),
    clean: !serious && !leaning(ratio) && !leaning(openingRatio)
  }
}
