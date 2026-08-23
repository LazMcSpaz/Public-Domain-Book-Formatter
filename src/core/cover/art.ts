/**
 * Where a cover's picture comes from, and what it costs in pixels.
 *
 * Four doors, deliberately equal. A reprint of an illustrated Victorian
 * travel book wants its own frontispiece; a reprint of a plain philosophical
 * treatise has no picture in it at all and wants type; a collection being given
 * a house style wants one made. None of those is the "real" answer, so this
 * module ranks nothing — it makes each door work and tells the truth about what
 * comes through it.
 *
 * ## The resolution problem, which is the whole of the honesty here
 *
 * `SPEC §6` and this codebase have one rule about pixels: **never invent
 * resolution.** It was written for scans — rendering a page larger to make the
 * DPI number look better only interpolates pixels the scan never had. Generated
 * art walks straight into the same wall from the other side, and it is easy to
 * miss because the picture looks sharp on screen.
 *
 * A 6×9 front cover at KDP's 300 DPI is 1800 × 2700 pixels — 4.9 megapixels. A
 * full-bleed cover is more. Most image models return about one megapixel, which
 * placed across a 6×9 front is **113 DPI**: on screen, immaculate; in print,
 * soft, and the softness reads to a browsing reader as exactly the cheapness
 * this whole app exists to avoid.
 *
 * So `requiredPixels` is computed *before* anything is generated, the brief
 * carries it, and a model that cannot reach it is reported rather than quietly
 * used. Upscaling afterwards is offered and labelled for what it is: invented
 * detail, which is tolerable on a texture or a wash and dishonest on an
 * engraving, where the invented detail is *lines that were never drawn*.
 *
 * ## Why the briefs are shaped the way they are
 *
 * Generated art on a book is a claim a reader can hold against you, and the
 * failure mode is specific: a cover that looks like a machine made it makes a
 * reader doubt the text inside is a faithful reprint. The briefs here therefore
 * steer toward what generation is *good* at and what a period reprint can
 * honestly use — a ground, a texture, a motif, an ornamental device — and away
 * from what it is bad at and what invites the doubt: depicted people, invented
 * historical scenes, and above all **lettering**, which the model garbles and
 * which is the composer's job anyway.
 *
 * A pictorial brief is still offered, because sometimes it is right and the
 * user is an adult. It just says what it is.
 *
 * Pure: prompt strings and arithmetic. The transport is
 * `@platform/browser/replicate`.
 */
import type { Rect } from './geometry'

/** What kind of picture is being asked for. */
export type ArtBrief =
  /** A ground: paper, cloth, marbling, a wash. Type sits over it. */
  | 'ground'
  /** A single ornamental device, centred, on a plain field. */
  | 'motif'
  /** A period-manner engraving or woodcut of a subject. */
  | 'engraving'
  /** A depicted scene. Honest about being the riskiest door. */
  | 'scene'

export const ART_BRIEFS: readonly ArtBrief[] = ['ground', 'motif', 'engraving', 'scene']

export const BRIEF_LABEL: Readonly<Record<ArtBrief, string>> = {
  ground: 'A ground — paper, cloth, marbling, a wash for the type to sit on',
  motif: 'A single device — an emblem or ornament on a plain field',
  engraving: 'An engraving in the period manner',
  scene: 'A depicted scene'
}

export const BRIEF_NOTE: Readonly<Record<ArtBrief, string>> = {
  ground:
    'The safest thing to generate and the easiest to print: no drawing to get wrong, and it upscales without inventing anything a reader can point at.',
  motif:
    'Reads as a printer’s device rather than as a picture, which is what most plain reprints actually want.',
  engraving:
    'Convincing at a glance and the one to look hardest at — a machine-made engraving has lines that go nowhere, and upscaling it invents more of them.',
  scene:
    'The most likely to be recognised as generated, and the most likely to contradict the book. Worth it only when you have a clear picture in mind and will look at the result properly.'
}

/**
 * What every generated cover is told not to do.
 *
 * Lettering is first for a practical reason rather than a stylistic one: the
 * cover's type is set by the composer, in an embedded face, at a measured size.
 * A model's idea of lettering underneath it is a second, misspelled title.
 */
export const HOUSE_CONSTRAINTS: readonly string[] = [
  'no lettering, words, numerals or signatures of any kind',
  'no borders or frames drawn into the image — the composer sets those',
  'no watermarks or logos',
  'nothing that reads as a modern digital illustration: no airbrushed gradients, no lens flare, no plastic sheen'
]

export interface ArtBriefInput {
  brief: ArtBrief
  /** What the user asked for, in their own words. */
  subject: string
  /**
   * The book's own period, when known — "1887", "the 1740s".
   *
   * Passed because it is the single most useful steer available and the app
   * already knows it: the year came off the original title page at the export
   * gate rather than out of the user's memory.
   */
  period: string
  /** The book's title, for context only — never to be drawn. */
  title: string
  /** How the ground is coloured, so the art and the palette agree. */
  palette: { ground: string; ink: string; accent: string }
  /** Extra direction the user typed. Appended verbatim, last. */
  direction: string
}

export interface ArtPrompt {
  prompt: string
  /** Steering away, for models that take a negative prompt. */
  negative: string
  /**
   * What this brief will and will not do, shown beside the button that spends
   * money. Not a disclaimer: the difference between "a ground" and "a scene" is
   * the difference between a cover that prints and one that has to be redone.
   */
  note: string
}

const BRIEF_OPENING: Readonly<Record<ArtBrief, string>> = {
  ground:
    'A printed ground for a book cover: an even, unhurried surface with no focal point — laid paper, book cloth, marbled endpaper or a flat wash',
  motif:
    'A single centred ornamental device on a plain field, in the manner of a printer’s emblem: symmetrical, self-contained, generous margins of empty field around it',
  engraving:
    'A book illustration in the manner of a period steel or wood engraving: line work only, cross-hatched tone, no continuous shading, as it would print in one ink on paper',
  scene: 'An illustration for a book cover'
}

const BRIEF_MANNER: Readonly<Record<ArtBrief, string>> = {
  ground: 'Flat, quiet, and legible under type. Texture rather than subject.',
  motif: 'Drawn, not rendered. One weight of line, closed forms, no perspective.',
  engraving:
    'The tonality of ink on rag paper: warm black on cream, plate texture, slight wear at the edges of the strokes.',
  scene: 'Composed with a clear area of quiet where the title will sit.'
}

/**
 * Build the request.
 *
 * Assembled from parts rather than typed free-hand so that two books in a
 * collection asked for "a ground" get *the same brief* with different subjects
 * — which is what makes a collection look like one, and what a remembered
 * prompt in someone's notes never does.
 */
export function buildArtPrompt(input: ArtBriefInput): ArtPrompt {
  const parts: string[] = [BRIEF_OPENING[input.brief]]
  if (input.subject.trim()) parts.push(input.subject.trim())
  if (input.period.trim()) {
    parts.push(`in the visual idiom of ${input.period.trim()}, as a book of that date would carry`)
  }
  parts.push(BRIEF_MANNER[input.brief])
  parts.push(
    `Colour to sit with a ${input.palette.ground} ground and ${input.palette.ink} ink, with ${input.palette.accent} as an accent.`
  )
  parts.push(HOUSE_CONSTRAINTS.join('; ') + '.')
  if (input.direction.trim()) parts.push(input.direction.trim())

  return {
    prompt: parts.join('. ').replace(/\.\.+/g, '.'),
    negative:
      'text, lettering, words, letters, numbers, signature, watermark, logo, frame, border, ' +
      'modern digital art, airbrush, lens flare, 3d render, plastic, oversaturated',
    note: BRIEF_NOTE[input.brief]
  }
}

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
