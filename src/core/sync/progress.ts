/**
 * How far along a book on the shelf is, read off its catalogue card.
 *
 * The intake screen tints each card from maroon (nothing done) to green
 * (done), and says in one line what has been done and what is left. Both are
 * derived here, from the card alone, so the screen and the sentence cannot
 * disagree — and so the rule can be tested without a browser.
 *
 * The stages are the order the work is done in: a book is read, then the
 * readers' queries are ruled on, then it is done. Reading is most of the
 * work, and the fraction says so: it fills to 0.7 as the leaves are read, and
 * the last 0.3 as the queries close.
 *
 * What a card does not know is said, never guessed. A card written before
 * queries were counted has `queries: null`, and a book with such a card is
 * "read" at most — the sentence says the queries are not counted, and the
 * fraction stops at 0.7, because a green card over decisions nobody has
 * looked at is the one report this screen must never make.
 *
 * Pure: no DOM, no I/O.
 */
import type { ShelfAbout } from './shelf'

export type ShelfStage = 'unread' | 'reading' | 'deciding' | 'done'

export interface ShelfProgress {
  stage: ShelfStage
  /** 0 for a book not started, 1 for one whose reading and decisions are done. */
  fraction: number
  /** One line: what is done and what is left. */
  summary: string
}

const READING_SHARE = 0.7

export function shelfProgress(about: ShelfAbout): ShelfProgress {
  const leaves = Math.max(0, about.pageCount)
  // `complete` is the run's own word for the reading having reached the end,
  // and it outranks the count: a card from before `read` existed carries 0.
  const read = about.complete ? leaves : Math.min(leaves, Math.max(0, about.read))
  const isRead = about.complete || (leaves > 0 && read >= leaves)

  if (!isRead) {
    if (read === 0) {
      return { stage: 'unread', fraction: 0, summary: 'Not started.' }
    }
    const share = leaves > 0 ? read / leaves : 0
    return {
      stage: 'reading',
      fraction: READING_SHARE * share,
      summary: `Read to leaf ${read} of ${leaves}.`
    }
  }

  const q = about.queries
  if (q === null) {
    return {
      stage: 'deciding',
      fraction: READING_SHARE,
      summary: 'Read. Queries not counted on this card yet.'
    }
  }
  if (q.raised === 0) {
    return { stage: 'done', fraction: 1, summary: 'Read; no queries were raised.' }
  }
  if (q.waiting === 0) {
    return {
      stage: 'done',
      fraction: 1,
      summary: `Read; all ${q.raised} queries ruled on.`
    }
  }
  const ruled = q.raised - q.waiting
  const held = q.held > 0 ? `, ${q.held} of them held for approval` : ''
  return {
    stage: 'deciding',
    fraction: READING_SHARE + (1 - READING_SHARE) * (ruled / q.raised),
    summary: `Read; ${q.waiting} of ${q.raised} queries waiting${held}.`
  }
}

/**
 * A name to put on a card.
 *
 * The card carries no title of its own (the real one is settled at the export
 * gate, long after the card is first written), so the name is read off what
 * there is. The directory comes first: a person renamed it to be read, as
 * `Blavatsky-TheSecretDoctrineVolI-tup`, where the file under it is often a
 * SHA-256 and printed as sixty-four hex digits on a phone. Author, then the
 * title in capitals-run-together, then a short tag; the tag goes, and each
 * run of capitals is spaced out. A directory not in that shape (the computed
 * `isis-vol1-vjj34f`, starting lower case) is not guessed at, and the file
 * name is made readable instead: dashes and underscores become spaces and the
 * extension goes.
 */
export function shelfTitle(about: Pick<ShelfAbout, 'fileName' | 'dir'>): string {
  const { title, author } = shelfTitleParts(about)
  return author ? `${title} · ${author}` : title
}

/**
 * The same name as `shelfTitle`, with the title and the author kept apart, so
 * a card can set the title large and the author under it. `author` is null
 * when the directory does not name one — the file name is not guessed at.
 */
export function shelfTitleParts(about: Pick<ShelfAbout, 'fileName' | 'dir'>): {
  title: string
  author: string | null
} {
  const dir = about.dir ?? ''
  const parts = dir.split('-').filter(Boolean)
  if (parts.length >= 2 && /^[A-Z]/.test(parts[0])) {
    if (parts.length >= 3 && /^[a-z0-9]{3,8}$/.test(parts[parts.length - 1])) parts.pop()
    const spaced = (s: string) =>
      s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    const [author, ...title] = parts
    return { title: spaced(title.join(' ')), author: spaced(author) }
  }
  const title =
    about.fileName
      .replace(/\.(pdf|epub)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim() || about.fileName
  return { title, author: null }
}
