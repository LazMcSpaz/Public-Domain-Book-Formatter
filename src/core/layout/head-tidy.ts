/**
 * What a running head says, tidied, for a book whose look asks for it
 * (`runningHeadTidy`: the owner's decision of 19 November 2026, in the house
 * look only; every book set before keeps its heads exactly as they were).
 *
 * Two rules, each kept to where it reads right:
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

const NUMBER_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|' +
  'fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty'
/** A Roman numeral, never empty. */
const ROMAN = '(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})'

/**
 * "Part II." or "Part Six" and a dash (long, short or a hyphen), "Part 3:",
 * "Section IV. ", each with something after it.
 */
const PART_LABEL = new RegExp(
  `^(?:part|section)\\s+(?:${ROMAN}|\\d{1,3}|${NUMBER_WORDS})\\b` +
    `(?:\\s*\\.?\\s*(?:[\\u2014\\u2013]+|-{1,2}|:)\\s*|\\.\\s+)(?=[\\p{L}\\p{N}“"‘'(\\[])`,
  'iu'
)

/** Marks that close a quotation or a bracket, kept after a full stop goes. */
const CLOSING = /[”’"')\]»]*$/u

/** The last word before the stop is a run of initials: "J. K. L", "U.S.A". */
const INITIALS = /\p{Lu}\.\s?\p{Lu}$/u
/** Words always shortened, whose full stop is their own. */
const SHORTENED = /(?:^|[\s(,])(?:etc|viz|cf|ibid|jr|sr|esq|co|bros|ltd|inc|vol|vols)$/iu
/** A heading that is only a figure or a single letter: a number, not a sentence. */
const NUMERAL = /^(?:\d+|\p{L})$/u

/** The text with a leading part label taken off, or as it was when it has none. */
export function withoutPartLabel(text: string): string {
  const trimmed = text.trim()
  const label = PART_LABEL.exec(trimmed)
  return label ? trimmed.slice(label[0].length) : trimmed
}

/** The text with a final full stop taken off, where the stop ends a sentence. */
export function withoutFinalFullStop(text: string): string {
  const trimmed = text.trim()
  const closing = CLOSING.exec(trimmed)?.[0] ?? ''
  const body = trimmed.slice(0, trimmed.length - closing.length)
  if (!body.endsWith('.') || body.endsWith('..')) return trimmed
  const before = body.slice(0, -1).trimEnd()
  if (!before || INITIALS.test(before) || SHORTENED.test(before) || NUMERAL.test(before)) {
    return trimmed
  }
  return before + closing
}

/** A running head as a book that tidies its heads prints it. */
export function tidyRunningHead(text: string, opts: { topic: boolean }): string {
  return withoutFinalFullStop(opts.topic ? withoutPartLabel(text) : text)
}
