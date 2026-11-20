/**
 * A ground texture from a file: a book's own picture printed faintly behind
 * the cover's type, in place of one of the built-in figures.
 *
 * The built-in figures (`figures.ts`) are the press's vector traces and live
 * in this public repository. A book's picture never does: it stays with the
 * book on the shelf, or in storage, and the cover command is given the file
 * at the moment it draws. So a texture is **content**, never banked with a
 * look, exactly as the cover's own art is: reusing one book's picture on an
 * unrelated book would be wrong, which is the banking rule's test.
 *
 * A cover spec names it in a `texture` block:
 *
 *     "texture": { "file": "plate.png", "placement": "on-rule",
 *                  "scale": 1, "align": { "x": 0, "y": 1 }, "opacity": 0.06 }
 *
 * - `placement`: where the box is. `front` bleeds off the front panel's three
 *   cut edges (the default); `framed` stands inside the front frame;
 *   `on-rule` sits on the frame's inner rule (`groundFigureOnRule`); `wrap`
 *   runs across the whole sheet.
 * - `scale`: 1 covers the box exactly (the picture's proportions decide which
 *   way it overflows); more draws it larger, cropped at the box.
 * - `align`: where the picture sits in the box when it overflows, 0 to 1 in
 *   each direction: `{ "x": 0, "y": 1 }` is its left edge and foot on the
 *   box's. The centre by default.
 * - `opacity`: the tint, clamped to the range every ground figure keeps
 *   (`figureOpacity`). The look's own `groundFigureOpacity` when left out.
 * - `toEdge`, `back`, `invert`: the look's `groundFigureToEdge`,
 *   `groundFigureBack` and `groundFigureInvert`, for this picture.
 *
 * The picture is tinted like every figure: its dark is the ink. Prepare it as
 * ink on white (`scripts/cover-texture.py`). A book's own text set as a field
 * (`scripts/textground.mjs`, an SVG) is a texture too, placed `wrap`: the
 * text is the book's, so it is made per book and never kept here.
 *
 * Pure: reading the spec and setting the document. The pixels are the
 * platform's.
 */
import type { CoverDocument } from './document'
import { figureOpacity } from './figures'

/** A picture from a file, placed as the cover's ground figure. */
export interface GroundTexture {
  /** Where the renderer fetches it: a data URL, or a URL the cover command serves. */
  src: string
  /** The file's own name, for the record and for messages. */
  fileName: string
  widthPx: number
  heightPx: number
  /** 1 covers the box exactly; more draws it larger, cropped at the box. */
  scale: number
  /** Where the picture sits in the box when it overflows, 0 (left) to 1 (right). */
  alignX: number
  /** The same, 0 (top) to 1 (foot). */
  alignY: number
}

export type TexturePlacement = 'front' | 'framed' | 'on-rule' | 'wrap'

export const TEXTURE_PLACEMENTS: readonly TexturePlacement[] = [
  'front',
  'framed',
  'on-rule',
  'wrap'
]

/** Past this a texture is a detail blown up, not a ground; the press shows the grain. */
export const MAX_TEXTURE_SCALE = 4

/** A spec's `texture` block, read and checked. */
export interface TextureSpec {
  file: string
  placement: TexturePlacement
  scale: number
  alignX: number
  alignY: number
  /** Null leaves the look's own tint. */
  opacity: number | null
  toEdge: boolean
  back: boolean
  invert: boolean
}

/** The picture files a texture may be: what a browser decodes and the writer embeds. */
export const TEXTURE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  // A vector field, such as the text ground `scripts/textground.mjs` makes.
  svg: 'image/svg+xml'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fraction(v: unknown, name: string, problems: string[]): number {
  if (v === undefined) return 0.5
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) return v
  problems.push(`texture.align.${name} must be a number from 0 to 1.`)
  return 0.5
}

function flag(raw: Record<string, unknown>, key: string, problems: string[]): boolean {
  const v = raw[key]
  if (v === undefined) return false
  if (typeof v === 'boolean') return v
  problems.push(`texture.${key} must be true or false.`)
  return false
}

/**
 * Read a spec's `texture` block. Every fault is named, so a typesetter is told
 * what to fix rather than given a cover that quietly ignored half the block.
 */
export function readTextureSpec(raw: unknown): { spec: TextureSpec | null; problems: string[] } {
  const problems: string[] = []
  if (!isRecord(raw)) return { spec: null, problems: ['texture must be an object.'] }
  const file = typeof raw['file'] === 'string' ? raw['file'].trim() : ''
  if (!file) problems.push('texture.file must name the picture file.')
  const ext = file.toLowerCase().split('.').pop() ?? ''
  if (file && !(ext in TEXTURE_TYPES)) {
    problems.push(`texture.file must be a ${Object.keys(TEXTURE_TYPES).join(', ')} file.`)
  }
  const placement = raw['placement'] ?? 'front'
  if (!(TEXTURE_PLACEMENTS as readonly unknown[]).includes(placement)) {
    problems.push(`texture.placement must be one of ${TEXTURE_PLACEMENTS.join(', ')}.`)
  }
  const scale = raw['scale'] ?? 1
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 1) {
    problems.push('texture.scale must be a number of at least 1 (1 covers the box).')
  } else if (scale > MAX_TEXTURE_SCALE) {
    problems.push(`texture.scale may be at most ${MAX_TEXTURE_SCALE}.`)
  }
  const align = raw['align'] ?? {}
  if (!isRecord(align)) problems.push('texture.align must be an object with x and y.')
  const alignRecord = isRecord(align) ? align : {}
  const alignX = fraction(alignRecord['x'], 'x', problems)
  const alignY = fraction(alignRecord['y'], 'y', problems)
  const opacity = raw['opacity']
  if (opacity !== undefined && (typeof opacity !== 'number' || !Number.isFinite(opacity))) {
    problems.push('texture.opacity must be a number.')
  }
  const toEdge = flag(raw, 'toEdge', problems)
  const back = flag(raw, 'back', problems)
  const invert = flag(raw, 'invert', problems)
  if (problems.length > 0) return { spec: null, problems }
  return {
    spec: {
      file,
      placement: placement as TexturePlacement,
      scale: scale as number,
      alignX,
      alignY,
      opacity: typeof opacity === 'number' ? opacity : null,
      toEdge,
      back,
      invert
    },
    problems
  }
}

/**
 * The cover with this texture as its ground figure.
 *
 * The placement sets the look's own switches, so the composer places a texture
 * by exactly the rules it places a built-in figure by: there is one box for a
 * framed figure, not two that could come to disagree. The built-in figure is
 * cleared, since a cover carries one ground figure.
 */
export function applyTexture(
  doc: CoverDocument,
  spec: TextureSpec,
  image: { src: string; fileName: string; widthPx: number; heightPx: number }
): CoverDocument {
  const placement = spec.placement
  return {
    ...doc,
    look: {
      ...doc.look,
      groundFigure: null,
      groundFigureWrap: placement === 'wrap',
      groundFigureInFrame: placement === 'framed' || placement === 'on-rule',
      groundFigureOnRule: placement === 'on-rule',
      groundFigureToEdge: spec.toEdge,
      groundFigureBack: spec.back,
      groundFigureInvert: spec.invert,
      groundFigureOpacity:
        spec.opacity === null ? doc.look.groundFigureOpacity : figureOpacity(spec.opacity)
    },
    content: {
      ...doc.content,
      groundTexture: {
        src: image.src,
        fileName: image.fileName,
        widthPx: image.widthPx,
        heightPx: image.heightPx,
        scale: spec.scale,
        alignX: spec.alignX,
        alignY: spec.alignY
      }
    }
  }
}

/**
 * Where a picture drawn `drawn` long sits in a box `box` long, aligned at
 * `align` (0 to 1): the offset of its start from the box's. A picture that
 * overflows is cropped evenly at 0.5, at its far end at 0, at its near end
 * at 1.
 */
export function alignedOffset(box: number, drawn: number, align: number): number {
  const a = Math.min(1, Math.max(0, align))
  return (box - drawn) * a
}
