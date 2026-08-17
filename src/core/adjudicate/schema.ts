/**
 * A second look at the places the cross-checks flagged.
 *
 * ## What this is, and what it must not become
 *
 * After the paid pass, deterministic comparisons against OCR raise a list of
 * spots where the two readings disagree. Every one of them then goes to a human
 * — which on a real book is a hundred and sixty leaves of squinting at dense
 * type to decide, over and over, whether OCR imagined a word.
 *
 * Most of those decisions do not need a person. They need *someone to look at
 * the pixels again*, which is exactly what a vision model is for and exactly
 * what the first pass did not do for these spots in particular: it read the
 * whole leaf once, at speed, with the whole book to get through.
 *
 * So this is a narrow second reading. One question, one place, with the scan in
 * hand: **what does the page say here?**
 *
 * ## The two rules it lives under
 *
 * **Never repair text without pixels.** The page image goes with every
 * request. A version of this that took the transcription and the OCR and no
 * picture would return fluent, confident, invented prose, and nothing
 * downstream could tell — the one unrecoverable failure for a reprint. The
 * schema below therefore has no field for "what it should say"; it has a field
 * for what the page *does* say, which is a claim about an image.
 *
 * **Never gate a check on a model's opinion of its own output** (SPEC §4). The
 * question deliberately is not "were you right?" — that is self-assessment and
 * carries no weight. It is "read this spot", which is an observation. And the
 * answer never removes a finding: it arrives at the gate as a recommendation
 * *with the reading it is based on*, so the user can see whether it makes
 * sense, and every flagged spot still reaches them.
 *
 * Pure: shapes and parsing. The prompt is next door, the transport is injected.
 */

/** What a second reading concluded about one flagged spot. */
export type SpotVerdict =
  /** The words are on the page and the transcription lacks them. */
  | 'missing'
  /** OCR invented them; the transcription is right as it stands. */
  | 'not-there'
  /** Something is there, but neither reading has it right. */
  | 'different'
  /** The pixels do not settle it. */
  | 'unsure'

export const SPOT_VERDICTS: readonly SpotVerdict[] = ['missing', 'not-there', 'different', 'unsure']

/** One flagged place, as it goes up. */
export interface SpotToCheck {
  /** The discrepancy row's id — what the answer is matched back to. */
  id: string
  /** What OCR read here that the transcription does not have. */
  ocrReading: string
  /** The transcribed words just before this spot. */
  after: string
  /** The transcribed words just after it. */
  before: string
}

/** One leaf's worth of flagged places, sent as a single request. */
export interface LeafToCheck {
  pageIndex: number
  /** Base64 PNG of the leaf, without a data: prefix. Never optional. */
  imageBase64: string
  /** What the paid pass read off this leaf, so the model can locate the spots. */
  transcription: string
  spots: SpotToCheck[]
}

/** What came back about one spot. */
export interface AdjudicatedSpot {
  id: string
  verdict: SpotVerdict
  /**
   * What the page says at that spot, read off the image.
   *
   * The load-bearing field. A verdict on its own is an opinion; a verdict with
   * the words it is based on is something the user can check against the crop
   * beside it in a second. Empty for `not-there`, where the answer is that
   * there is nothing to read.
   */
  reading: string
  /** One short sentence a person can act on. */
  note: string
}

/**
 * The reply shape, as a JSON schema for structured output.
 *
 * Deliberately small. Everything the model is asked for is either an
 * observation about the image or a pointer back to the spot being asked
 * about — there is no field it could fill with prose about the book.
 */
export const ADJUDICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['spots'],
  properties: {
    spots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'reading', 'note'],
        properties: {
          id: {
            type: 'string',
            description: 'The id of the spot this answers, copied exactly.'
          },
          verdict: {
            type: 'string',
            enum: [...SPOT_VERDICTS],
            description:
              'missing: the words are on the page and the transcription lacks them. ' +
              'not-there: the OCR reading is not on the page. ' +
              'different: something is there but neither reading is right. ' +
              'unsure: the image does not settle it.'
          },
          reading: {
            type: 'string',
            description:
              'What the page actually says at this spot, transcribed from the image. ' +
              'Empty when the verdict is not-there.'
          },
          note: {
            type: 'string',
            description: 'One short sentence explaining the verdict to a human.'
          }
        }
      }
    }
  }
} as const

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Read a reply, keeping only answers to spots that were actually asked about.
 *
 * `asked` is not a formality. A reply naming a spot that was never sent is a
 * model that has lost track of what it was looking at, and letting it through
 * would attach a reading to a place on the page nobody asked about. Anything
 * unrecognised is dropped and the spot is simply left unadjudicated — which is
 * the honest outcome, and the same one a request that failed produces.
 */
export function parseAdjudication(raw: unknown, asked: readonly string[]): AdjudicatedSpot[] {
  if (!isObject(raw)) return []
  const spots = raw['spots']
  if (!Array.isArray(spots)) return []

  const wanted = new Set(asked)
  const seen = new Set<string>()
  const out: AdjudicatedSpot[] = []

  for (const value of spots) {
    if (!isObject(value)) continue
    const id = str(value['id'])
    if (!wanted.has(id) || seen.has(id)) continue

    const verdict = SPOT_VERDICTS.find((v) => v === value['verdict'])
    if (!verdict) continue

    seen.add(id)
    out.push({
      id,
      verdict,
      // A reading is meaningless where the answer is that nothing is there,
      // and keeping one would put words on screen the model did not claim to
      // have seen.
      reading: verdict === 'not-there' ? '' : str(value['reading']).trim(),
      note: str(value['note']).trim()
    })
  }
  return out
}

/**
 * Rebuild the verdicts from what storage holds.
 *
 * A saved run keeps a spot as three plain fields, without its id — the id is
 * the key it is filed under, so storing it twice would let the two disagree.
 * This puts it back, and re-checks the verdict against the vocabulary rather
 * than trusting a string that has been through a database: an unrecognised
 * verdict reaches the gate as a recommendation nothing knows how to render,
 * which is worse than the spot simply arriving unjudged.
 */
export function spotsFromStored(
  stored: Readonly<Record<string, { verdict: string; reading: string; note: string }>>
): Record<string, AdjudicatedSpot> {
  const out: Record<string, AdjudicatedSpot> = {}
  for (const [id, value] of Object.entries(stored)) {
    const verdict = SPOT_VERDICTS.find((v) => v === value.verdict)
    if (!id || !verdict) continue
    out[id] = {
      id,
      verdict,
      reading: typeof value.reading === 'string' ? value.reading : '',
      note: typeof value.note === 'string' ? value.note : ''
    }
  }
  return out
}
