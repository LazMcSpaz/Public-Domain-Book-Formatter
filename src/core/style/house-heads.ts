/**
 * The house look's running heads, chosen by the book's structure.
 *
 * The owner's decision (19 November 2026), wired in like trim by length: a
 * book that inherits the house look (it has no design answers of its own)
 * gets the chapter title on the left page and the topic in force on the right
 * when it is descriptive, that is when at least half its chapters are divided
 * by subheadings in the text (`isDescriptive`). Any other book keeps the house
 * look's own heads, the author and the chapter.
 *
 * A book whose chapters open with a list of topics and have no subheadings is
 * not decided here: it keeps the house look's heads, and the question goes to
 * the owner, because no tool can know which pages a listed topic covers.
 *
 * A book's own design answers always win; this is asked only of a book that
 * inherits the house look (`inheritDesign`).
 */
import {
  chapterDivisions,
  divisionCounts,
  isDescriptive,
  opensWithTopicLists,
  type BookBlock,
  type DivisionCounts
} from '@core/assemble'
import type { Answers } from '@core/wizard/questions'
import type { HouseLook } from './house-look'

/** What the house look gives a book for its running heads. */
export interface HouseHeads {
  /** `topic` for a descriptive book; `house` keeps the look's own; `ask` keeps them and asks. */
  verdict: 'topic' | 'house' | 'ask'
  /** Answers laid over the house look's: the topic rule's for a descriptive book, else none. */
  design: Answers
  counts: DivisionCounts
  /** Which heads, and why, for the house look's line; empty when the look has no topic rule. */
  line: string
  /** The question for the owner, for a book whose chapters open with lists of topics. */
  question: string | null
}

const of = (n: number, total: number): string => `${n} of ${total} chapter${total === 1 ? '' : 's'}`

/** The running heads the house look gives a book of this structure. */
export function houseHeadsFor(look: HouseLook, counts: DivisionCounts): HouseHeads {
  const rule = look.topicHeads
  if (!rule) return { verdict: 'house', design: {}, counts, line: '', question: null }
  const divided = `${of(counts.divided, counts.counted)} divided by subheadings`
  if (isDescriptive(counts, rule.atLeast)) {
    return {
      verdict: 'topic',
      design: rule.design,
      counts,
      line: `chapter and topic running heads (${divided})`,
      question: null
    }
  }
  if (opensWithTopicLists(counts, rule.atLeast)) {
    const listed = `${of(counts.listed, counts.counted)} open with a list of topics and have no subheadings`
    return {
      verdict: 'ask',
      design: {},
      counts,
      line: `the house look's running heads until the owner decides (${listed})`,
      question:
        `${listed}. Ask the owner, with a chapter opening in front of him, whether this ` +
        'book keeps its author and chapter running heads, or whether he will say where each ' +
        'listed topic begins, so it can be set as a subheading and the book given chapter and ' +
        'topic heads. The tools never guess which pages a listed topic covers. Record his ' +
        'answer in the ledger and write the heads he chose into the book (docs/process/export.md).'
    }
  }
  return {
    verdict: 'house',
    design: {},
    counts,
    line:
      counts.counted === 0
        ? "the house look's running heads (no chapter has text of its own)"
        : `the house look's running heads (${divided}, under ${shareWords(rule.atLeast)})`,
    question: null
  }
}

/** The running heads the house look gives this book, read from its blocks. */
export function houseHeadsForBook(look: HouseLook, blocks: readonly BookBlock[]): HouseHeads {
  return houseHeadsFor(look, divisionCounts(chapterDivisions(blocks)))
}

/** A share said in words: "half", else a percentage. */
function shareWords(share: number): string {
  return share === 0.5 ? 'half' : `${Math.round(share * 100)}%`
}
