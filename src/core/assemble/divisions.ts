/**
 * How a book divides its chapters: the facts the running heads are chosen by.
 *
 * The owner's decision (19 November 2026): a book whose chapters are divided
 * by subheadings in the text gets the chapter title on the left page and the
 * topic in force on the right; any other book keeps the author on the left and
 * the chapter on the right. A book whose chapters only open with a list of
 * topics, and have no subheadings, is put to the owner as a question for that
 * book: no tool can know which pages a listed topic covers.
 *
 * Everything here reads the chapters `deriveChapters` makes (a run of headings
 * is one chapter); nothing re-derives them.
 *
 * **What divides a chapter.** A heading below the chapter's level that comes
 * after some of the chapter's text. A heading standing at the chapter's head
 * before any text (a byline, "Part One.", a title repeated under the number)
 * divides nothing, so it is never a topic.
 *
 * **Which level is the topic.** In each chapter, the shallowest level that
 * divides it. Most books divide a chapter with level-2 heads, and those are
 * its topics; the level-3 side heads under them are paragraph heads, too small
 * for a running head. A chapter whose only divisions are side heads has those
 * as its topics. Decided per chapter because the readings are uneven: one
 * chapter of a lecture series is divided by side heads, the next by section
 * heads with side heads under them.
 *
 * Pure: blocks in, facts out.
 */
import { deriveChapters, headingRunEnd, type BookBlock, type ChapterEntry } from './assemble-book'

/** The share of chapters that must be divided for a book to be descriptive. */
export const DESCRIPTIVE_SHARE = 0.5

/** Blocks a reader reads as the chapter's text, as against its headings and the matter round them. */
const TEXT_KINDS = new Set(['paragraph', 'blockquote', 'verse', 'list-item', 'table'])

/** Blocks that may stand between a chapter's title and a list of its topics. */
const QUOTATION_KINDS = new Set(['epigraph', 'blockquote', 'verse'])

/** What one chapter is made of. */
export interface ChapterDivision {
  /** The chapter's own entry (level 1). */
  chapter: ChapterEntry
  /** Whether it has any text of its own. A part title with none is not counted. */
  hasText: boolean
  /** The level its text is divided at, or null when nothing divides it. */
  topicLevel: number | null
  /** The headings that divide it at that level, in order: its topics. */
  topics: ChapterEntry[]
  /** Whether it opens with a list of topics under its title. */
  opensWithTopicList: boolean
}

/** A book's chapters, counted. */
export interface DivisionCounts {
  /** Chapters with text of their own. */
  counted: number
  /** Of those, the chapters divided by subheadings in the text. */
  divided: number
  /** Of those, the chapters that open with a list of topics and have no subheadings. */
  listed: number
}

/** Every chapter of the book, with what divides it. */
export function chapterDivisions(blocks: readonly BookBlock[]): ChapterDivision[] {
  const entries = deriveChapters(blocks)
  const out: ChapterDivision[] = []
  entries.forEach((chapter, k) => {
    if (chapter.level !== 1) return
    const nextChapter = entries.slice(k + 1).find((e) => e.level === 1)
    const end = nextChapter ? nextChapter.blockIndex : blocks.length
    const inside = entries.slice(k + 1).filter((e) => e.blockIndex < end)
    const isText = (i: number): boolean => TEXT_KINDS.has(blocks[i]?.kind ?? '')
    const textBefore = (index: number): boolean => {
      for (let i = chapter.blockIndex + 1; i < index; i++) if (isText(i)) return true
      return false
    }
    const dividers = inside.filter((e) => textBefore(e.blockIndex))
    const topicLevel = dividers.length > 0 ? Math.min(...dividers.map((e) => e.level)) : null
    out.push({
      chapter,
      hasText: textBefore(end),
      topicLevel,
      topics: dividers.filter((e) => e.level === topicLevel),
      opensWithTopicList: opensWithList(blocks, chapter.blockIndex + 1, end)
    })
  })
  return out
}

/**
 * Whether the opening of a chapter is a list of topics: the first block under
 * its title (headings under it skipped), or the second when the first is a
 * quotation set as a motto.
 */
function opensWithList(blocks: readonly BookBlock[], from: number, end: number): boolean {
  const opening: BookBlock[] = []
  for (let i = from; i < end && opening.length < 2; i++) {
    const block = blocks[i]!
    if (block.kind !== 'heading') opening.push(block)
  }
  const [first, second] = opening
  if (first && looksLikeTopicList(first.text)) return true
  return (
    first !== undefined &&
    QUOTATION_KINDS.has(first.kind) &&
    second !== undefined &&
    looksLikeTopicList(second.text)
  )
}

/** The fewest phrases that make a list of topics. Three short sentences can be prose. */
export const TOPIC_LIST_MIN = 4
/** The most words in one listed topic. */
const TOPIC_MAX_WORDS = 12
/** The most words a listed topic averages: prose averages far more between full stops. */
const TOPIC_MEAN_WORDS = 7

/**
 * Whether a block reads as a list of topics: "The Sacred Fire—The Vestal
 * Virgins—The Altar of the Persians—Fire as a Symbol." or the same with full
 * stops. At least four short phrases, each starting with a capital, each two
 * words or more (or one word of four letters or more, so initials, "Vol." and
 * numerals never count as a phrase); none over twelve words, seven on average;
 * nothing asked or exclaimed; not a quotation.
 *
 * A guess at a shape, never at meaning, and it only ever leads to a question
 * for the owner.
 */
export function looksLikeTopicList(text: string): boolean {
  const flat = text.replace(/\s+/gu, ' ').trim()
  if (!flat || /^[“"‘'«([]/u.test(flat) || /[?!]/u.test(flat)) return false
  const byDash = flat.split(/\s*(?:[—–]+|\s-\s)\s*/u)
  const raw = byDash.length >= TOPIC_LIST_MIN ? byDash : flat.split(/(?<=[.;])\s+(?=\p{Lu})/u)
  const phrases = raw.map((p) => p.replace(/[.;,:\s]+$/u, '').trim()).filter((p) => p.length > 0)
  if (phrases.length < TOPIC_LIST_MIN) return false
  const words = phrases.map((p) => p.split(' ').length)
  const isPhrase = (p: string, n: number): boolean =>
    /^\p{Lu}/u.test(p) && n <= TOPIC_MAX_WORDS && (n >= 2 || (p.match(/\p{L}/gu) ?? []).length >= 4)
  if (!phrases.every((p, i) => isPhrase(p, words[i]!))) return false
  return words.reduce((s, n) => s + n, 0) / words.length <= TOPIC_MEAN_WORDS
}

/** The chapters counted: with text, divided, and opening with a list of topics. */
export function divisionCounts(divisions: readonly ChapterDivision[]): DivisionCounts {
  const counted = divisions.filter((d) => d.hasText)
  return {
    counted: counted.length,
    divided: counted.filter((d) => d.topics.length > 0).length,
    listed: counted.filter((d) => d.topics.length === 0 && d.opensWithTopicList).length
  }
}

/**
 * Whether a book is descriptive: at least `share` of its chapters (half, the
 * owner's rule) are divided by subheadings in the text. A book with no chapter
 * of text is not.
 */
export function isDescriptive(counts: DivisionCounts, share = DESCRIPTIVE_SHARE): boolean {
  return counts.counted > 0 && counts.divided >= share * counts.counted
}

/**
 * Whether a book that is not descriptive opens at least `share` of its
 * chapters with a list of topics: a question for the owner, never a decision.
 */
export function opensWithTopicLists(counts: DivisionCounts, share = DESCRIPTIVE_SHARE): boolean {
  return (
    !isDescriptive(counts, share) && counts.listed > 0 && counts.listed >= share * counts.counted
  )
}

/**
 * The ids of every heading block that opens a topic, so a page can tell a
 * topic when one is set on it, whichever block of a run it is told about.
 */
export function topicHeadingIds(
  blocks: readonly BookBlock[],
  divisions: readonly ChapterDivision[] = chapterDivisions(blocks)
): Set<string> {
  const ids = new Set<string>()
  for (const d of divisions) {
    for (const topic of d.topics) {
      const end = headingRunEnd(blocks, topic.blockIndex)
      for (let i = topic.blockIndex; i <= end; i++) ids.add(blocks[i]!.id)
    }
  }
  return ids
}
