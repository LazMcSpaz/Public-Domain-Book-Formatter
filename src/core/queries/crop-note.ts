/**
 * Where the passage is in a query's crop, carried inside the crop itself.
 *
 * A phone shows a crop at reading size, which is wider than the screen, and it
 * should open scrolled to the passage rather than to the left margin. So the
 * screen has to know where the passage is, and the crop is the only thing it
 * fetches: one file per query, named by the query (`queryCropPath`). The
 * position therefore travels in the JPEG as a comment segment, which every
 * viewer ignores, rather than in a second file beside it that could go
 * missing or disagree.
 *
 * A crop with no note (every crop cut before this) is still a crop: the screen
 * shows it at reading size from the left, as it would any other.
 *
 * Pure: bytes in, bytes out.
 */
import type { CropBox } from './crop-plan'

/** What a crop says about itself. */
export interface CropNote {
  /** The resolution it was cut at, so the screen can show it at reading size. */
  dpi: number
  /** The passage, one box per printed line, in the crop's own pixels. */
  passage: CropBox[]
}

/** Our comments start with this, so another program's comment is never misread. */
const MARK = 'pdbf-crop '

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0) & 0x7f)

/**
 * The same JPEG with the note in a comment segment right after its start.
 *
 * Bytes that are not a JPEG come back unchanged: the note is a convenience,
 * and refusing a crop for want of one would cost the pixels.
 */
export function withCropNote(jpeg: Uint8Array, note: CropNote): Uint8Array {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg
  const round = (n: number): number => Math.round(n)
  const body = ascii(
    MARK +
      JSON.stringify({
        dpi: round(note.dpi),
        passage: note.passage.map((b) => [round(b.x0), round(b.y0), round(b.x1), round(b.y1)])
      })
  )
  const length = body.length + 2
  if (length > 0xffff) return jpeg
  const out = new Uint8Array(jpeg.length + 2 + length)
  out.set([0xff, 0xd8, 0xff, 0xfe, length >> 8, length & 0xff])
  out.set(body, 6)
  out.set(jpeg.subarray(2), 6 + body.length)
  return out
}

/** The note a crop carries, or null when it carries none (or is not a JPEG). */
export function readCropNote(bytes: Uint8Array): CropNote | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let at = 2
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!
    // The picture data starts, or the file ends: no note before it.
    if (marker === 0xda || marker === 0xd9) return null
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!
    if (length < 2) return null
    if (marker === 0xfe && ascii(MARK).every((c, i) => bytes[at + 4 + i] === c)) {
      let text = ''
      for (let i = at + 4 + MARK.length; i < at + 2 + length && i < bytes.length; i++) {
        text += String.fromCharCode(bytes[i]!)
      }
      return parse(text)
    }
    at += 2 + length
  }
  return null
}

function parse(text: string): CropNote | null {
  try {
    const raw = JSON.parse(text) as { dpi?: unknown; passage?: unknown }
    if (typeof raw.dpi !== 'number' || raw.dpi <= 0 || !Array.isArray(raw.passage)) return null
    const passage = raw.passage.flatMap((b: unknown) =>
      Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number')
        ? [{ x0: b[0] as number, y0: b[1] as number, x1: b[2] as number, y1: b[3] as number }]
        : []
    )
    return { dpi: raw.dpi, passage }
  } catch {
    return null
  }
}
