/**
 * CoordinateMap — the architectural backbone (SPEC §2).
 *
 * Builds fast lookups over the flat `MappingEntry[]` stored in a project so the
 * review instrument can translate between the source page image and the
 * formatted output in either direction.
 *
 * NOTE: This is a correct-but-minimal baseline (linear scans). The core-model
 * module is expected to harden it (indexed lookups, overlap handling, full test
 * coverage) without changing the `CoordinateIndex` contract.
 */
import type { BBox, CoordinateIndex, MappingEntry, OutputRange } from './types'

function pointInBBox(b: BBox, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
}

function rangesOverlap(a: OutputRange, b: OutputRange): boolean {
  return a.start < b.end && b.start < a.end
}

export class CoordinateMap implements CoordinateIndex {
  readonly entries: readonly MappingEntry[]
  private readonly byId: Map<string, MappingEntry>

  constructor(entries: MappingEntry[]) {
    // Keep entries sorted by output start for predictable offset lookups.
    this.entries = [...entries].sort((a, b) => a.output.start - b.output.start)
    this.byId = new Map(this.entries.map((e) => [e.tokenId, e]))
  }

  atPoint(pageIndex: number, x: number, y: number): MappingEntry | null {
    for (const e of this.entries) {
      if (e.pageIndex === pageIndex && pointInBBox(e.bbox, x, y)) return e
    }
    return null
  }

  atOutputOffset(offset: number): MappingEntry | null {
    for (const e of this.entries) {
      if (offset >= e.output.start && offset < e.output.end) return e
    }
    return null
  }

  inOutputRange(range: OutputRange): MappingEntry[] {
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
