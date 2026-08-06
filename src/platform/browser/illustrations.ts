/**
 * Cutting illustrations out of the scan.
 *
 * The engine reasons about a rectangle and an id; this is where the id gets its
 * pixels. Two rules shape it.
 *
 * **Memory.** A 300-DPI page is ~19 MB of raw pixels, so the pages that carry
 * pictures are rendered one at a time, cropped, and released — the same
 * discipline recon follows. Only the encoded PNGs are kept, and only for the
 * regions the user actually accepted.
 *
 * **Never invent resolution.** The crop is taken at the DPI the page is
 * rendered at and handed on at exactly that size. Rendering the page larger to
 * make the DPI number look better would only interpolate pixels the scan never
 * had: the printed page would be no sharper, and the KDP check — the one thing
 * that would have warned the user — would have been talked out of it. A low
 * number here is information, not a problem to be hidden.
 *
 * Browser-only: pdf.js and canvas.
 */
import { detectRegions } from '@core/image'
import type { ImageRegion } from '@core/model'
import type { IllustrationSource } from '@core/assemble'
import { cropToObjectUrl, cropToPngBytes, inkProfile, openPdf, renderPage } from './pdf'

/** The DPI illustration crops are taken at. Matches recon's render. */
export const CROP_DPI = 300

/**
 * How much of a candidate must be ink before it is offered as a picture.
 *
 * The region detector finds rectangles with no *words* in them. Most of those
 * are paper: margins, the sink above a chapter title, the empty foot of a short
 * page. Two per cent of a rectangle covered in ink is far more than blank paper
 * ever reaches and far less than any real engraving, which is why one number
 * separates them without needing to be tuned per book.
 */
const MIN_INK_FRACTION = 0.02

/**
 * Candidates offered per page, largest first.
 *
 * The detector emits every locally-maximal empty rectangle, and a page can have
 * a dozen. Reviewing a dozen guesses per page is worse than reviewing none —
 * the gate stops being read. Real pages carry one picture, occasionally two.
 */
const MAX_CANDIDATES_PER_PAGE = 3

/**
 * How much a candidate may overlap one already kept before it is the same hole.
 *
 * Maximal empty rectangles describe a gap in the text, and one gap has several
 * maximal rectangles in it: the wide one that stops at the paragraphs above and
 * below, and the tall thin ones that run past them up the margin. Tightening
 * each to its ink pulls them all onto the same picture, and this drops the
 * duplicates.
 *
 * Two *different* pictures on a page do not overlap at all — they are separated
 * by the text or the white between them — so this can be generous without ever
 * merging a real pair.
 */
const SAME_REGION_OVERLAP = 0.35

function areaOf(b: { x0: number; y0: number; x1: number; y1: number }): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)
}

function overlapArea(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number }
): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * How close two inked areas may be before they are one picture, as a fraction
 * of the page's width.
 *
 * A drawing is rarely one connected blot. An alembick has a receiver standing
 * apart from it; a diagram has its key beside it; an engraving has a caption
 * rule under it. Tightening each detected hole to its own ink cuts those into
 * separate candidates, and offering the user "here are the four pieces of your
 * picture" is worse than offering nothing.
 *
 * Two genuinely separate figures on one page are separated by text or by real
 * white space, both of which are far wider than this.
 */
const SAME_FIGURE_GAP = 0.05

type Box = { x0: number; y0: number; x1: number; y1: number }

/** Merge boxes that are within `gap` pixels of each other, until none are. */
function mergeNearby<T extends { bbox: Box }>(items: T[], gap: number): T[] {
  const out = [...items]
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!.bbox
        const b = out[j]!.bbox
        const grown = { x0: a.x0 - gap, y0: a.y0 - gap, x1: a.x1 + gap, y1: a.y1 + gap }
        if (overlapArea(grown, b) <= 0) continue
        // Keep the first item's identity — its id is already the one the
        // preview and the answer are keyed by — and widen it to hold both.
        out[i] = {
          ...out[i]!,
          bbox: {
            x0: Math.min(a.x0, b.x0),
            y0: Math.min(a.y0, b.y0),
            x1: Math.max(a.x1, b.x1),
            y1: Math.max(a.y1, b.y1)
          }
        }
        out.splice(j, 1)
        merged = true
        break outer
      }
    }
  }
  return out
}

/** A detected region, with the pixels to judge it by. */
export interface RegionCandidate {
  region: ImageRegion
  /** A PNG object URL of the region. **The caller must revoke it.** */
  previewUrl: string
  /** Fraction of the region that is ink — why it was offered. */
  ink: number
}

/**
 * Find the illustrations on one already-rendered page.
 *
 * Takes a canvas rather than a page number because the caller has one open:
 * this runs inside recon's loop, where the page is rendered and about to be
 * thrown away, so detection costs no extra render at all.
 */
export async function detectIllustrations(
  canvas: HTMLCanvasElement,
  pageIndex: number,
  words: readonly { bbox: { x0: number; y0: number; x1: number; y1: number } }[]
): Promise<RegionCandidate[]> {
  // A page with no OCR words at all is reported by the detector as one
  // whole-page region. That is right for a plate and wrong for a blank leaf,
  // and the ink test below is what tells them apart.
  const regions = detectRegions({
    index: pageIndex,
    imagePath: null,
    width: canvas.width,
    height: canvas.height,
    dpi: null,
    words: words.map((w, i) => ({
      id: `p${pageIndex}_w${i}`,
      pageIndex,
      text: '',
      confidence: 1,
      bbox: w.bbox
    })),
    regions: []
  })

  // Each surviving region is pulled in to the ink inside it, which is what
  // turns "the gap between these two paragraphs" into "this picture".
  const tightened = regions
    .map((region) => ({ region, profile: inkProfile(canvas, region.bbox) }))
    .filter(({ profile }) => profile.fraction >= MIN_INK_FRACTION && profile.bounds !== null)
    .map(({ region, profile }) => ({ id: region.id, bbox: profile.bounds! }))
    .sort((a, b) => areaOf(b.bbox) - areaOf(a.bbox))

  // Drop the duplicates first — one gap described by several rectangles — then
  // join what is left into whole pictures. In that order, because merging
  // duplicates would grow a box back out to the margins it was just pulled in
  // from, undoing the tightening.
  const distinct: { id: string; bbox: Box }[] = []
  for (const candidate of tightened) {
    const own = areaOf(candidate.bbox)
    if (own <= 0) continue
    if (distinct.some((k) => overlapArea(k.bbox, candidate.bbox) / own >= SAME_REGION_OVERLAP)) {
      continue
    }
    distinct.push(candidate)
  }

  const whole = mergeNearby(distinct, canvas.width * SAME_FIGURE_GAP)
    .sort((a, b) => areaOf(b.bbox) - areaOf(a.bbox))
    .slice(0, MAX_CANDIDATES_PER_PAGE)

  const candidates: RegionCandidate[] = []
  for (const { id, bbox } of whole) {
    try {
      candidates.push({
        region: { id, pageIndex, bbox, accepted: null },
        // Read against the final box, since that is the one the user is being
        // shown and the one the crop will be taken from.
        ink: inkProfile(canvas, bbox).fraction,
        previewUrl: await cropToObjectUrl(canvas, bbox)
      })
    } catch {
      // A candidate with no preview is a question with no evidence, which this
      // gate must never ask. Dropping it is right: the region detector is
      // explicitly a first guess, not a promise.
    }
  }
  return candidates
}

/**
 * The longest edge a supplied picture is kept at, in pixels.
 *
 * Not a quality decision — a resolution one. The most a book page can use is
 * roughly its trim in inches times 300 DPI, which for the largest KDP trim is
 * about 2550px across. Anything beyond that is pixels the printer will throw
 * away, carried in the PDF and in the saved run for the whole session. A phone
 * photograph is routinely three times this.
 *
 * Nothing is ever scaled *up* to reach it: that would invent resolution, and
 * the DPI check exists to report exactly the resolution the picture has.
 */
const SUPPLIED_MAX_EDGE = 2600

/** A picture the editor supplied, decoded and ready to embed. */
export interface SuppliedImage {
  bytes: Uint8Array
  width: number
  height: number
}

/**
 * Decode a file the editor picked into PNG bytes the writer can embed.
 *
 * Goes through a canvas rather than passing the file's own bytes along, for
 * two reasons: pdf-lib embeds PNG and JPEG only, so a GIF or a WebP would have
 * to be refused otherwise; and a photograph straight off a phone is far larger
 * than any book page can use, which would bloat both the PDF and the saved run
 * to no visible effect.
 *
 * PNG out, as for the crops — these are often line art or plates, where JPEG's
 * ringing around every edge is the artefact that shows up in print.
 */
export async function readSuppliedImage(file: Blob): Promise<SuppliedImage> {
  const bitmap = await createImageBitmap(file)
  try {
    // Only ever shrinks. Enlarging would be inventing pixels the file never
    // had, and would talk the DPI check out of a warning it should give.
    const scale = Math.min(1, SUPPLIED_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not acquire a 2D canvas context')
    // A transparent PNG would print as black on some RIPs; a book page is paper.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    canvas.width = 0
    canvas.height = 0
    if (!blob) throw new Error('Could not encode the picture')

    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
  } finally {
    bitmap.close()
  }
}

export interface CroppedIllustrations {
  /** PNG bytes per region id, to hand to the PDF writer. */
  bytes: Map<string, Uint8Array>
  /** What the core needs: the pixel size of each crop, for the DPI check. */
  sources: IllustrationSource[]
  /** Regions whose pixels could not be cut, and why. */
  failed: { id: string; reason: string }[]
}

export interface CropOptions {
  dpi?: number
  /** Called after each page is cropped, so a long run can show progress. */
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Cut every accepted region out of the book.
 *
 * Regions are grouped by page first, so a page carrying three figures is
 * rendered once rather than three times — the render is by far the expensive
 * part, and it is the part that costs 19 MB while it lasts.
 */
export async function cropIllustrations(
  file: Blob,
  regions: readonly ImageRegion[],
  options: CropOptions = {}
): Promise<CroppedIllustrations> {
  const bytes = new Map<string, Uint8Array>()
  const sources: IllustrationSource[] = []
  const failed: { id: string; reason: string }[] = []

  const accepted = regions.filter((r) => r.accepted !== false)
  if (accepted.length === 0) return { bytes, sources, failed }

  const byPage = new Map<number, ImageRegion[]>()
  for (const region of accepted) {
    const list = byPage.get(region.pageIndex) ?? []
    list.push(region)
    byPage.set(region.pageIndex, list)
  }

  const dpi = options.dpi ?? CROP_DPI
  const doc = await openPdf(file)
  const pageNumbers = [...byPage.keys()].sort((a, b) => a - b)

  try {
    let done = 0
    for (const pageIndex of pageNumbers) {
      if (options.signal?.aborted) break

      const rendered = await renderPage(doc, pageIndex, dpi)
      try {
        for (const region of byPage.get(pageIndex) ?? []) {
          try {
            const crop = await cropToPngBytes(rendered.canvas, region.bbox)
            bytes.set(region.id, crop.bytes)
            sources.push({
              id: region.id,
              pageIndex,
              sourceWidth: crop.width,
              sourceHeight: crop.height
            })
          } catch (cause) {
            // One unusable region must not cost the book its other pictures.
            failed.push({
              id: region.id,
              reason: cause instanceof Error ? cause.message : String(cause)
            })
          }
        }
      } finally {
        // Release the page before the next one is rendered, always — including
        // on the way out of an error. This is the 19 MB.
        rendered.canvas.width = 0
        rendered.canvas.height = 0
      }

      options.onProgress?.(++done, pageNumbers.length)
    }
  } finally {
    await doc.destroy()
  }

  return { bytes, sources, failed }
}
