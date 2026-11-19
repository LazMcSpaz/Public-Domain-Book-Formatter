/**
 * Topic running heads: the subheading in force on a page, for a book whose
 * chapters are divided by subheadings in the text.
 *
 * **The rule for a page.** The first topic that starts on the page; else the
 * topic in force when the page began, carried from an earlier page; else,
 * before the chapter's first topic, the chapter title. Topics reset at every
 * chapter. This is the usual book convention (and LaTeX's right mark): the
 * head names what a reader turning to the page will find begun there, and a
 * page that begins none goes on naming the one it continues.
 *
 * Which headings are topics is `chapterDivisions`' (`@core/assemble`): in
 * each chapter, the shallowest level that divides its text.
 *
 * **Long heads.** A head is never let into the margin: `fitRunningHead`
 * shortens it as it shortens a long chapter title. In a book with topic heads
 * every shortened head is reported in `headsShortened`, once per head with the
 * pages it falls on, and the readiness check puts the list to a person. It is
 * not a layout warning: nothing in the book can give a head a short form yet,
 * so a warning could never be cleared, and the readiness check needs
 * `warnings: 0`. A head the book tidies (`head-tidy.ts`) is judged by what it
 * says once tidied, so a full stop or a part label dropped is not a cut.
 * Books with no topic head are not reported on, so a published book's layout
 * and report stay exactly as they were.
 *
 * Pure: the page builder calls these as headings are set.
 */
import type { StyleProfile } from '@core/model'
import type { ShortenedHead } from './types'

/** What a page knows of the topics, for its running head. */
export interface PageTopics {
  /** The topic in force when the page began, carried from an earlier page. */
  carried: string | null
  /** The first topic that starts on this page. */
  first: string | null
  /** The topic in force at the page's foot: what the next page carries. */
  last: string | null
}

/** A page before any topic. */
export const NO_TOPICS: PageTopics = { carried: null, first: null, last: null }

/** Whether either side's running head shows the topic. */
export function usesTopicHeads(profile: StyleProfile): boolean {
  return profile.runningHeads.verso === 'topic' || profile.runningHeads.recto === 'topic'
}

/** A new page's topics: it begins with the one the page before ended on. */
export function topicsOnNewPage(previous: PageTopics | undefined): PageTopics {
  const last = previous?.last ?? null
  return { carried: last, first: null, last }
}

/**
 * The topics after a heading is set on the page: a chapter clears them, a
 * topic starts one (the page's first if it has none yet), any other heading
 * leaves them as they were.
 */
export function topicsAfterHeading(
  topics: PageTopics,
  heading: { title: string; level: number; isTopic: boolean }
): PageTopics {
  if (heading.level === 1) return NO_TOPICS
  if (!heading.isTopic) return topics
  return { ...topics, first: topics.first ?? heading.title, last: heading.title }
}

/** The topic a page's head names, or null before the chapter's first. */
export function topicShown(topics: PageTopics): string | null {
  return topics.first ?? topics.carried
}

/** The topic a page's head shows, or the chapter title before the chapter's first. */
export function topicHead(topics: PageTopics, chapterTitle: string): string {
  return topicShown(topics) ?? chapterTitle
}

/**
 * Whether a head was set shorter than the text it was given. Shortening only
 * drops words and adds an ellipsis; capitals set for a face without small
 * capitals are not a change.
 */
export function wasShortened(text: string, drawn: string): boolean {
  return drawn.toLocaleUpperCase() !== text.trim().toLocaleUpperCase()
}

/** Collects the heads set shorter than their text, once per head. */
export function shortenedHeadLog(): {
  note: (pageIndex: number, text: string, drawn: string) => void
  heads: () => ShortenedHead[]
} {
  const byText = new Map<string, ShortenedHead>()
  return {
    note(pageIndex, text, drawn) {
      if (!wasShortened(text, drawn)) return
      const key = text.trim()
      const seen = byText.get(key)
      if (seen) seen.pageIndexes.push(pageIndex)
      else byText.set(key, { text: key, setAs: drawn, pageIndexes: [pageIndex] })
    },
    heads: () => [...byText.values()]
  }
}
