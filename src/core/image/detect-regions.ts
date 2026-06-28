/**
 * Illustration-region detection (SPEC §6, low trust).
 *
 * Auto-extraction from old scans is unreliable, so this is explicitly a *first
 * guess*: it rasterizes the page's OCR word bboxes into a coarse occupancy grid,
 * then finds large empty axis-aligned rectangles (bounded by occupied cells or
 * page edges). A rectangle qualifies as a candidate image region when its area
 * exceeds `minAreaFraction` of the page and it isn't merely a margin strip.
 *
 * Deterministic + pure. Special cases:
 *   - A page with no words → the whole page is one candidate.
 *   - A fully-text page → no candidates.
 *
 * `accepted` is always null: a human reviews each candidate (SPEC §6).
 */
import type { ImageRegion, SourcePage } from '@core/model'

interface Options {
  /** Min region area as a fraction of page area. Default ~0.08. */
  minAreaFraction: number
  gridCols: number
  gridRows: number
}

const DEFAULTS: Options = {
  minAreaFraction: 0.08,
  gridCols: 32,
  gridRows: 32
}

/** A rectangle in grid-cell coordinates (half-open [c0,c1) × [r0,r1)). */
interface CellRect {
  c0: number
  r0: number
  c1: number
  r1: number
}

/**
 * Find the maximal all-empty rectangles in a boolean occupancy grid using the
 * classic "largest rectangle in histogram per row" sweep, collecting every
 * locally-maximal empty rectangle (not just the single largest). Deterministic.
 */
function emptyRects(occ: boolean[][], rows: number, cols: number): CellRect[] {
  const rects: CellRect[] = []
  // heights[c] = number of consecutive empty cells ending at current row in col c.
  const heights = new Array<number>(cols).fill(0)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[c] = occ[r]![c] ? 0 : heights[c]! + 1
    }
    // Stack-based largest-rectangle scan over this histogram row; emit each
    // rectangle popped from the stack as a candidate empty rectangle.
    const stack: number[] = []
    for (let c = 0; c <= cols; c++) {
      const h = c === cols ? 0 : heights[c]!
      while (stack.length > 0 && heights[stack[stack.length - 1]!]! > h) {
        const top = stack.pop()!
        const height = heights[top]!
        if (height === 0) continue
        const left = stack.length === 0 ? 0 : stack[stack.length - 1]! + 1
        const right = c // exclusive
        rects.push({ c0: left, r0: r - height + 1, c1: right, r1: r + 1 })
      }
      stack.push(c)
    }
  }
  return rects
}

function cellToBBox(
  rect: CellRect,
  cols: number,
  rows: number,
  width: number,
  height: number
): { x0: number; y0: number; x1: number; y1: number } {
  const cw = width / cols
  const ch = height / rows
  return {
    x0: Math.round(rect.c0 * cw),
    y0: Math.round(rect.r0 * ch),
    x1: Math.round(rect.c1 * cw),
    y1: Math.round(rect.r1 * ch)
  }
}

function area(r: CellRect): number {
  return (r.c1 - r.c0) * (r.r1 - r.r0)
}

/** True if `a` is fully contained in `b`. */
function contains(b: CellRect, a: CellRect): boolean {
  return a.c0 >= b.c0 && a.r0 >= b.r0 && a.c1 <= b.c1 && a.r1 <= b.r1
}

export function detectRegions(
  page: SourcePage,
  opts?: { minAreaFraction?: number; gridCols?: number; gridRows?: number }
): ImageRegion[] {
  const cfg: Options = {
    minAreaFraction: opts?.minAreaFraction ?? DEFAULTS.minAreaFraction,
    gridCols: Math.max(1, opts?.gridCols ?? DEFAULTS.gridCols),
    gridRows: Math.max(1, opts?.gridRows ?? DEFAULTS.gridRows)
  }
  const width = page.width || 1
  const height = page.height || 1

  // No words: the whole page is a single candidate.
  if (page.words.length === 0) {
    return [
      {
        id: `p${page.index}_r0`,
        pageIndex: page.index,
        bbox: { x0: 0, y0: 0, x1: width, y1: height },
        accepted: null
      }
    ]
  }

  const { gridCols: cols, gridRows: rows } = cfg
  const occ: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))

  // Rasterize each word bbox into the grid (mark any overlapped cell occupied).
  const cw = width / cols
  const ch = height / rows
  for (const w of page.words) {
    const c0 = Math.max(0, Math.floor(w.bbox.x0 / cw))
    const c1 = Math.min(cols - 1, Math.floor((w.bbox.x1 - 1e-6) / cw))
    const r0 = Math.max(0, Math.floor(w.bbox.y0 / ch))
    const r1 = Math.min(rows - 1, Math.floor((w.bbox.y1 - 1e-6) / ch))
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) occ[r]![c] = true
    }
  }

  const minCells = cfg.minAreaFraction * cols * rows
  const candidates = emptyRects(occ, rows, cols)
    .filter((r) => area(r) >= minCells)
    // Drop thin margin strips: require both dimensions to be meaningful (not a
    // single-cell-wide gutter spanning the page edge).
    .filter((r) => {
      const wCells = r.c1 - r.c0
      const hCells = r.r1 - r.r0
      const touchesLeft = r.c0 === 0
      const touchesRight = r.c1 === cols
      const touchesTop = r.r0 === 0
      const touchesBottom = r.r1 === rows
      // A full-height sliver hugging a vertical edge is a margin, not an image.
      const isVerticalMarginStrip =
        (touchesLeft || touchesRight) &&
        !(touchesLeft && touchesRight) &&
        wCells <= Math.max(1, Math.floor(cols * 0.12)) &&
        hCells >= rows * 0.7
      const isHorizontalMarginStrip =
        (touchesTop || touchesBottom) &&
        !(touchesTop && touchesBottom) &&
        hCells <= Math.max(1, Math.floor(rows * 0.12)) &&
        wCells >= cols * 0.7
      return !isVerticalMarginStrip && !isHorizontalMarginStrip
    })
    // Largest first for deterministic, stable de-duplication.
    .sort((a, b) => area(b) - area(a) || a.r0 - b.r0 || a.c0 - b.c0)

  // Greedily keep non-contained rectangles so we don't return both a big region
  // and its sub-rectangles.
  const kept: CellRect[] = []
  for (const cand of candidates) {
    if (kept.some((k) => contains(k, cand))) continue
    kept.push(cand)
  }

  return kept.map((rect, n) => ({
    id: `p${page.index}_r${n}`,
    pageIndex: page.index,
    bbox: cellToBBox(rect, cols, rows, width, height),
    accepted: null
  }))
}
