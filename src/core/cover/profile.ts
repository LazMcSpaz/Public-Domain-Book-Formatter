/**
 * A banked cover look — the *collection*.
 *
 * The interior has this already (`@core/style/saved-profile`) and the reasoning
 * carries over unchanged, but the stakes are different in one way worth saying.
 * An interior's look is a quality the reader notices only if it is bad. A
 * cover's look is how a reader recognises that six books belong together on a
 * shelf, which is the entire mechanism by which a small press becomes a thing
 * people collect. Volume two matching volume one is not a saving of setup time
 * here; it is the product.
 *
 * The banking rule is the same and is enforced the same way: **if reusing it on
 * an unrelated book would be wrong, it is per-book content and does not belong
 * here.** The title, the blurb and the picture fail that test. The arrangement,
 * the palette, the faces and the ornament pass it. `BANKED_COVER_KEYS` is
 * checked against `CoverLook` in the tests, so adding a field to the look fails
 * the suite until somebody has decided which side of the line it is on.
 *
 * ## The series field is content, not look
 *
 * Tempting, since a collection *has* a name, and wrong: the same look is often
 * wanted for two different series (a press's whole list), and a banked series
 * name would print "Cornish Antiquaries" on a book about beekeeping. What is
 * banked is the *look*; the collection is named per book, and the interview
 * offers the last one used.
 *
 * Pure: no I/O.
 */
import { normalizeLook, type CoverLook } from './document'

export interface SavedCoverLook {
  id: string
  /** What the user called it, e.g. "Blackthorn plain covers". */
  name: string
  savedAt: string
  schemaVersion: number
  look: CoverLook
  /**
   * What the collection is for, in the user's own words.
   *
   * Not decoration: a shelf of banked looks a year later is a list of names
   * whose differences nobody remembers, and the difference between two of them
   * is usually a decision ("the ones with plates" / "the ones without") rather
   * than a visible property.
   */
  note: string
}

export const COVER_PROFILE_SCHEMA_VERSION = 1

export const BANKED_COVER_KEYS: readonly (keyof CoverLook)[] = [
  'arrangement',
  'palette',
  'titleFont',
  'authorFont',
  'bodyFont',
  'titleCase',
  'titleSizePt',
  'rule',
  'ornamentId',
  'spineText',
  'imprintOnFront',
  'announceWorks',
  'pressMark'
]

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function coverProfileId(now: string): string {
  return `cl-${now.replace(/[^0-9]/g, '')}-${Math.random().toString(36).slice(2, 8)}`
}

export function newSavedCoverLook(input: {
  name: string
  look: CoverLook
  note?: string
  /** Overwrite an existing look rather than banking a second one. */
  id?: string
  now?: Date
}): SavedCoverLook {
  const savedAt = (input.now ?? new Date()).toISOString()
  return {
    id: input.id ?? coverProfileId(savedAt),
    name: input.name.trim() || 'Untitled cover look',
    savedAt,
    schemaVersion: COVER_PROFILE_SCHEMA_VERSION,
    look: normalizeLook(input.look),
    note: (input.note ?? '').trim()
  }
}

/**
 * Read a stored look back.
 *
 * Forgiving, for the same asymmetry `migrateSavedProfile` describes: a look
 * that came back with one field at its default is visible in the preview and
 * one click from fixed, where refusing the record would lose the other ten to
 * protect the user from one they can see.
 */
export function migrateSavedCoverLook(raw: unknown): SavedCoverLook | null {
  if (!isRecord(raw)) return null
  const id = str(raw['id'], '')
  if (!id) return null
  return {
    id,
    name: str(raw['name'], 'Untitled cover look'),
    savedAt: str(raw['savedAt'], new Date(0).toISOString()),
    schemaVersion: COVER_PROFILE_SCHEMA_VERSION,
    look: normalizeLook(raw['look']),
    note: str(raw['note'], '')
  }
}

/** A one-line description, for the option that offers it. */
export function describeSavedCoverLook(p: SavedCoverLook): string {
  const parts = [p.look.arrangement.replace(/-/g, ' '), p.look.titleFont, p.look.palette.ground]
  if (p.note) parts.push(p.note)
  return parts.join(' · ')
}

/**
 * Apply a banked look to a cover, leaving every per-book fact alone.
 *
 * The signature is the promise: it takes a look and returns a look. Nothing
 * about the book can travel through it, so "use the collection's look" can
 * never overwrite this book's title — which is the accident the enforced key
 * list exists to prevent and this function exists not to need.
 */
export function applyCoverLook(banked: SavedCoverLook): CoverLook {
  return normalizeLook(banked.look)
}
