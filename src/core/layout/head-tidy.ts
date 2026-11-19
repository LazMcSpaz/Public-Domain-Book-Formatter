/**
 * What a running head says, tidied, for a book whose look asks for it
 * (`runningHeadTidy`: the owner's decision of 19 November 2026, in the house
 * look only; every book set before keeps its heads exactly as they were).
 *
 * Two rules, each kept to where it reads right, after any note reference mark
 * left at the end of the heading is taken off (a running head never carries one):
 *
 * - **A final full stop goes, on every head.** A heading set as a sentence
 *   ("What a Keeper Should Be.") is a name once it is in the head, and a name
 *   takes no full stop. A question mark or an exclamation mark is part of what
 *   the heading says and stays. Closing quotation marks and brackets stay too,
 *   and a full stop just inside them goes as well, so a quoted or bracketed
 *   heading reads as it would with the stop outside (“Of the Lamp.” prints
 *   “Of the Lamp”). A full stop that belongs to the last word stays: after a
 *   run of initials ("J. K. L."), after a word always shortened (etc., Jr.,
 *   Co.), after a heading that is only a figure or a letter ("3.", "A."),
 *   where it marks a number rather than a sentence, and in an ellipsis.
 * - **A topic drops a leading part label.** "Part II." and the dash after
 *   it go from "Part II." followed by "Of the Lamp", which prints "Of the
 *   Lamp": the right page names the topic a reader looks for, and the label
 *   only numbers it. The label is "Part" or "Section", a number
 *   (Roman, in figures, or a word up to twenty) and a separator: a dash, a
 *   colon, or a full stop and a space. A heading that is only a label
 *   ("Part II.", "PART TWO") is left whole, since nothing else would be left
 *   to print, and so is a label with no separator, where the number cannot be
 *   told from the words. Only a topic, as the owner ruled: a chapter title
 *   keeps a "Chapter X." and dash in front of it. Most books set a chapter's
 *   number on a line of its own, and the head already takes the title line
 *   alone.
 *
 * Pure: text in, text out.
 */

const UNITS = 'one|two|three|four|five|six|seven|eight|nine'
const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety'
/** A number in words up to ninety-nine, a hyphenated one ("Twenty-One") whole. */
const NUMBER_WORDS =
  `(?:${TENS})(?:-(?:${UNITS}))?|` +
  `${UNITS}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen`
/** A Roman numeral, never empty. */
const ROMAN = '(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})'

/**
 * "Part II." or "Part Six" and a dash (long or short, two hyphens, or one hyphen
 * with spaces round it, so the hyphen inside "Twenty-One" is never taken for
 * one), "Part 3:", "Section IV. ", each with something after it.
 */
const PART_LABEL = new RegExp(
  `^(?:part|section)\\s+(?:${ROMAN}|\\d{1,3}|${NUMBER_WORDS})\\b` +
    `(?:\\s*\\.?\\s*(?:[\\u2014\\u2013]+|--|:)\\s*|\\s*\\.?\\s+-\\s+|\\.\\s+)(?=[\\p{L}\\p{N}“"‘'(\\[])`,
  'iu'
)

/** Marks that close a quotation or a bracket, kept after a full stop goes. */
const CLOSING = /[”’"')\]»]*$/u

/** The last word before the stop is a run of initials: "J. K. L", "U.S.A". */
const INITIALS = /\p{Lu}\.\s?\p{Lu}$/u
/** Words always shortened, whose full stop is their own. */
const SHORTENED =
  /(?:^|[\s(,])(?:etc|&c|viz|cf|ibid|i\.e|e\.g|jr|sr|esq|co|bros|ltd|inc|vol|vols|cont|ed|eds|pp|mr|mrs|dr|mme|mlle)$/iu
/** A heading that is only a figure or a single letter: a number, not a sentence. */
const NUMERAL = /^(?:\d+|\p{L})$/u

/** What is left after a label that numbered a range ("Part I.–II.—"): another number and a dash. */
const RANGE_REST = new RegExp(`^(?:${ROMAN}|\\d{1,3})\\b\\.?\\s*[\\u2014\\u2013-]`, 'iu')

/** Note reference marks left at the end of a heading, which a running head never carries. */
const TRAILING_MARKS = /[\s\u00b9\u00b2\u00b3\u2070-\u2079*\u2020\u2021\u2016\u00b6]+$/u

/** The text with a leading part label taken off, or as it was when it has none. */
export function withoutPartLabel(text: string): string {
  const trimmed = text.trim()
  const label = PART_LABEL.exec(trimmed)
  if (!label) return trimmed
  const rest = trimmed.slice(label[0].length)
  // A label that numbers a range is not stripped: half of it would be left.
  return RANGE_REST.test(rest) ? trimmed : rest
}

/**
 * The text with note reference marks at its end taken off (¹, ², *, †, ‡ and
 * the like). Marks paired with a note are already gone from a heading; this
 * takes the ones that never paired. Only trailing ones: a leading § numbers a
 * section and stays.
 */
export function withoutNoteMarks(text: string): string {
  return text.trim().replace(TRAILING_MARKS, '')
}

/** The text with a final full stop taken off, where the stop ends a sentence. */
export function withoutFinalFullStop(text: string): string {
  const trimmed = text.trim()
  const closing = CLOSING.exec(trimmed)?.[0] ?? ''
  const body = trimmed.slice(0, trimmed.length - closing.length)
  // An ellipsis, typed close ("...") or spaced (". . ."), keeps every dot.
  if (!body.endsWith('.') || /\.\s?\.$/u.test(body)) return trimmed
  const before = body.slice(0, -1).trimEnd()
  if (!before || INITIALS.test(before) || SHORTENED.test(before) || NUMERAL.test(before)) {
    return trimmed
  }
  return before + closing
}

/** A running head as a book that tidies its heads prints it. */
export function tidyRunningHead(text: string, opts: { topic: boolean }): string {
  const unmarked = withoutNoteMarks(text)
  return withoutFinalFullStop(opts.topic ? withoutPartLabel(unmarked) : unmarked)
}
