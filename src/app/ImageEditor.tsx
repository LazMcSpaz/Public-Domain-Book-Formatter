/**
 * The image-editing mode of SPEC §6 — "the real instrument".
 *
 * Auto-extraction from old scans is unreliable, which the spec says plainly, so
 * the detector's crop is a first guess and this is where it is corrected. The
 * tools here are the ones that matter for scanned paper: a crop that can be
 * dragged, a straighten for a leaf that went through the scanner crooked, and
 * the tone controls that rescue a picture printed on foxed, yellowed stock.
 *
 * **Non-destructive.** Nothing here writes pixels. Every control appends to an
 * op *stack* that is re-applied over the original bytes each time it changes,
 * so any of it can be dragged back, removed, or reordered without loss — and
 * the original the crop was cut from is still there underneath.
 *
 * Left out on purpose: background removal. The spec calls it best-effort and it
 * is — reliable on clean uniform paper and unreliable on anything foxed or
 * unevenly lit — and offering it without the manual touch-up of the selection
 * that would make it honest would be offering a magic button that quietly eats
 * part of the picture.
 */
import { useMemo, useRef, useState } from 'react'
import {
  brightness,
  contrast,
  crop,
  despeckle,
  grayscale,
  levels,
  straighten,
  threshold
} from '@core/image'
import type { ImageEditOp } from '@core/model'

export interface ImageEditorProps {
  /** A preview URL for the *retouched* picture, so the controls show their work. */
  previewUrl: string | undefined
  /**
   * The picture's **original** pixel size.
   *
   * The crop is expressed against this and nothing else, because the stack is
   * re-applied over the original every time: a second drag replaces the first
   * crop rather than cropping the crop. Measuring against the retouched size
   * would put every crop after the first in the wrong place.
   */
  sourceWidth: number
  sourceHeight: number
  /** What the stack currently leaves it at — the pixels the book will print. */
  currentWidth: number
  currentHeight: number
  ops: ImageEditOp[]
  onChange: (ops: ImageEditOp[]) => void
}

/** A crop rectangle in the picture's own pixels. */
interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** The single op of a kind in the stack, if there is one. */
function opOf(ops: readonly ImageEditOp[], kind: ImageEditOp['op']): ImageEditOp | undefined {
  return ops.find((o) => o.op === kind)
}

function numberOf(op: ImageEditOp | undefined, key: string, fallback: number): number {
  const value = op?.params[key]
  return typeof value === 'number' ? value : fallback
}

/**
 * Replace (or remove) the one op of a kind, keeping the stack's order.
 *
 * One op per kind: two brightness ops in a stack is not a thing a slider can
 * express, and re-applying a whole stack means the second would simply win.
 * Order is preserved so that a crop stays before or after a rotate as the user
 * set it — the two do not commute.
 */
function withOp(
  ops: readonly ImageEditOp[],
  kind: ImageEditOp['op'],
  next: ImageEditOp | null
): ImageEditOp[] {
  const without = ops.filter((o) => o.op !== kind)
  return next === null ? without : [...without, next]
}

export function ImageEditor({
  previewUrl,
  sourceWidth,
  sourceHeight,
  currentWidth,
  currentHeight,
  ops,
  onChange
}: ImageEditorProps): JSX.Element {
  const frame = useRef<HTMLDivElement>(null)
  /**
   * Where the drag began, kept apart from the rectangle it has grown into.
   *
   * The rectangle is always normalised — x,y is its top-left whichever way the
   * pointer went — so it cannot double as the anchor: after the first move
   * up-and-left the anchor would have been overwritten by the corner.
   */
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState<CropRect | null>(null)

  const cropOp = opOf(ops, 'crop')
  const current: CropRect | null = cropOp
    ? {
        x: numberOf(cropOp, 'x', 0),
        y: numberOf(cropOp, 'y', 0),
        width: numberOf(cropOp, 'width', sourceWidth),
        height: numberOf(cropOp, 'height', sourceHeight)
      }
    : null

  const skew = numberOf(opOf(ops, 'straighten'), 'degrees', 0)
  const bright = numberOf(opOf(ops, 'brightness'), 'amount', 0)
  const contrastAmount = numberOf(opOf(ops, 'contrast'), 'amount', 0)
  const levelsOp = opOf(ops, 'levels')
  const black = numberOf(levelsOp, 'black', 0)
  const white = numberOf(levelsOp, 'white', 255)
  const speck = numberOf(opOf(ops, 'despeckle'), 'radius', 0)
  const isGray = opOf(ops, 'grayscale') !== undefined
  const thresholdOp = opOf(ops, 'threshold')

  const set = (kind: ImageEditOp['op'], next: ImageEditOp | null): void =>
    onChange(withOp(ops, kind, next))

  /**
   * Drag a crop over the preview.
   *
   * Expressed in the picture's own pixels rather than in screen ones, so it
   * survives the panel being resized and means the same thing at any zoom.
   *
   * The crop is always measured against the *uncropped* original, because the
   * stack is re-applied from the original every time — dragging a second crop
   * replaces the first rather than cropping the crop.
   */
  const pointToPixels = (clientX: number, clientY: number): { x: number; y: number } => {
    const box = frame.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(sourceWidth, ((clientX - box.left) / box.width) * sourceWidth)),
      y: Math.max(0, Math.min(sourceHeight, ((clientY - box.top) / box.height) * sourceHeight))
    }
  }

  const startDrag = (e: React.PointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const from = pointToPixels(e.clientX, e.clientY)
    anchor.current = from
    setDragging({ x: from.x, y: from.y, width: 0, height: 0 })
  }

  const moveDrag = (e: React.PointerEvent): void => {
    const from = anchor.current
    if (!from) return
    const to = pointToPixels(e.clientX, e.clientY)
    setDragging({
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y)
    })
  }

  const endDrag = (): void => {
    anchor.current = null
    if (!dragging) return
    const rect = dragging
    setDragging(null)
    // A click rather than a drag: too small to be a crop anyone meant.
    if (rect.width < sourceWidth * 0.04 || rect.height < sourceHeight * 0.04) return
    set(
      'crop',
      crop({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    )
  }

  /** The crop box in per-cent, for drawing it over the preview. */
  const boxStyle = useMemo(() => {
    const rect = dragging ?? current
    if (!rect || sourceWidth === 0 || sourceHeight === 0) return null
    return {
      left: `${(rect.x / sourceWidth) * 100}%`,
      top: `${(rect.y / sourceHeight) * 100}%`,
      width: `${(rect.width / sourceWidth) * 100}%`,
      height: `${(rect.height / sourceHeight) * 100}%`
    }
  }, [dragging, current, sourceWidth, sourceHeight])

  return (
    <div className="editor">
      <div
        className="editor-canvas"
        ref={frame}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {previewUrl ? <img src={previewUrl} alt="The picture as it will print" /> : null}
        {/* The box is drawn over the *retouched* preview, so once a crop is
            applied the picture already is the crop and the box is the whole of
            it. It is shown while dragging, which is when it is needed. */}
        {dragging && boxStyle ? <div className="editor-crop" style={boxStyle} /> : null}
      </div>

      {/* The pixel count rather than a DPI, because the printed size is not
          settled until the design gate and a number invented here would be
          wrong. This one is real, and it is what shrinks when you crop. */}
      <p className="editor-hint">
        Drag across the picture to crop it. The book gets{' '}
        <b>
          {currentWidth}×{currentHeight}
        </b>{' '}
        pixels
        {currentWidth < sourceWidth || currentHeight < sourceHeight ? (
          <>
            {' '}
            of the original {sourceWidth}×{sourceHeight}.
          </>
        ) : (
          '.'
        )}
      </p>

      <div className="editor-controls">
        <label>
          Straighten
          <input
            type="range"
            min={-6}
            max={6}
            step={0.25}
            value={skew}
            onChange={(e) => {
              const degrees = Number(e.target.value)
              set('straighten', degrees === 0 ? null : straighten(degrees))
            }}
          />
          <span>{skew.toFixed(2)}°</span>
        </label>

        <label>
          Brightness
          <input
            type="range"
            min={-60}
            max={60}
            value={bright}
            onChange={(e) => {
              const amount = Number(e.target.value)
              set('brightness', amount === 0 ? null : brightness(amount))
            }}
          />
          <span>{bright}</span>
        </label>

        <label>
          Contrast
          <input
            type="range"
            min={-60}
            max={60}
            value={contrastAmount}
            onChange={(e) => {
              const amount = Number(e.target.value)
              set('contrast', amount === 0 ? null : contrast(amount))
            }}
          />
          <span>{contrastAmount}</span>
        </label>

        {/* The one that actually rescues a foxed scan: the ink is grey and the
            paper is beige, and pulling the two points in makes it a picture. */}
        <label>
          Black point
          <input
            type="range"
            min={0}
            max={200}
            value={black}
            onChange={(e) =>
              set('levels', levels({ black: Number(e.target.value), white, gamma: 1 }))
            }
          />
          <span>{black}</span>
        </label>

        <label>
          White point
          <input
            type="range"
            min={55}
            max={255}
            value={white}
            onChange={(e) =>
              set('levels', levels({ black, white: Number(e.target.value), gamma: 1 }))
            }
          />
          <span>{white}</span>
        </label>

        <label>
          Despeckle
          <input
            type="range"
            min={0}
            max={3}
            value={speck}
            onChange={(e) => {
              const radius = Number(e.target.value)
              set('despeckle', radius === 0 ? null : despeckle(radius))
            }}
          />
          <span>{speck === 0 ? 'off' : `${speck}px`}</span>
        </label>
      </div>

      <div className="editor-toggles">
        <label>
          <input
            type="checkbox"
            checked={isGray}
            onChange={(e) => set('grayscale', e.target.checked ? grayscale() : null)}
          />
          Grey (drops the paper’s colour cast)
        </label>
        <label>
          <input
            type="checkbox"
            checked={thresholdOp !== undefined}
            onChange={(e) => set('threshold', e.target.checked ? threshold(128) : null)}
          />
          Pure black and white (for line art)
        </label>
        {thresholdOp ? (
          <label className="editor-threshold">
            Cut at
            <input
              type="range"
              min={40}
              max={220}
              value={numberOf(thresholdOp, 'level', 128)}
              onChange={(e) => set('threshold', threshold(Number(e.target.value)))}
            />
            <span>{numberOf(thresholdOp, 'level', 128)}</span>
          </label>
        ) : null}
      </div>

      {ops.length > 0 ? (
        <button type="button" className="editor-reset" onClick={() => onChange([])}>
          Undo every edit — the original is still underneath
        </button>
      ) : null}
    </div>
  )
}
