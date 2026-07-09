/**
 * CoordinateMap — the architectural backbone (SPEC §2).
 *
 * Builds fast lookups over the flat `MappingEntry[]` stored in a project so the
 * review instrument can translate between the source page image and the
 * formatted output in either direction.
 *
 * The public surface is the `CoordinateIndex` contract (see types.ts). This
 * implementation hardens the baseline:
 *  - `atOutputOffset` binary-searches the output-start-sorted entries.
 *  - `atPoint` returns the smallest-area bbox containing the point (so nested
 *    boxes resolve to the most specific token), or null.
 *  - `inOutputRange` returns every entry whose output range overlaps the query,
 *    in output order.
 *  - empty input is handled gracefully.
 */
import type { BBox, CoordinateIndex, MappingEntry, OutputRange } from './types'

function pointInBBox(b: BBox, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
}

function bboxArea(b: BBox): number {
  // Clamp to non-negative; a degenerate/inverted box has zero effective area.
  const w = Math.max(0, b.x1 - b.x0)
  const h = Math.max(0, b.y1 - b.y0)
  return w * h
}

function rangesOverlap(a: OutputRange, b: OutputRange): boolean {
  return a.start < b.end && b.start < a.end
}

export class CoordinateMap implements CoordinateIndex {
  readonly entries: readonly MappingEntry[]
  private readonly byId: Map<string, MappingEntry>
  // Entries bucketed by page so a hover hit-test scans one page, not the whole
  // book. On large scans this is the difference between a snappy and a laggy
  // hover (the linear whole-book scan dominated hover latency).
  private readonly byPage: Map<number, MappingEntry[]>

  constructor(entries: MappingEntry[]) {
    // Keep entries sorted by output start for predictable offset lookups and
    // binary search. Ties broken by output end so narrower ranges come first.
    this.entries = [...entries].sort(
      (a, b) => a.output.start - b.output.start || a.output.end - b.output.end
    )
    this.byId = new Map(this.entries.map((e) => [e.tokenId, e]))
    this.byPage = new Map()
    for (const e of this.entries) {
      let bucket = this.byPage.get(e.pageIndex)
      if (!bucket) {
        bucket = []
        this.byPage.set(e.pageIndex, bucket)
      }
      bucket.push(e)
    }
  }

  atPoint(pageIndex: number, x: number, y: number): MappingEntry | null {
    const bucket = this.byPage.get(pageIndex)
    if (!bucket) return null
    let best: MappingEntry | null = null
    let bestArea = Infinity
    for (const e of bucket) {
      if (!pointInBBox(e.bbox, x, y)) continue
      const area = bboxArea(e.bbox)
      if (area < bestArea) {
        best = e
        bestArea = area
      }
    }
    return best
  }

  atOutputOffset(offset: number): MappingEntry | null {
    const entries = this.entries
    // Binary search for the right-most entry whose output.start <= offset.
    let lo = 0
    let hi = entries.length - 1
    let candidate = -1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      if (entries[mid]!.output.start <= offset) {
        candidate = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (candidate === -1) return null
    // Walk left over entries sharing a start boundary, since the right-most
    // start<=offset may not be the one whose [start,end) actually contains it
    // (overlapping/nested ranges). Start inclusive, end exclusive.
    for (let i = candidate; i >= 0; i--) {
      const e = entries[i]!
      if (offset >= e.output.start && offset < e.output.end) return e
      // Once we pass a strictly smaller start that still can't reach offset,
      // earlier entries (even smaller start) can only help if they're wide;
      // keep scanning while starts are <= offset.
      if (e.output.start > offset) break
    }
    return null
  }

  inOutputRange(range: OutputRange): MappingEntry[] {
    // entries are already in output order.
    return this.entries.filter((e) => rangesOverlap(e.output, range))
  }

  byTokenId(id: string): MappingEntry | null {
    return this.byId.get(id) ?? null
  }

  toJSON(): MappingEntry[] {
    return [...this.entries]
  }
}

/** Factory used across the engine so callers depend on `CoordinateIndex`. */
export function createCoordinateMap(entries: MappingEntry[]): CoordinateIndex {
  return new CoordinateMap(entries)
}
