/**
 * The house look: the design every new book starts from, kept on the shelf.
 *
 * A banked look used to live in one browser (`saved-profile.ts`), so a book
 * opened on a machine that had never seen one was set in the shipped defaults,
 * and nothing said so loudly enough. The house look is a file on the shelf
 * instead (`HOUSE_LOOK_PATH` in `@core/sync/shelf`), read by the driver's
 * `proof` and by the app's design gate.
 *
 * It holds design answers: the same ids, the same values, as a book file's
 * `answers.design`. So the house look is built by exactly the code that builds
 * every book's look (`appliedLook`), and a book that inherits it can keep it
 * by having those answers written into its own file.
 *
 * Three rules, each pure and tested:
 *
 * - **A book's own answers always win.** A book with any design answer of its
 *   own uses only its own; the house look fills in for a book with none. So a
 *   book already published can never change because the house look did.
 * - **Trim by length.** A book that would print under `underPages` pages on
 *   the house trim is set on the short-book trim instead (`trimForLength`).
 * - **A house look that cannot be read is said to be unreadable,** with the
 *   reason, never quietly replaced by the defaults.
 */
import type { AnswerValue, Answers } from '@core/wizard/questions'
import { defaultStyleProfile } from './defaults'
import { styleQuestions } from './editable'

/** The file format's version. A later one is refused, not half read. */
export const HOUSE_LOOK_VERSION = 1

/** The page count under which a book is a short book. */
export const SHORT_BOOK_PAGES = 100

/** The house trim and the short-book trim the owner settled on. */
export const HOUSE_TRIM = '7x10'
export const SHORT_BOOK_TRIM = '6x9'

/** How a short book differs from the house look. */
export interface ShortBookRule {
  /** A book that prints fewer pages than this on the house trim is short. */
  underPages: number
  /** Design answers laid over the house look's for a short book. */
  design: Answers
}

export interface HouseLook {
  name: string
  /** Design answers, exactly as a book file keeps them. */
  design: Answers
  /** Null when the house look sets every book alike, whatever its length. */
  shortBook: ShortBookRule | null
}

/** Where a book's look came from. */
export type LookSource = 'book' | 'house' | 'defaults'

/** The rule when a house look names none: under 100 pages, set 6x9. */
export const DEFAULT_SHORT_BOOK: ShortBookRule = {
  underPages: SHORT_BOOK_PAGES,
  design: { trimSize: SHORT_BOOK_TRIM }
}

/** The design interview's own ids (`wizard/steps.ts`), which style cannot import. */
const INTERVIEW_IDS = ['kind', 'period', 'font', 'chapterOpener', 'runningHeads']

/**
 * Every id a house look may set: the interview's and the detailed controls'.
 * Not `profile`, which names a look banked in one browser, nor `saveAs`.
 */
function knownIds(): Set<string> {
  const detailed = styleQuestions(defaultStyleProfile(), { hasSynopses: true }).map((q) => q.id)
  return new Set([...INTERVIEW_IDS, ...detailed])
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Design answers read from a file, or the reason they cannot be used. */
function readDesign(raw: unknown, where: string): Answers | string {
  if (!isRecord(raw)) return `${where} is not a set of design answers`
  const known = knownIds()
  const unknown = Object.keys(raw).filter((id) => !known.has(id))
  if (unknown.length > 0) {
    return `${where} names settings no question has: ${unknown.join(', ')}`
  }
  const out: Answers = {}
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return `${where}: \`${id}\` is not a plain value`
    }
    out[id] = value as AnswerValue
  }
  return out
}

/**
 * Read a house look file. Strict, unlike a banked look: the house look decides
 * how every new book is set, so a file that cannot be read whole is refused
 * with the reason, and the caller says so.
 */
export function parseHouseLook(text: string): { look: HouseLook } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/u, ''))
  } catch {
    return { error: 'it is not JSON' }
  }
  if (!isRecord(raw)) return { error: 'it is not a house look' }
  const version = raw['version']
  if (version !== HOUSE_LOOK_VERSION) {
    return {
      error:
        typeof version === 'number' && version > HOUSE_LOOK_VERSION
          ? `it is version ${version}, newer than these tools read (${HOUSE_LOOK_VERSION})`
          : version === undefined
            ? `it has no \`version\`: ${HOUSE_LOOK_VERSION}`
            : `its \`version\` is ${JSON.stringify(version)}, not ${HOUSE_LOOK_VERSION}`
    }
  }
  const design = readDesign(raw['design'], '`design`')
  if (typeof design === 'string') return { error: design }
  if (Object.keys(design).length === 0) return { error: '`design` sets nothing' }

  let shortBook: ShortBookRule | null = DEFAULT_SHORT_BOOK
  if (raw['shortBook'] === null) shortBook = null
  else if (raw['shortBook'] !== undefined) {
    const rule = raw['shortBook']
    if (!isRecord(rule)) return { error: '`shortBook` is not a rule' }
    const under = rule['underPages']
    if (typeof under !== 'number' || !Number.isInteger(under) || under < 1) {
      return { error: '`shortBook.underPages` is not a whole number of pages' }
    }
    const short = readDesign(rule['design'] ?? {}, '`shortBook.design`')
    if (typeof short === 'string') return { error: short }
    // A short book's trim is written in when the rule names none, so it is
    // laid out on the trim the report names, never on the engine's default.
    shortBook = { underPages: under, design: { trimSize: SHORT_BOOK_TRIM, ...short } }
  }
  const name = typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'].trim() : ''
  // Likewise the house trim: a file that names none is still laid out, measured
  // and reported on 7x10, never on the engine's own default (6x9).
  return {
    look: { name: name || 'The house look', design: { trimSize: HOUSE_TRIM, ...design }, shortBook }
  }
}

/**
 * Whether a book's design answers hold anything of its own. Which banked look
 * was picked (`profile`) and the name to bank one under (`saveAs`) are not a
 * design: a book holding only those still inherits the house look.
 */
export function hasOwnDesign(design: Answers | null | undefined): boolean {
  if (!design) return false
  return Object.entries(design).some(
    ([id, v]) => id !== 'profile' && id !== 'saveAs' && v !== undefined && v !== null && v !== ''
  )
}

/**
 * The design answers a book is set from, and where they came from. A book's
 * own answers always win; a book with none inherits the house look's; with
 * neither, the defaults (an empty set of answers).
 */
export function inheritDesign(
  own: Answers | null | undefined,
  house: HouseLook | null
): { from: LookSource; design: Answers } {
  if (own && hasOwnDesign(own)) return { from: 'book', design: own }
  if (house) return { from: 'house', design: house.design }
  return { from: 'defaults', design: {} }
}

/**
 * The trim-by-length rule: whether a book that prints `pagesOnLongTrim` pages
 * on the long trim is a short book. The threshold is a parameter; the owner's
 * is 100 pages.
 */
export function isShortBook(pagesOnLongTrim: number, underPages = SHORT_BOOK_PAGES): boolean {
  return pagesOnLongTrim < underPages
}

/**
 * Trim by length: a book that would print under 100 pages at 7x10 is set 6x9.
 * The threshold and both trims can be given.
 */
export function trimForLength(
  pagesOnLongTrim: number,
  rule: { underPages?: number; long?: string; short?: string } = {}
): string {
  return isShortBook(pagesOnLongTrim, rule.underPages)
    ? (rule.short ?? SHORT_BOOK_TRIM)
    : (rule.long ?? HOUSE_TRIM)
}

/**
 * The house look's answers for a book that prints `pagesOnHouseTrim` pages in
 * the house look itself: the house look, with the short-book answers laid over
 * it when the book is short.
 */
export function houseDesignFor(
  look: HouseLook,
  pagesOnHouseTrim: number
): { design: Answers; short: boolean } {
  const rule = look.shortBook
  if (!rule || !isShortBook(pagesOnHouseTrim, rule.underPages)) {
    return { design: look.design, short: false }
  }
  return { design: { ...look.design, ...rule.design }, short: true }
}

/** One line saying a book is set in the house look, and on which trim and why. */
export function houseLookLine(input: {
  look: HouseLook
  path: string
  pagesOnHouseTrim: number
  short: boolean
}): string {
  const { look, path, pagesOnHouseTrim, short } = input
  const long = String(look.design['trimSize'] ?? HOUSE_TRIM)
  const where = `the house look from the shelf (${path})`
  if (!look.shortBook) return `${where}: ${long}, ${pagesOnHouseTrim} pages`
  const trim = short ? String(look.shortBook.design['trimSize'] ?? long) : long
  return short
    ? `${where}: ${trim}, a short book (${pagesOnHouseTrim} pages on ${long}, under ${look.shortBook.underPages})`
    : `${where}: ${trim}, ${pagesOnHouseTrim} pages`
}
