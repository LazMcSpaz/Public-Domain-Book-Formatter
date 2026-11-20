/**
 * Which items of a composed cover are flattened, and which stay vector.
 *
 * KDP's cover guidance says it in three words — "Flatten all transparencies" —
 * because a printer's RIP that meets a soft mask or a constant alpha can drop
 * or distort the content under it. The writer had been passing translucency
 * straight through: the ground figure on *The Manuscript Lectures* as an image
 * with an alpha channel drawn at 12%, Knapp's plate on *The Lost Keys* at 8%,
 * twenty-nine wave ribbons on *The Human Aura* at 2% each. Every one of them
 * is a live transparency in the file KDP receives.
 *
 * Flattening is what a print shop's flattener does, done here where the
 * composition is known: everything translucent, and everything beneath it, is
 * composited into one opaque raster at print resolution, and everything else
 * is drawn on top as it always was. Type stays type — embedded, sharp, and
 * selectable — and so do the rules and the barcode, whose bars would lose
 * their widths to rounding in a raster.
 *
 * That is only correct if nothing drawn on top was meant to be *under* what
 * went into the raster. Lifting a vector above a raster it used to lie beneath
 * changes the picture, so the plan checks for exactly that and refuses rather
 * than reordering in silence. No cover this composer makes does it — the
 * grounds are laid first and the type last — which is what makes the check a
 * guard and not a constraint anybody meets.
 *
 * Pure: it reads items and returns indices.
 */
import { BARCODE_ID, itemBounds, overlaps, type CoverItem } from './compose'

/** The resolution the background is composited at, which is KDP's minimum. */
export const FLATTEN_DPI = 300

export interface FlattenPlan {
  /** Painted, in order, into the opaque background raster. */
  raster: number[]
  /** Drawn on top of it, in order, as vectors. */
  vector: number[]
}

/** Whether an item carries transparency of any kind into the file. */
export function isTranslucent(item: CoverItem): boolean {
  // Every image is a PNG that may carry an alpha channel, and the marks and
  // grounds all do: a device is cut out of white, a ground is a picture of
  // ink with nothing round it. Treating each as translucent costs nothing,
  // since an opaque one composites to itself.
  if (item.kind === 'image') return true
  if (item.kind === 'fill' || item.kind === 'ornament') {
    return item.opacity !== undefined && item.opacity < 1
  }
  return false
}

/** What may go into the raster at all: the painted kinds, never the barcode. */
function rasterizable(item: CoverItem): boolean {
  if ('id' in item && item.id === BARCODE_ID) return false
  return item.kind === 'fill' || item.kind === 'image' || item.kind === 'ornament'
}

/**
 * Split the items into a background raster and the vectors drawn over it.
 *
 * The raster takes every paintable item up to and including the last
 * translucent one, because a translucent item composites with whatever lies
 * under it and that has to be in the same raster to be composited at all. A
 * cover with nothing translucent gets an empty raster and is written exactly
 * as before.
 *
 * Throws when a vector item that was painted *before* a raster item overlaps
 * it, since drawing that vector on top would put it above something it was
 * meant to be under.
 */
export function flattenPlan(items: readonly CoverItem[]): FlattenPlan {
  let last = -1
  items.forEach((item, i) => {
    if (isTranslucent(item)) last = i
  })
  if (last < 0) return { raster: [], vector: items.map((_, i) => i) }

  const raster: number[] = []
  const vector: number[] = []
  items.forEach((item, i) => {
    if (i <= last && rasterizable(item)) raster.push(i)
    else vector.push(i)
  })

  for (const v of vector) {
    const vb = itemBounds(items[v]!)
    if (!vb) continue
    for (const r of raster) {
      if (r <= v) continue
      // A raster item painted after this vector, and on top of it.
      const rb = itemBounds(items[r]!)
      if (rb && overlaps(vb, rb)) {
        const what =
          items[v]!.kind === 'text' ? `"${(items[v] as { text: string }).text}"` : items[v]!.kind
        throw new Error(
          `The cover cannot be flattened without changing it: ${what} lies under a ` +
            `${items[r]!.kind} that has to be composited into the background, and would end up above it.`
        )
      }
    }
  }
  return { raster, vector }
}
