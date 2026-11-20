/**
 * What a picture needs to print, the models that can make one, and the
 * request one is sent.
 *
 * Pure.
 */
import type { Rect } from './geometry'

/**
 * The pixels a picture needs to print at `dpi` across a placed rectangle.
 *
 * Rounded *up*, always. Asking for 1799 pixels where 1800 are needed produces a
 * cover that fails the check by a hair and a person who spends an afternoon
 * finding out why.
 */
export function requiredPixels(
  rect: Pick<Rect, 'width' | 'height'>,
  dpi = 300
): { width: number; height: number; megapixels: number } {
  const width = Math.ceil(rect.width * dpi)
  const height = Math.ceil(rect.height * dpi)
  return { width, height, megapixels: (width * height) / 1_000_000 }
}

/** An image model the studio offers, and what it can actually give you. */
export interface ArtModel {
  /** `owner/name` on Replicate. Any other slug may be typed in. */
  slug: string
  label: string
  /**
   * Largest output this model produces, in megapixels, as its own docs state.
   *
   * The reason the list carries a number at all: it is what lets the studio say
   * "this model tops out at 1 MP and you need 4.9" *before* the money is spent,
   * rather than after, when the answer is a soft cover and a second charge.
   */
  maxMegapixels: number
  note: string
}

/**
 * A short, opinionated list — a starting point, not a registry.
 *
 * Any `owner/model` slug can be typed instead, because Replicate's catalogue
 * changes weekly and a hard-coded list that goes stale is worse than no list.
 * What these five have in common is that they are current, they are official
 * (so their interface is stable), and between them they cover the two axes that
 * matter here: how many pixels, and how cheap.
 */
export const SUGGESTED_ART_MODELS: readonly ArtModel[] = [
  {
    slug: 'black-forest-labs/flux-1.1-pro-ultra',
    label: 'FLUX 1.1 pro ultra',
    maxMegapixels: 4,
    note: 'Up to 4 MP — enough for a 6×9 front at 300 DPI with nothing to spare.'
  },
  {
    slug: 'bytedance/seedream-4',
    label: 'Seedream 4',
    maxMegapixels: 8,
    note: 'Generates up to 4K, so a full-bleed cover is reachable without upscaling.'
  },
  {
    slug: 'google/nano-banana-pro',
    label: 'Nano Banana Pro',
    maxMegapixels: 8,
    note: 'Strong at following a written brief; good when the device has to be a specific thing.'
  },
  {
    slug: 'black-forest-labs/flux-dev',
    label: 'FLUX dev',
    maxMegapixels: 2,
    note: 'Cheap and quick. Fine for trying compositions; too few pixels to print large.'
  },
  {
    slug: 'black-forest-labs/flux-schnell',
    label: 'FLUX schnell',
    maxMegapixels: 1,
    note: 'The cheapest way to see whether a brief is worth pursuing. Not a print source.'
  }
]

export type ResolutionVerdict =
  | { kind: 'ok'; needed: { width: number; height: number } }
  | {
      kind: 'short'
      needed: { width: number; height: number }
      /** What the model can give, in megapixels. */
      available: number
      message: string
    }

/**
 * Can this model print at this size?
 *
 * Answered before generating, and answered in inches and DPI rather than
 * megapixels, because "you need 4.9 MP" means nothing to someone deciding
 * whether their cover will look cheap.
 */
export function checkResolution(
  rect: Pick<Rect, 'width' | 'height'>,
  model: Pick<ArtModel, 'label' | 'maxMegapixels'>,
  dpi = 300
): ResolutionVerdict {
  const needed = requiredPixels(rect, dpi)
  if (model.maxMegapixels >= needed.megapixels) {
    return { kind: 'ok', needed: { width: needed.width, height: needed.height } }
  }
  const bestDpi = Math.floor(
    Math.sqrt((model.maxMegapixels * 1_000_000) / (rect.width * rect.height))
  )
  return {
    kind: 'short',
    needed: { width: needed.width, height: needed.height },
    available: model.maxMegapixels,
    message:
      `${model.label} tops out around ${model.maxMegapixels} MP. Across ` +
      `${rect.width.toFixed(2)} × ${rect.height.toFixed(2)} in that is about ${bestDpi} DPI, ` +
      `against the ${dpi} KDP wants — the picture will print soft. Pick a model with more ` +
      `pixels, set the art smaller, or upscale it afterwards and accept that the added ` +
      `detail was invented rather than drawn.`
  }
}

/**
 * Aspect ratios image models accept, as they spell them.
 *
 * The list is short because it is theirs, not ours: asking for `1.5:2.25`
 * because that is what the frame measures gets a 422 from the API, and a cover
 * that never generated.
 */
export const MODEL_ASPECT_RATIOS: readonly string[] = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9'
]

/**
 * The nearest ratio a model will accept to the frame the art has to fill.
 *
 * Nearest rather than exact, and then the composer *crops* what comes back to
 * the frame. That order matters: generating at the wrong ratio and stretching
 * it to fit would distort the picture, which on an engraving is instantly
 * visible and on a photograph of a person is grotesque.
 */
export function nearestAspectRatio(rect: Pick<Rect, 'width' | 'height'>): string {
  if (rect.width <= 0 || rect.height <= 0) return '1:1'
  const target = rect.width / rect.height
  let best = MODEL_ASPECT_RATIOS[0]!
  let bestError = Infinity
  for (const ratio of MODEL_ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number) as [number, number]
    const error = Math.abs(w / h - target)
    if (error < bestError) {
      best = ratio
      bestError = error
    }
  }
  return best
}

export interface PredictionInputSpec {
  input: Record<string, string | number | boolean>
  /**
   * What could not be asked for on this model, in plain language.
   *
   * Every model spells its inputs differently and Replicate rejects an input it
   * does not know, so an unrecognised slug is sent the one field every image
   * model has — the prompt — and the user is told that the size and the
   * negative prompt did not travel. Guessing field names would turn a working
   * generation into a 422 and a charge for nothing.
   */
  notes: string[]
}

/**
 * Shape the request for a model.
 *
 * Deliberately a small table of families rather than a schema fetch: the input
 * schema *is* available from the API, but reading it correctly means mapping
 * "the field that means the aspect ratio" across a dozen naming conventions,
 * which is the same table written less legibly and at the cost of a round trip.
 */
export function predictionInput(
  slug: string,
  brief: { prompt: string; negative: string; aspectRatio: string; seed: number | null }
): PredictionInputSpec {
  const notes: string[] = []
  const base: Record<string, string | number | boolean> = { prompt: brief.prompt }
  if (brief.seed !== null) base['seed'] = brief.seed

  if (
    slug.startsWith('black-forest-labs/flux-1.1-pro') ||
    slug.startsWith('black-forest-labs/flux-pro')
  ) {
    return {
      input: { ...base, aspect_ratio: brief.aspectRatio, output_format: 'png' },
      notes: ['FLUX pro takes no negative prompt; the steering is in the brief itself.']
    }
  }
  if (slug.startsWith('black-forest-labs/flux')) {
    return {
      input: {
        ...base,
        aspect_ratio: brief.aspectRatio,
        output_format: 'png',
        megapixels: '1',
        num_outputs: 1
      },
      notes: ['FLUX dev and schnell cap out around one megapixel — a trial size, not a print size.']
    }
  }
  if (slug.startsWith('bytedance/seedream')) {
    return {
      input: { ...base, aspect_ratio: brief.aspectRatio, size: '4K' },
      notes: []
    }
  }
  if (slug.startsWith('google/nano-banana')) {
    return {
      input: { ...base, aspect_ratio: brief.aspectRatio, output_format: 'png' },
      notes: []
    }
  }

  notes.push(
    `${slug} is not one this app knows the inputs of, so only the prompt was sent — ` +
      'the size and the negative prompt did not travel. Whatever the model does by default is ' +
      'what you will get.'
  )
  return { input: base, notes }
}
