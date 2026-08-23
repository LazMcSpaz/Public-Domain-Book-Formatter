/**
 * The editor's voice — who is speaking in the notes, and how.
 *
 * A public-domain reprint has to carry something of its editor's to be worth
 * publishing, and notes are the cheapest honest way to add it. The app can
 * already *place* an editor's note: anchored to a point in a block, renumbered
 * through the book, collected as an endnote when it cannot be set at the foot of
 * a page. What it could not do was help write one, so the feature had exactly
 * one user — a person typing into a textarea.
 *
 * ## Why a voice card rather than a fine-tune
 *
 * There is no training pipeline here and there should not be: the key is the
 * user's, the call goes straight to the API, and there is no server to hold a
 * fine-tune even if the corpus were large enough to justify one — which, for a
 * few hundred notes, it is not. What does work, and works well, is a persona
 * card plus a handful of exemplars carried in the prompt.
 *
 * The exemplars are the part that gets better over time. A note the user
 * *accepts* is evidence of the voice they actually want, as opposed to the one
 * they described, so accepted notes are offered back as exemplars and the voice
 * converges on approved work rather than on a guess. That is the closest thing
 * to training available here, and for a corpus this size it is the better tool.
 *
 * ## What is banked and what is not
 *
 * Same rule as the style profile: if reusing it on an unrelated book would be
 * wrong, it is per-book and does not belong here. The pen name, the register,
 * the length and the exemplars all pass — an editor's voice is the same editor
 * on every book they put out. Anything about *this* book's subject does not, and
 * is passed to the pass as context instead.
 *
 * Pure: no I/O.
 */

/** What kind of thing earns a note. */
export type AnnotationKind =
  /** A word the book uses that a reader today would not. */
  | 'archaic-word'
  /** Someone named in passing whom the reader is assumed to know. */
  | 'person'
  /** A place, or a place whose name has changed. */
  | 'place'
  /** Money, weights, distances — anything whose size no longer means anything. */
  | 'measure'
  /** Science, medicine or technology the book takes for granted and we do not. */
  | 'obsolete-science'
  /** A quotation or allusion the book expects the reader to catch. */
  | 'allusion'
  /** What was going on around the book that makes a passage make sense. */
  | 'context'
  /**
   * An idea the passage turns on that is genuinely hard, explained properly.
   *
   * The one kind that is allowed to run long, because a difficult concept
   * explained in half a sentence has not been explained.
   */
  | 'concept'

export const ANNOTATION_KINDS: readonly AnnotationKind[] = [
  'archaic-word',
  'person',
  'place',
  'measure',
  'obsolete-science',
  'allusion',
  'context',
  'concept'
]

/** How freely notes are offered. */
export type NoteDensity = 'sparing' | 'balanced' | 'generous'

/**
 * Roughly how many notes a thousand words should attract.
 *
 * A rate rather than a count, because the alternative — "about forty notes for
 * this book" — makes a long book thinly annotated and a short one smothered.
 * These are targets for the prompt, not quotas: a chapter with nothing to
 * explain should produce nothing, which the rules say in as many words.
 */
export const NOTES_PER_THOUSAND_WORDS: Record<NoteDensity, number> = {
  sparing: 1,
  balanced: 2.5,
  generous: 5
}

/** A note the user accepted, kept to teach the voice. */
export interface VoiceExemplar {
  /** The words from the book the note hangs on. */
  passage: string
  /** The note as it was accepted — after any edit the user made to it. */
  note: string
}

/**
 * How many exemplars ride along in the prompt.
 *
 * Enough to establish a voice, few enough that they do not crowd out the book.
 * Past about half a dozen the marginal example teaches nothing the first six
 * did not, and every one of them is paid for on every chunk of every book.
 */
export const MAX_EXEMPLARS = 6

export interface EditorVoice {
  /** The name the notes are signed with, e.g. a pen name. */
  penName: string
  /** Who the editor is, in the editor's own terms. Shapes the voice; optional. */
  about: string
  density: NoteDensity
  /** Which kinds of thing earn a note. */
  kinds: AnnotationKind[]
  /** How long an ordinary note runs, in words. */
  maxWords: number
  /** Anything else the user wants the editor to do or avoid, in plain words. */
  guidance: string
  /**
   * What this editor refuses to do, one refusal to a line.
   *
   * Separate from `guidance` because a voice is as much what it will not say as
   * what it will, and the two behave differently in a prompt: an instruction
   * competes with the other instructions for attention, while a prohibition
   * only has to be recognised. Kept as a list rather than a paragraph so that
   * one can be added the moment it is noticed — which is how they are actually
   * discovered, by reading a note and disliking one thing about it.
   */
  avoid: string[]
  exemplars: VoiceExemplar[]
}

/**
 * Every field an `EditorVoice` may carry, and the tripwire for what banks.
 *
 * The same device as `BANKED_STYLE_KEYS`, for the same reason and against the
 * same accident. This file has always *said* that a voice is the same editor on
 * every book and that anything about one book's subject does not belong in it;
 * nothing enforced it, so the claim survived only as long as whoever added a
 * field happened to read the comment. The test checks this list against the
 * type, so adding a field now fails until somebody has decided.
 *
 * Everything here banks. That is not laziness — it is what the type is for. A
 * field that should *not* travel to the next book does not belong on the voice
 * at all; it belongs in the per-book context the pass is given.
 */
export const VOICE_KEYS: readonly (keyof EditorVoice)[] = [
  'penName',
  'about',
  'density',
  'kinds',
  'maxWords',
  'guidance',
  'avoid',
  'exemplars'
]

/**
 * The default editor: well-informed, and determined to be understood.
 *
 * These rules are the substance of the feature. A model asked for "footnotes"
 * with no further instruction writes an encyclopaedia entry — flat, hedged,
 * padded, and in the register of a journal article, which is the register that
 * makes readers stop reading footnotes. Every line below is aimed at one of the
 * specific ways that goes wrong.
 */
export function defaultVoice(): EditorVoice {
  return {
    penName: '',
    about: '',
    density: 'balanced',
    kinds: [...ANNOTATION_KINDS],
    maxWords: 45,
    guidance: '',
    avoid: [],
    exemplars: []
  }
}

/**
 * The house rules, which are not the user's to get wrong.
 *
 * Separate from `EditorVoice` because these are what make a note *good* rather
 * than what makes it this editor's. The user tunes the dials above; this is the
 * craft underneath, and it ships the same for everyone.
 */
const HOUSE_RULES: readonly string[] = [
  `Write for a curious general reader, not for a specialist. Assume intelligence`,
  `and no background.`,
  `Explain, don't just define. "A chirurgeon was a surgeon" helps nobody; what`,
  `helps is that surgery was then a manual trade ranked below physic, which is`,
  `why the author treats the man as a craftsman.`,
  `Use plain modern English. No "cf.", no "q.v.", no "the present editor", no`,
  `"it is worth noting that". If a sentence sounds like a journal article,`,
  `rewrite it as you would say it aloud.`,
  `Be brief. One or two sentences is the normal length. Take three when the idea`,
  `genuinely needs three, and stop the moment the point has landed.`,
  `A light touch of personality is welcome — a dry aside, a note of real`,
  `enthusiasm — as long as it never costs the reader clarity. Never make a joke`,
  `at the author's expense.`,
  `Be honest about uncertainty, in plain words: "probably", "no one is sure",`,
  `"the records disagree". Never state a date, a name, a quantity or an`,
  `attribution you are not confident of. A note the reader cannot trust is worse`,
  `than no note.`,
  `Don't explain what the passage already makes clear, and don't restate the`,
  `sentence you are annotating.`,
  `Don't moralize about the past, and don't apologize for the author.`,
  `Never pad to reach a number. A chapter with nothing worth explaining should`,
  `produce no notes at all.`
]

/**
 * The voice as an instruction, for the cached half of the prompt.
 *
 * Built here rather than in `prompt.ts` so that the voice — the thing the user
 * banks, tunes and carries between books — has one definition and one rendering.
 */
export function voiceBlock(voice: EditorVoice): string {
  const parts: string[] = []

  parts.push(`YOU ARE THE EDITOR OF THIS EDITION.`)
  if (voice.penName.trim()) {
    parts.push(
      `The notes appear over the name ${voice.penName.trim()}. They are that`,
      `editor's own words, and that editor's reputation rides on them.`
    )
  }
  if (voice.about.trim()) parts.push(``, `ABOUT THE EDITOR:`, voice.about.trim())

  parts.push(``, `HOW THE NOTES READ:`, ...HOUSE_RULES)
  parts.push(
    ``,
    `Keep an ordinary note to about ${voice.maxWords} words. A note explaining a`,
    `genuinely difficult idea may run longer; nothing else may.`
  )

  parts.push(
    ``,
    `WHAT EARNS A NOTE:`,
    ...voice.kinds.map((kind) => `- ${KIND_GUIDANCE[kind]}`),
    `Aim for roughly ${NOTES_PER_THOUSAND_WORDS[voice.density]} note${
      NOTES_PER_THOUSAND_WORDS[voice.density] === 1 ? '' : 's'
    } per thousand words of the book, as a target and not a quota.`
  )

  if (voice.guidance.trim()) {
    parts.push(``, `THE EDITOR ALSO ASKS:`, voice.guidance.trim())
  }

  // Last before the exemplars, and phrased as refusals rather than as more
  // advice: these are the lines this editor has actually struck out of a note,
  // and they are worth more than anything above them because each one was
  // learned from something that came back wrong.
  const avoid = voice.avoid.map((line) => line.trim()).filter((line) => line.length > 0)
  if (avoid.length > 0) {
    parts.push(``, `WHAT THIS EDITOR NEVER DOES:`, ...avoid.map((line) => `- ${line}`))
  }

  const exemplars = voice.exemplars.slice(-MAX_EXEMPLARS)
  if (exemplars.length > 0) {
    parts.push(
      ``,
      `NOTES THIS EDITOR HAS ALREADY APPROVED.`,
      `These are the voice. Match their register, their length and their manner`,
      `of explaining — not their subject matter:`
    )
    for (const ex of exemplars) {
      parts.push(``, `Passage: ${ex.passage.trim()}`, `Note: ${ex.note.trim()}`)
    }
  }

  return parts.join('\n')
}

const KIND_GUIDANCE: Record<AnnotationKind, string> = {
  'archaic-word': `A word the book uses in a sense it has lost, where guessing from context would mislead.`,
  person: `A person named as though the reader knows them, who now needs an introduction.`,
  place: `A place the reader cannot picture, or one whose name or country has changed.`,
  measure: `Money, weights, distances and dates whose size no longer means anything — give the reader something to compare it to.`,
  'obsolete-science': `Science, medicine or technology the book takes as settled and we do not. Say what was believed and why it was reasonable to believe it.`,
  allusion: `A quotation or allusion the book expects the reader to catch.`,
  context: `What was happening around the book that makes a passage make sense.`,
  concept: `An idea the passage turns on that is genuinely hard. This is the one note allowed to take its time.`
}

/**
 * Add an accepted note to the voice's exemplars, keeping the newest few.
 *
 * Newest rather than best because the user's taste is revealed by what they
 * have most recently approved, and because "best" would need a judge — which
 * would be the model rating its own output, the one thing this codebase never
 * does.
 */
export function withExemplar(voice: EditorVoice, exemplar: VoiceExemplar): EditorVoice {
  const passage = exemplar.passage.trim()
  const note = exemplar.note.trim()
  if (!note) return voice
  // The same note accepted twice teaches nothing the first time did not.
  const kept = voice.exemplars.filter((e) => e.note.trim() !== note)
  return { ...voice, exemplars: [...kept, { passage, note }].slice(-MAX_EXEMPLARS) }
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Read a stored voice back, backfilling anything missing.
 *
 * Forgiving for the same reason `migrateSavedProfile` is: a voice restored with
 * a default density is a dial in the wrong position, which the user can see at
 * the gate and fix in one click. Refusing the record would throw away the pen
 * name and the exemplars to protect them from that.
 */
export function normalizeVoice(raw: unknown): EditorVoice {
  const base = defaultVoice()
  if (!isRecord(raw)) return base

  const kinds = Array.isArray(raw['kinds'])
    ? raw['kinds'].filter((k): k is AnnotationKind =>
        ANNOTATION_KINDS.includes(k as AnnotationKind)
      )
    : base.kinds
  const density = raw['density']
  const maxWords = raw['maxWords']

  const exemplars = Array.isArray(raw['exemplars'])
    ? raw['exemplars']
        .filter(isRecord)
        .map((e) => ({ passage: str(e['passage'], ''), note: str(e['note'], '') }))
        .filter((e) => e.note.trim().length > 0)
        .slice(-MAX_EXEMPLARS)
    : []

  return {
    penName: str(raw['penName'], base.penName),
    about: str(raw['about'], base.about),
    density:
      density === 'sparing' || density === 'balanced' || density === 'generous'
        ? density
        : base.density,
    // An empty list would mean "annotate nothing", which nobody chooses on
    // purpose and which would make the pass cost money and return silence.
    kinds: kinds.length > 0 ? kinds : base.kinds,
    maxWords:
      typeof maxWords === 'number' && Number.isFinite(maxWords)
        ? Math.min(120, Math.max(10, Math.round(maxWords)))
        : base.maxWords,
    guidance: str(raw['guidance'], base.guidance),
    avoid: Array.isArray(raw['avoid'])
      ? raw['avoid'].map((line) => str(line, '')).filter((line) => line.trim().length > 0)
      : base.avoid,
    exemplars
  }
}
