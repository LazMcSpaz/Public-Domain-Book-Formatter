/**
 * A link that opens a book at the place a decision is waiting.
 *
 * The editor works from a phone. Without this, looking at one flagged word
 * means: open the app, connect the shelf, find the book, wait for the scan to
 * be fetched and re-read, answer the offer of the saved transcription, and
 * walk the gates that were settled days ago — to arrive at a screen that could
 * have been the first one.
 *
 * So a link names the book and the place: `#book=<slug>&at=gate-uncertainties`.
 *
 * ## Why a slug and not a key
 *
 * A run key is `name\0size\0lastModified`, which contains a NUL byte and a file
 * name and is nobody's idea of a URL. `shelfSlug` already exists, is already
 * the book's own directory on the shelf, and is already stable — so the shelf's
 * name for a book is the link's name for it too, rather than a second scheme
 * that can disagree with the first.
 *
 * ## Why this cannot skip any *decision*
 *
 * It marks earlier steps complete, which is what `activeStep` reads — so the
 * app arrives where it would have arrived anyway had someone clicked through.
 * It does not answer anything. A gate with a question outstanding still asks
 * it, and `canEnter` still governs: a step whose inputs are not ready is not
 * reachable by naming it in a URL, because the step machine decides that and
 * this does not touch the step machine.
 *
 * Pure: no DOM, no I/O.
 */
import { STEPS, type StepId } from './steps'

export interface DeepLink {
  /** The book's shelf slug, or null when the link names no book. */
  slug: string | null
  /** Where to land, or null to let the flow decide as usual. */
  at: StepId | null
  /** A leaf to scroll to once there, for a link about one spot. */
  leaf: number | null
}

/**
 * Friendly names for the two places a link is nearly always about.
 *
 * `review` rather than `gate-uncertainties` because the link is written by a
 * person for a person, and a URL that has to be spelled with the step
 * machine's internal id is a URL nobody will write by hand.
 */
const ALIASES: Record<string, StepId> = {
  review: 'gate-uncertainties',
  proof: 'proof',
  structure: 'gate-structure',
  identity: 'gate-identity'
}

const STEP_IDS = new Set<string>(STEPS.map((s) => s.id))

/**
 * Read a link.
 *
 * Anything unrecognised comes back null rather than throwing: a hash is user
 * input arriving from a phone's address bar, and the worst outcome of a typo
 * should be the ordinary intake screen, never a broken app.
 */
export function parseDeepLink(hash: string): DeepLink {
  const empty: DeepLink = { slug: null, at: null, leaf: null }
  const trimmed = hash.replace(/^#/u, '')
  if (!trimmed) return empty

  const params = new URLSearchParams(trimmed)
  const slug = params.get('book')?.trim() ?? ''
  if (!slug || !/^[a-z0-9-]{1,120}$/u.test(slug)) return empty

  const raw = params.get('at')?.trim().toLowerCase() ?? ''
  const at = ALIASES[raw] ?? (STEP_IDS.has(raw) ? (raw as StepId) : null)

  const rawLeaf = params.get('leaf')
  const leaf = rawLeaf !== null && /^\d{1,5}$/u.test(rawLeaf) ? Number(rawLeaf) : null

  return { slug, at, leaf }
}

/** Build one, for whatever is handing the editor a link. */
export function deepLink(
  base: string,
  link: { slug: string; at?: StepId | string; leaf?: number }
): string {
  const params = new URLSearchParams({ book: link.slug })
  if (link.at) params.set('at', String(link.at))
  if (typeof link.leaf === 'number') params.set('leaf', String(link.leaf))
  return `${base.replace(/#.*$/u, '').replace(/\/$/u, '')}/#${params.toString()}`
}

/**
 * Every step before this one, which is what marks a flow as already walked.
 *
 * Deliberately *not* "every step except this one": marking later steps complete
 * would carry the book past gates nobody has answered, and the whole point of a
 * gate is that it was answered.
 */
export function stepsBefore(at: StepId): StepId[] {
  const index = STEPS.findIndex((s) => s.id === at)
  return index <= 0 ? [] : STEPS.slice(0, index).map((s) => s.id)
}
