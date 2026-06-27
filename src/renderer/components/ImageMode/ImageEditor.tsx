/**
 * ImageEditor — the non-destructive, full-resolution image-editing mode
 * (SPEC §6 "Image-editing mode (the real instrument)").
 *
 * Mounted once at the review root by the integrator; it reads
 * `state.activeImageRegion` itself and renders null when the editor is closed.
 *
 * Pixel pipeline (always re-derived, never destructive):
 *   1. On open, resolve the active region + its page.
 *   2. `getPageImage(projectPath, page.imagePath)` → a base64 data URL of the
 *      FULL-RES page (not a downsized preview).
 *   3. `cropImage(dataUrl, region.bbox)` → the original working image at full res.
 *   4. Decode it onto an offscreen canvas, `getImageData`, `fromImageData` → the
 *      immutable ORIGINAL `RasterImage`.
 *   5. Hold a local `ImageEditOp[]`, seeded from `project.imageEdits` for this
 *      region. Every change recomputes preview = `applyOps(original, ops)` and
 *      paints `toImageData(...)` to the visible <canvas>.
 *   6. Save → `SET_IMAGE_EDITS` + `CLOSE_IMAGE_EDITOR`. Cancel → close, discard.
 *
 * Tools build ops via the engine op constructors. Reliable tools just work;
 * background removal is clearly labeled best-effort (SPEC §6).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { ImageEditOp, ImageRegion, SourcePage } from '@core/model'
import { effectiveDpi, dpiStatus } from '@core/image'
// NOTE: the engine barrel re-exports both the op *constructors* (ops.ts) and the
// pixel op *functions* (apply-ops.ts) under the same names, so importing e.g.
// `crop` from './engine' is ambiguous and won't compile. We only import the
// unambiguous bridge/runner symbols here and build the persisted `ImageEditOp`
// records (plain `{op, params}`) ourselves — that is exactly their serialized
// shape, and it keeps this UI decoupled from the engine's internal churn.
import { applyOps, fromImageData, toImageData, type RasterImage } from './engine'
import { useReview } from '../../store/ReviewContext'
import { cropImage } from '../../utils/crop-image'
import { MIN_PRINT_DPI, trimWidthInches } from './dpi'
import { CurveEditor, IDENTITY_CURVE, isIdentityCurve, type CurvePoint } from './CurveEditor'
import './ImageEditor.css'

// --- Local op-record builders (the serializable form of each edit, SPEC §6) ---
const opCrop = (p: { x: number; y: number; width: number; height: number }): ImageEditOp => ({
  op: 'crop',
  params: { ...p }
})
const opRotate = (degrees: number): ImageEditOp => ({ op: 'rotate', params: { degrees } })
const opStraighten = (degrees: number): ImageEditOp => ({ op: 'straighten', params: { degrees } })
const opBrightness = (amount: number): ImageEditOp => ({ op: 'brightness', params: { amount } })
const opContrast = (amount: number): ImageEditOp => ({ op: 'contrast', params: { amount } })
const opLevels = (p: { black: number; white: number; gamma: number }): ImageEditOp => ({
  op: 'levels',
  params: { ...p }
})
const opCurves = (points: readonly CurvePoint[]): ImageEditOp => ({
  op: 'curves',
  params: { points: JSON.stringify(points) }
})
const opGrayscale = (): ImageEditOp => ({ op: 'grayscale', params: {} })
const opThreshold = (level: number): ImageEditOp => ({ op: 'threshold', params: { level } })
const opDespeckle = (radius: number): ImageEditOp => ({ op: 'despeckle', params: { radius } })
const opRemoveBackground = (tolerance: number): ImageEditOp => ({
  op: 'removeBackground',
  params: { tolerance }
})

/** Decode a data URL into a RasterImage via an offscreen canvas. */
function decodeToRaster(dataUrl: string): Promise<RasterImage> {
  return new Promise<RasterImage>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('ImageEditor: 2D canvas context unavailable'))
          return
        }
        ctx.drawImage(img, 0, 0)
        resolve(fromImageData(ctx.getImageData(0, 0, w, h)))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    img.onerror = () => reject(new Error('ImageEditor: failed to decode region image'))
    img.src = dataUrl
  })
}

function findRegion(
  pages: SourcePage[],
  pageIndex: number,
  regionId: string
): { page: SourcePage; region: ImageRegion } | null {
  const page = pages.find((p) => p.index === pageIndex)
  if (!page) return null
  const region = page.regions.find((r) => r.id === regionId)
  if (!region) return null
  return { page, region }
}

/** Slider tool state, kept separate from the persisted op list. */
interface ToolState {
  rotation: number // accumulated 90° turns, degrees
  straighten: number // fine de-skew, degrees
  brightness: number
  contrast: number
  black: number
  white: number
  gamma: number
  grayscale: boolean
  threshold: number | null // null = off
  despeckle: number // radius, 0 = off
  removeBg: number | null // tolerance, null = off
}

const DEFAULT_TOOLS: ToolState = {
  rotation: 0,
  straighten: 0,
  brightness: 0,
  contrast: 0,
  black: 0,
  white: 255,
  gamma: 1,
  grayscale: false,
  threshold: null,
  despeckle: 0,
  removeBg: null
}

/** Crop rect in original-image pixel space (null = no crop). */
interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Compose the persisted op list from tool state + crop. Order matters: geometry
 * (crop/rotate/straighten) first, then tonal, then conversion, then cleanup,
 * then best-effort background removal last.
 */
function buildOps(
  tools: ToolState,
  cropRect: CropRect | null,
  curve: readonly CurvePoint[]
): ImageEditOp[] {
  const ops: ImageEditOp[] = []
  if (cropRect) ops.push(opCrop(cropRect))
  if (tools.rotation % 360 !== 0) ops.push(opRotate(tools.rotation))
  if (tools.straighten !== 0) ops.push(opStraighten(tools.straighten))
  if (tools.brightness !== 0) ops.push(opBrightness(tools.brightness))
  if (tools.contrast !== 0) ops.push(opContrast(tools.contrast))
  if (tools.black !== 0 || tools.white !== 255 || tools.gamma !== 1) {
    ops.push(opLevels({ black: tools.black, white: tools.white, gamma: tools.gamma }))
  }
  if (!isIdentityCurve(curve)) ops.push(opCurves(curve))
  if (tools.grayscale) ops.push(opGrayscale())
  if (tools.threshold !== null) ops.push(opThreshold(tools.threshold))
  if (tools.despeckle > 0) ops.push(opDespeckle(tools.despeckle))
  if (tools.removeBg !== null) ops.push(opRemoveBackground(tools.removeBg))
  return ops
}

export function ImageEditor(): JSX.Element | null {
  const { state, dispatch } = useReview()
  const active = state.activeImageRegion
  const project = state.project
  const projectPath = state.projectPath

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const originalRef = useRef<RasterImage | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tools, setTools] = useState<ToolState>(DEFAULT_TOOLS)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  const [curve, setCurve] = useState<CurvePoint[]>(IDENTITY_CURVE)
  const [cropDraw, setCropDraw] = useState(false)
  const [drawRect, setDrawRect] = useState<CropRect | null>(null)
  const [originalDims, setOriginalDims] = useState<{ width: number; height: number } | null>(null)
  // Bumps whenever the decoded original is ready, to retrigger the preview paint.
  const [ready, setReady] = useState(0)

  // Resolve the active region (and any saved curve points) for the open editor.
  const resolved =
    active && project ? findRegion(project.pages, active.pageIndex, active.regionId) : null

  const savedOps = useMemo<ImageEditOp[]>(() => {
    if (!active || !project) return []
    return project.imageEdits.find((e) => e.regionId === active.regionId)?.ops ?? []
  }, [active, project])

  // --- Open: pull original full-res pixels and seed tool state from saved ops.
  useEffect(() => {
    if (!active || !resolved || !projectPath) {
      originalRef.current = null
      setOriginalDims(null)
      return
    }
    const imagePath = resolved.page.imagePath
    if (!imagePath) {
      setError('This page has no source image to edit.')
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setTools(seedTools(savedOps))
    setCropRect(seedCrop(savedOps))
    setCurve(seedCurve(savedOps))
    setCropDraw(false)
    setDrawRect(null)

    window.api
      .getPageImage(projectPath, imagePath)
      .then((dataUrl) => cropImage(dataUrl, resolved.region.bbox))
      .then((regionUrl) => decodeToRaster(regionUrl))
      .then((raster) => {
        if (cancelled) return
        originalRef.current = raster
        setOriginalDims({ width: raster.width, height: raster.height })
        setLoading(false)
        setReady((n) => n + 1)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        originalRef.current = null
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.regionId, active?.pageIndex, projectPath])

  // Effective op list = geometry/tonal/etc from sliders + the tone curve.
  const ops = useMemo<ImageEditOp[]>(
    () => buildOps(tools, cropRect, curve),
    [tools, cropRect, curve]
  )

  // --- Live preview: paint to the visible canvas. In crop-draw mode we show the
  // UNCROPPED original (so a dragged selection maps 1:1 to original pixels) and
  // overlay the in-progress selection rectangle.
  useEffect(() => {
    const original = originalRef.current
    const canvas = canvasRef.current
    if (!original || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (cropDraw) {
      canvas.width = original.width
      canvas.height = original.height
      ctx.putImageData(toImageData(original), 0, 0)
      if (drawRect) {
        ctx.save()
        ctx.lineWidth = Math.max(1, original.width / 300)
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = '#d9534f'
        ctx.fillStyle = 'rgba(217,83,79,0.12)'
        ctx.fillRect(drawRect.x, drawRect.y, drawRect.width, drawRect.height)
        ctx.strokeRect(drawRect.x, drawRect.y, drawRect.width, drawRect.height)
        ctx.restore()
      }
      return
    }

    const result = applyOps(original, ops)
    canvas.width = result.width
    canvas.height = result.height
    ctx.putImageData(toImageData(result), 0, 0)
  }, [ops, ready, cropDraw, drawRect])

  // DPI badge: source pixel width of the current crop placed at the book width.
  const placedWidthIn = trimWidthInches(project?.config.trimSize)
  const currentPixelWidth = cropRect?.width ?? originalDims?.width ?? 0
  const dpi = currentPixelWidth > 0 ? effectiveDpi(currentPixelWidth, placedWidthIn) : null
  const dpiLow = dpi !== null && dpiStatus(dpi, MIN_PRINT_DPI) === 'warn'

  if (!active) return null

  const patch = (p: Partial<ToolState>): void => setTools((t) => ({ ...t, ...p }))
  const num = (e: ChangeEvent<HTMLInputElement>): number => Number(e.target.value)

  const handleSave = (): void => {
    dispatch({ type: 'SET_IMAGE_EDITS', regionId: active.regionId, ops })
    dispatch({ type: 'CLOSE_IMAGE_EDITOR' })
  }
  const handleCancel = (): void => dispatch({ type: 'CLOSE_IMAGE_EDITOR' })
  const handleReset = (): void => {
    setTools(DEFAULT_TOOLS)
    setCropRect(null)
    setCurve(IDENTITY_CURVE)
  }

  // Drag a crop rectangle directly on the canvas. Coordinates map 1:1 to the
  // original because crop-draw mode shows the uncropped original at native size.
  const cropPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
    if (!cropDraw || !canvas || !originalDims) return
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    const x0 = (e.clientX - rect.left) * sx
    const y0 = (e.clientY - rect.top) * sy
    const at = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi))
    const move = (ev: globalThis.PointerEvent): void => {
      const x1 = at((ev.clientX - rect.left) * sx, 0, canvas.width)
      const y1 = at((ev.clientY - rect.top) * sy, 0, canvas.height)
      setDrawRect({
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0)
      })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrawRect((r) => {
        if (r && r.width >= 4 && r.height >= 4) {
          setCropRect(
            withCrop(null, originalDims, {
              x: Math.round(r.x),
              y: Math.round(r.y),
              width: Math.round(r.width),
              height: Math.round(r.height)
            })
          )
        }
        return null
      })
      setCropDraw(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="image-editor" role="dialog" aria-modal="true" aria-label="Image editor">
      <div className="image-editor__bar">
        <div className="image-editor__title">
          Image editor
          <span className="image-editor__hint">
            full-resolution · non-destructive (re-derived from the original)
          </span>
        </div>
        <div className="image-editor__bar-actions">
          <button type="button" className="ie-btn" onClick={handleReset}>
            Reset edits
          </button>
          <button type="button" className="ie-btn" onClick={handleCancel}>
            Cancel
          </button>
          <button type="button" className="ie-btn ie-btn--primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>

      <div className="image-editor__body">
        <div className="image-editor__stage">
          {loading && <div className="image-editor__status">Loading full-resolution image…</div>}
          {error && <div className="image-editor__status image-editor__status--err">{error}</div>}
          <canvas
            ref={canvasRef}
            className={`image-editor__canvas${cropDraw ? ' image-editor__canvas--crop' : ''}`}
            onPointerDown={cropPointerDown}
          />
          {cropDraw && (
            <div className="image-editor__crophint">Drag to select the crop · Esc/Save to apply</div>
          )}

          {originalDims && (
            <div
              className={`image-editor__dpi${dpiLow ? ' image-editor__dpi--warn' : ''}`}
              title={`Placed at ~${placedWidthIn}in wide`}
            >
              {dpi === null ? 'DPI: n/a' : `${Math.round(dpi)} DPI`}
              {dpiLow && ` · below ${MIN_PRINT_DPI} (may print muddy)`}
            </div>
          )}
        </div>

        <aside className="image-editor__tools">
          <section className="ie-group">
            <h3 className="ie-group__title">Geometry</h3>
            <div className="ie-row">
              <button
                type="button"
                className="ie-btn"
                onClick={() => patch({ rotation: tools.rotation - 90 })}
              >
                ⟲ 90°
              </button>
              <button
                type="button"
                className="ie-btn"
                onClick={() => patch({ rotation: tools.rotation + 90 })}
              >
                ⟳ 90°
              </button>
            </div>
            <label className="ie-field">
              Straighten ({tools.straighten}°)
              <input
                type="range"
                min={-15}
                max={15}
                step={0.5}
                value={tools.straighten}
                onChange={(e) => patch({ straighten: num(e) })}
              />
            </label>

            <fieldset className="ie-field ie-crop">
              <legend>Crop (px, source space)</legend>
              <button
                type="button"
                className={`ie-btn ie-btn--small${cropDraw ? ' ie-btn--active' : ''}`}
                onClick={() => {
                  setDrawRect(null)
                  setCropDraw((on) => !on)
                }}
                disabled={!originalDims}
              >
                {cropDraw ? 'Cancel draw' : 'Draw crop on image'}
              </button>
              {originalDims && (
                <div className="ie-crop__grid">
                  <label>
                    x
                    <input
                      type="number"
                      min={0}
                      value={cropRect?.x ?? 0}
                      onChange={(e) =>
                        setCropRect((c) => withCrop(c, originalDims, { x: Number(e.target.value) }))
                      }
                    />
                  </label>
                  <label>
                    y
                    <input
                      type="number"
                      min={0}
                      value={cropRect?.y ?? 0}
                      onChange={(e) =>
                        setCropRect((c) => withCrop(c, originalDims, { y: Number(e.target.value) }))
                      }
                    />
                  </label>
                  <label>
                    w
                    <input
                      type="number"
                      min={1}
                      value={cropRect?.width ?? originalDims.width}
                      onChange={(e) =>
                        setCropRect((c) =>
                          withCrop(c, originalDims, { width: Number(e.target.value) })
                        )
                      }
                    />
                  </label>
                  <label>
                    h
                    <input
                      type="number"
                      min={1}
                      value={cropRect?.height ?? originalDims.height}
                      onChange={(e) =>
                        setCropRect((c) =>
                          withCrop(c, originalDims, { height: Number(e.target.value) })
                        )
                      }
                    />
                  </label>
                </div>
              )}
              {cropRect && (
                <button type="button" className="ie-btn ie-btn--small" onClick={() => setCropRect(null)}>
                  Clear crop
                </button>
              )}
            </fieldset>
          </section>

          <section className="ie-group">
            <h3 className="ie-group__title">Tone</h3>
            <label className="ie-field">
              Brightness ({tools.brightness})
              <input
                type="range"
                min={-100}
                max={100}
                value={tools.brightness}
                onChange={(e) => patch({ brightness: num(e) })}
              />
            </label>
            <label className="ie-field">
              Contrast ({tools.contrast})
              <input
                type="range"
                min={-100}
                max={100}
                value={tools.contrast}
                onChange={(e) => patch({ contrast: num(e) })}
              />
            </label>
            <label className="ie-field">
              Levels — black ({tools.black})
              <input
                type="range"
                min={0}
                max={254}
                value={tools.black}
                onChange={(e) => patch({ black: Math.min(num(e), tools.white - 1) })}
              />
            </label>
            <label className="ie-field">
              Levels — white ({tools.white})
              <input
                type="range"
                min={1}
                max={255}
                value={tools.white}
                onChange={(e) => patch({ white: Math.max(num(e), tools.black + 1) })}
              />
            </label>
            <label className="ie-field">
              Gamma ({tools.gamma.toFixed(2)})
              <input
                type="range"
                min={0.1}
                max={3}
                step={0.05}
                value={tools.gamma}
                onChange={(e) => patch({ gamma: num(e) })}
              />
            </label>
            <div className="ie-field">
              <div className="ie-curve-head">
                <span>Tone curve</span>
                {!isIdentityCurve(curve) && (
                  <button
                    type="button"
                    className="ie-btn ie-btn--small"
                    onClick={() => setCurve(IDENTITY_CURVE)}
                  >
                    Reset curve
                  </button>
                )}
              </div>
              <CurveEditor points={curve} onChange={setCurve} />
            </div>
          </section>

          <section className="ie-group">
            <h3 className="ie-group__title">Line art</h3>
            <label className="ie-field ie-field--check">
              <input
                type="checkbox"
                checked={tools.grayscale}
                onChange={(e) => patch({ grayscale: e.target.checked })}
              />
              Grayscale
            </label>
            <label className="ie-field ie-field--check">
              <input
                type="checkbox"
                checked={tools.threshold !== null}
                onChange={(e) => patch({ threshold: e.target.checked ? 128 : null })}
              />
              Threshold (binarize)
            </label>
            {tools.threshold !== null && (
              <label className="ie-field">
                Threshold level ({tools.threshold})
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={tools.threshold}
                  onChange={(e) => patch({ threshold: num(e) })}
                />
              </label>
            )}
            <label className="ie-field">
              Despeckle radius ({tools.despeckle})
              <input
                type="range"
                min={0}
                max={5}
                value={tools.despeckle}
                onChange={(e) => patch({ despeckle: num(e) })}
              />
            </label>
          </section>

          <section className="ie-group ie-group--besteffort">
            <h3 className="ie-group__title">
              Background removal <span className="ie-badge">best-effort</span>
            </h3>
            <p className="ie-note">
              Reliable on clean, uniform backgrounds (line art on cream paper); unreliable on
              busy or unevenly-lit scans. Treat as an accelerator and touch up manually.
            </p>
            <label className="ie-field ie-field--check">
              <input
                type="checkbox"
                checked={tools.removeBg !== null}
                onChange={(e) => patch({ removeBg: e.target.checked ? 32 : null })}
              />
              Remove background
            </label>
            {tools.removeBg !== null && (
              <label className="ie-field">
                Tolerance ({tools.removeBg})
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={tools.removeBg}
                  onChange={(e) => patch({ removeBg: num(e) })}
                />
              </label>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seeding helpers — rebuild slider state from a persisted op list on open.
// ---------------------------------------------------------------------------

function numParam(op: ImageEditOp | undefined, key: string, fallback: number): number {
  const v = op?.params[key]
  return typeof v === 'number' ? v : fallback
}

function seedTools(savedOps: readonly ImageEditOp[]): ToolState {
  const by = (kind: string): ImageEditOp | undefined => savedOps.find((o) => o.op === kind)
  const lv = by('levels')
  return {
    rotation: numParam(by('rotate'), 'degrees', 0),
    straighten: numParam(by('straighten'), 'degrees', 0),
    brightness: numParam(by('brightness'), 'amount', 0),
    contrast: numParam(by('contrast'), 'amount', 0),
    black: numParam(lv, 'black', 0),
    white: numParam(lv, 'white', 255),
    gamma: numParam(lv, 'gamma', 1),
    grayscale: by('grayscale') !== undefined,
    threshold: by('threshold') ? numParam(by('threshold'), 'level', 128) : null,
    despeckle: numParam(by('despeckle'), 'radius', 0),
    removeBg: by('removeBackground') ? numParam(by('removeBackground'), 'tolerance', 32) : null
  }
}

function seedCurve(savedOps: readonly ImageEditOp[]): CurvePoint[] {
  const c = savedOps.find((o) => o.op === 'curves')
  const raw = c?.params['points']
  if (typeof raw !== 'string') return IDENTITY_CURVE
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (p): p is CurvePoint =>
          Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
      ) &&
      parsed.length >= 2
    ) {
      return parsed.map((p) => [p[0], p[1]] as CurvePoint)
    }
  } catch {
    // fall through to identity
  }
  return IDENTITY_CURVE
}

function seedCrop(savedOps: readonly ImageEditOp[]): CropRect | null {
  const c = savedOps.find((o) => o.op === 'crop')
  if (!c) return null
  return {
    x: numParam(c, 'x', 0),
    y: numParam(c, 'y', 0),
    width: numParam(c, 'width', 1),
    height: numParam(c, 'height', 1)
  }
}

/**
 * Apply a partial crop edit, defaulting from the full image when no crop exists
 * yet and clamping the rect inside the original bounds.
 */
function withCrop(
  current: CropRect | null,
  dims: { width: number; height: number },
  patch: Partial<CropRect>
): CropRect {
  const base: CropRect = current ?? { x: 0, y: 0, width: dims.width, height: dims.height }
  const next = { ...base, ...patch }
  const x = Math.max(0, Math.min(next.x, dims.width - 1))
  const y = Math.max(0, Math.min(next.y, dims.height - 1))
  const width = Math.max(1, Math.min(next.width, dims.width - x))
  const height = Math.max(1, Math.min(next.height, dims.height - y))
  return { x, y, width, height }
}
