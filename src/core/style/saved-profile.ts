/**
 * A banked look — the reusable half of SPEC §7's two-level separation.
 *
 * The problem this exists for is book two. The design gate interviews the user,
 * produces a `StyleProfile`, and until now threw it away when the tab closed, so
 * the second volume of a series started from the shipped defaults and got asked
 * the same five questions again. SPEC §7 is explicit that the *look* is banked
 * once and applied across books, and that setup time should drop sharply after
 * the first volume.
 *
 * What may be banked is decided by one rule: **if reusing it on an unrelated
 * book would be wrong, it is per-book config and does not belong here.** The
 * title, the author, the ISBN and the edition date fail that test and stay in
 * the export answers. The trim, the faces, the margins and the ornaments pass
 * it. So does the imprint's own identity — the publisher's name and the
 * copyright holder are facts about the *publisher*, constant across everything
 * they print, which is why SPEC §7 puts the copyright-page fill-ins "saved into
 * the profile" rather than in the per-book config.
 *
 * Pure: no I/O. The browser store is `@platform/browser/run-store`.
 */
import type { StyleProfile } from '@core/model'
import { normalizeStyleProfile } from './profile'

/**
 * The publisher's own details, reused on every book they put out (SPEC §7's
 * "fill-in fields, saved into the profile").
 *
 * Deliberately small. The edition statement is not here because it names the
 * original's year, the ISBN is not here because it is per-title, and the
 * publication date is not here because it is per-printing. Each of those would
 * be silently wrong on book two, which is the exact failure this module is
 * supposed to prevent.
 */
export interface ImprintFields {
  /** The imprint publishing this edition — not the original publisher. */
  imprint: string
  /** Who holds copyright in the new typesetting, notes and design. */
  copyrightHolder: string
  /** Whether the copyright page states that the original is public domain. */
  publicDomainNotice: boolean
  /**
   * Whether the copyright page states that this edition is annotated.
   *
   * Banked because it is a fact about the imprint rather than about the book:
   * a press that publishes annotated reprints publishes them annotated. The
   * *source* credit is deliberately not banked — it names where one particular
   * copy was scanned, and riding it onto book two would credit the wrong
   * library.
   */
  annotatedNotice: boolean
  /**
   * The line under the imprint on the title page.
   *
   * Banked for the same reason as the imprint itself: it says what the press
   * is for, and that does not change between books. The series line and the
   * motto above the *title* are deliberately not banked — those belong to the
   * original publisher of one particular book.
   */
  imprintLine: string
}

/** A look the user banked, with the publisher identity that goes with it. */
export interface SavedStyleProfile {
  id: string
  /** What the user called it, e.g. "The Blackthorn Press look". */
  name: string
  /** ISO timestamp of the last save. */
  savedAt: string
  schemaVersion: number
  style: StyleProfile
  imprint: ImprintFields
}

export const PROFILE_SCHEMA_VERSION = 1

/**
 * Every field a `StyleProfile` may carry.
 *
 * This list is the tripwire for the rule at the top of the file. `bankedKeys`
 * is checked against it in the tests, so adding a field to `StyleProfile`
 * fails until somebody has decided which of the two levels it belongs to. That
 * decision is easy to make deliberately and very easy to make by accident —
 * the accident being a `title` field that quietly rides a saved profile onto
 * the next book and prints the wrong name on its title page.
 */
export const BANKED_STYLE_KEYS: readonly (keyof StyleProfile)[] = [
  'id',
  'name',
  'trimSize',
  'margins',
  'gutter',
  'bodyFont',
  'bodyFontSize',
  'headingFont',
  'headingStyle',
  'runningHeads',
  'runningHeadStyle',
  'dropCap',
  'paragraphIndentEms',
  'paragraphSpacingEms',
  'hyphenate',
  'opticalMargins',
  'typographicQuotes',
  'chaptersOpenRecto',
  'pageNumber',
  'contentsSynopsis',
  'ornaments',
  'frontMatter'
]

export function emptyImprint(): ImprintFields {
  return {
    imprint: '',
    copyrightHolder: '',
    publicDomainNotice: true,
    annotatedNotice: false,
    imprintLine: ''
  }
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A fresh id, stable enough for a store keyed on it. */
function profileId(now: string): string {
  return `sp-${now.replace(/[^0-9]/g, '')}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Bank a look. `style` is copied through `normalizeStyleProfile`, so a profile
 * built by the interview and one hand-tweaked in a later session are stored in
 * the same complete shape.
 */
export function newSavedProfile(input: {
  name: string
  style: StyleProfile
  imprint?: Partial<ImprintFields>
  /** Overwrite an existing profile rather than banking a second one. */
  id?: string
  now?: Date
}): SavedStyleProfile {
  const savedAt = (input.now ?? new Date()).toISOString()
  const imprint = { ...emptyImprint(), ...(input.imprint ?? {}) }
  return {
    id: input.id ?? profileId(savedAt),
    name: input.name.trim() || 'Untitled look',
    savedAt,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    style: normalizeStyleProfile(input.style),
    imprint
  }
}

/**
 * Read a stored record back.
 *
 * Unlike `migrateSavedRun`, this is forgiving: it backfills rather than
 * throwing. The reasoning is not laziness but asymmetry — a half-restored
 * *transcription* looks like a book that was read and prints with holes in it,
 * so it must be refused, whereas a half-restored *look* is a margin that came
 * back at the shipped default. The design gate renders the result as real pages
 * before anything is accepted, so a wrong value is visible and one click from
 * fixed. Refusing the whole profile would throw away the other thirteen fields
 * to protect the user from one they can see.
 *
 * Returns null only when the record is not a profile at all.
 */
export function migrateSavedProfile(raw: unknown): SavedStyleProfile | null {
  if (!isRecord(raw)) return null
  const id = str(raw['id'], '')
  if (!id) return null

  const rawImprint = isRecord(raw['imprint']) ? raw['imprint'] : {}
  return {
    id,
    name: str(raw['name'], 'Untitled look'),
    savedAt: str(raw['savedAt'], new Date(0).toISOString()),
    schemaVersion: PROFILE_SCHEMA_VERSION,
    style: normalizeStyleProfile(raw['style']),
    imprint: {
      imprint: str(rawImprint['imprint'], ''),
      copyrightHolder: str(rawImprint['copyrightHolder'], ''),
      publicDomainNotice:
        typeof rawImprint['publicDomainNotice'] === 'boolean'
          ? rawImprint['publicDomainNotice']
          : true,
      // False when absent: a look banked before annotated editions existed
      // describes a press that was not making them, and defaulting the other
      // way would print the claim on a book with nothing in it.
      annotatedNotice: rawImprint['annotatedNotice'] === true,
      imprintLine: str(rawImprint['imprintLine'], '')
    }
  }
}

/** A one-line description of a banked look, for the option that offers it. */
export function describeSavedProfile(p: SavedStyleProfile): string {
  const parts = [`${p.style.trimSize}in`, `${p.style.bodyFont} at ${p.style.bodyFontSize}pt`]
  if (p.imprint.imprint) parts.push(p.imprint.imprint)
  return parts.join(' · ')
}
