/**
 * Heading detection (SPEC §5 heading confirmation; SPEC §12 #11–12).
 *
 * Pure, deterministic heuristic. We group a page's OCR words into lines (by
 * vertical position), then look for lines whose words are *typographically
 * larger* than the page's typical word (taller median bbox), are *short* (few
 * words), and are *isolated* by vertical whitespace above/below. Title-case or
 * ALL-CAPS text nudges the score up. Each surviving line becomes a
 * `HeadingCandidate`, mapped to an output range via the coordinate map, plus a
 * low-trust `{kind:'heuristic', source:'structure', label:'probable heading'}`
 * flag. Coarse `level` is assigned by relative size (biggest → 1).
 *
 * This is intentionally low-trust: the user confirms candidates in review, which
 * promotes them to `heading` StructuralTags that feed the TOC (SPEC §7).
 */
import type {
  Flag,
  HeadingCandidate,
  MappingEntry,
  SourcePage,
  WordToken,
} from '@core/model'

/** Internal: a run of words sharing roughly one baseline. */
interface Line {
  words: WordToken[]
  /** Median word height across the line, in source pixels. */
  height: number
  /** Vertical center of the line. */
  midY: number
  top: number
  bottom: number
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

function wordHeight(w: WordToken): number {
  return Math.max(0, w.bbox.y1 - w.bbox.y0)
}

/**
 * Group words into lines. Words are sorted by vertical center, then split into a
 * new line whenever the gap to the running line center exceeds half the current
 * median word height (a stable, scale-relative threshold).
 */
function groupLines(words: WordToken[]): Line[] {
  const sorted = [...words].sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2
    const by = (b.bbox.y0 + b.bbox.y1) / 2
    if (ay !== by) return ay - by
    return a.bbox.x0 - b.bbox.x0
  })

  const lines: WordToken[][] = []
  let current: WordToken[] = []
  let runningMid = 0
  let runningHeight = 0

  for (const w of sorted) {
    const mid = (w.bbox.y0 + w.bbox.y1) / 2
    const h = wordHeight(w) || 1
    if (current.length === 0) {
      current = [w]
      runningMid = mid
      runningHeight = h
      continue
    }
    const tolerance = Math.max(runningHeight, h) * 0.6
    if (Math.abs(mid - runningMid) <= tolerance) {
      current.push(w)
      // Update running stats (simple incremental average is fine + deterministic).
      runningMid = (runningMid * (current.length - 1) + mid) / current.length
      runningHeight = (runningHeight * (current.length - 1) + h) / current.length
    } else {
      lines.push(current)
      current = [w]
      runningMid = mid
      runningHeight = h
    }
  }
  if (current.length > 0) lines.push(current)

  return lines.map((ws) => {
    const ordered = [...ws].sort((a, b) => a.bbox.x0 - b.bbox.x0)
    const top = Math.min(...ordered.map((w) => w.bbox.y0))
    const bottom = Math.max(...ordered.map((w) => w.bbox.y1))
    return {
      words: ordered,
      height: median(ordered.map(wordHeight)),
      midY: (top + bottom) / 2,
      top,
      bottom,
    }
  })
}

function isTitleCaseOrCaps(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '')
  if (letters.length === 0) return false
  if (letters === letters.toUpperCase()) return true
  // Title case: every alphabetic word starts uppercase.
  const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w))
  return words.length > 0 && words.every((w) => /^[^A-Za-z]*[A-Z]/.test(w))
}

/** Build a tokenId → MappingEntry index for fast output-range lookup. */
function indexByToken(coordinateMap: MappingEntry[]): Map<string, MappingEntry> {
  const m = new Map<string, MappingEntry>()
  for (const e of coordinateMap) m.set(e.tokenId, e)
  return m
}

/**
 * Detect probable headings across all pages. Pure: same input → same output.
 */
export function detectHeadings(
  pages: SourcePage[],
  markdown: string,
  coordinateMap: MappingEntry[],
): { candidates: HeadingCandidate[]; flags: Flag[] } {
  const byToken = indexByToken(coordinateMap)
  const candidates: HeadingCandidate[] = []

  // Collect (candidate, lineHeight) pairs so levels can be assigned globally.
  const scored: { candidate: HeadingCandidate; height: number }[] = []

  for (const page of pages) {
    if (page.words.length === 0) continue
    const lines = groupLines(page.words)
    if (lines.length === 0) continue

    const pageMedianHeight = median(page.words.map(wordHeight)) || 1
    const pageMedianGap = median(
      lines.slice(1).map((l, i) => l.top - lines[i]!.bottom),
    )

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      // Short runs only — headings are not paragraphs.
      if (line.words.length === 0 || line.words.length > 8) continue

      // Notably larger than the page's typical word.
      const sizeRatio = line.height / pageMedianHeight
      const isLarge = sizeRatio >= 1.25

      // Vertical isolation: generous whitespace above or below.
      const gapAbove = i > 0 ? line.top - lines[i - 1]!.bottom : Infinity
      const gapBelow =
        i < lines.length - 1 ? lines[i + 1]!.top - line.bottom : Infinity
      const isoThreshold = Math.max(pageMedianGap * 1.5, pageMedianHeight * 1.0)
      const isIsolated = gapAbove >= isoThreshold || gapBelow >= isoThreshold

      const text = line.words.map((w) => w.text).join(' ')
      const styled = isTitleCaseOrCaps(text)

      // Require larger-than-body type; isolation or styling confirms it.
      if (!isLarge) continue
      if (!isIsolated && !styled) continue

      // Map the line's tokens → output range (min start, max end).
      let start = Infinity
      let end = -Infinity
      for (const w of line.words) {
        const entry = byToken.get(w.id)
        if (!entry) continue
        start = Math.min(start, entry.output.start)
        end = Math.max(end, entry.output.end)
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        continue
      }

      const sliced = markdown.slice(start, end)
      const candidateText = (sliced.trim() || text).replace(/\s+/g, ' ')

      scored.push({
        candidate: {
          range: { start, end },
          text: candidateText,
          level: 1,
          pageIndex: page.index,
        },
        height: line.height,
      })
    }
  }

  // Coarse level assignment: bucket distinct heights, biggest → level 1.
  const distinctHeights = [...new Set(scored.map((s) => Math.round(s.height)))].sort(
    (a, b) => b - a,
  )
  const levelOf = new Map<number, number>()
  distinctHeights.forEach((h, idx) => levelOf.set(h, Math.min(idx + 1, 6)))

  for (const s of scored) {
    s.candidate.level = levelOf.get(Math.round(s.height)) ?? 1
    candidates.push(s.candidate)
  }

  // Stable document order.
  candidates.sort((a, b) => a.range.start - b.range.start)

  const flags: Flag[] = candidates.map((c) => ({
    kind: 'heuristic',
    source: 'structure',
    label: 'probable heading',
    range: c.range,
  }))

  return { candidates, flags }
}
