/**
 * The house look, read and laid out.
 *
 * The rules are core's (`@core/style` `house-look.ts`): a book's own design
 * answers win, a book with none inherits the house look, and a short book is
 * set on the short-book trim. This is where they meet the shelf and the
 * engine: `fetchHouseLook` reads the file through the shelf connection, and
 * `renderInLook` lays a book out in whichever look it gets, laying it out
 * again on the short-book trim when it turns out short, with the running heads
 * the house look gives a book of its structure (`houseHeadsForBook`).
 *
 * Browser-only. The driver reads the file off its own disk and hands the text
 * to `readHouseLook`; the app fetches it with `fetchHouseLook`.
 */
import type { BookDocument } from '@core/assemble'
import type { StyleProfile } from '@core/model'
import {
  houseDesignFor,
  houseHeadsForBook,
  houseLookLine,
  inheritDesign,
  parseHouseLook,
  type HouseLook,
  type LookSource
} from '@core/style'
import { HOUSE_LOOK_PATH, type ShelfConfig } from '@core/sync'
import { FRESH_LOOK } from '@core/wizard'
import type { Answers } from '@core/wizard/questions'
import { renderInterior, type Interior, type InteriorOptions } from './interior'
import { getText } from './shelf'

/** A house look as read from a file: the look, or why it cannot be used. */
export type HouseLookRead = { path: string; look: HouseLook } | { path: string; error: string }

/** The house look in `text`, read from `path`; null when there is no file. */
export function readHouseLook(path: string, text: string | null): HouseLookRead | null {
  if (text === null) return null
  const parsed = parseHouseLook(text)
  return 'look' in parsed ? { path, look: parsed.look } : { path, error: parsed.error }
}

/** The house look on the shelf, or null when the shelf has none. */
export async function fetchHouseLook(config: ShelfConfig): Promise<HouseLookRead | null> {
  return readHouseLook(HOUSE_LOOK_PATH, await getText(config, HOUSE_LOOK_PATH))
}

/** Why a house look on the shelf was not used, said in a sentence. */
export function houseLookRefusal(read: HouseLookRead | null): string | null {
  return read && 'error' in read
    ? `the house look at ${read.path} could not be used: ${read.error}`
    : null
}

/**
 * The house look's answers as a book keeps them: with `profile` set to a
 * fresh look, so a browser holding a banked look of its own builds exactly
 * these and not these laid over that.
 */
export function asBookDesign(design: Answers): Answers {
  return { ...design, profile: FRESH_LOOK }
}

export interface InLook {
  built: Interior
  profile: StyleProfile
  /**
   * The design answers it was laid out from, before any tweak; inherited ones
   * as a book keeps them (`asBookDesign`).
   */
  design: Answers
  from: LookSource
  /** How the house look was used, or why it could not be. Null when it played no part. */
  houseLine: string | null
  /**
   * The question for the owner about this book's running heads, when it
   * inherits the house look and its chapters open with lists of topics.
   */
  headsQuestion: string | null
}

/**
 * Lay a book out in the look it gets: its own answers, else the house look
 * (on the short-book trim when it prints short on the house trim), else the
 * defaults. `tweaks` go on top of whichever it is. `profileOf` turns design
 * answers into a style, the way the caller always does (`appliedLook`).
 */
export async function renderInLook(
  doc: BookDocument,
  input: {
    own: Answers | null | undefined
    house: HouseLookRead | null
    tweaks?: Answers
    profileOf: (design: Answers) => StyleProfile
    options: InteriorOptions
  }
): Promise<InLook> {
  const house = input.house && 'look' in input.house ? input.house : null
  const chosen = inheritDesign(input.own, house?.look ?? null)
  // The heads the house look gives a book of this structure. Furniture only:
  // they move no line and no page, so the page count below is the same.
  const heads = chosen.from === 'house' && house ? houseHeadsForBook(house.look, doc.blocks) : null
  const headed = (design: Answers): Answers => ({ ...design, ...(heads?.design ?? {}) })
  const headsQuestion = heads?.question ?? null
  const tweaks = input.tweaks ?? {}
  const profile = input.profileOf({ ...headed(chosen.design), ...tweaks })
  const built = await renderInterior(doc, profile, input.options)
  if (chosen.from !== 'house' || !house) {
    const houseLine = chosen.from === 'defaults' ? houseLookRefusal(input.house) : null
    return { built, profile, design: chosen.design, from: chosen.from, houseLine, headsQuestion }
  }
  const headsSaid = heads?.line ? `; ${heads.line}` : ''
  // A trim asked for by name is the trim: length decides nothing then.
  if (tweaks['trimSize'] !== undefined) {
    const houseLine = `the house look from the shelf (${house.path}), on the trim asked for${headsSaid}`
    const design = asBookDesign(headed(chosen.design))
    return { built, profile, design, from: 'house', houseLine, headsQuestion }
  }
  const pages = built.pageCount
  const { design, short } = houseDesignFor(house.look, pages)
  const houseLine = houseLookLine({
    look: house.look,
    path: house.path,
    pagesOnHouseTrim: pages,
    short,
    ...(heads?.line ? { heads: heads.line } : {})
  })
  const inherited = asBookDesign(headed(design))
  if (!short) return { built, profile, design: inherited, from: 'house', houseLine, headsQuestion }
  const shortProfile = input.profileOf({ ...headed(design), ...tweaks })
  return {
    built: await renderInterior(doc, shortProfile, input.options),
    profile: shortProfile,
    design: inherited,
    from: 'house',
    houseLine,
    headsQuestion
  }
}
