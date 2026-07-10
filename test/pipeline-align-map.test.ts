import { describe, it, expect } from 'vitest'
import type { MappingEntry, SourcePage, WordToken } from '@core/model'
import { realignCoordinateMap } from '../src/pipeline/stages/align-map'
import { buildCoordinateMap } from '../src/pipeline/stages/ocr'

/** A page whose words are the given texts (bbox/confidence are irrelevant here). */
function page(index: number, texts: string[]): SourcePage {
  const words: WordToken[] = texts.map((text, n) => ({
    id: `p${index}_w${n}`,
    text,
    bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    pageIndex: index,
    confidence: 90
  }))
  return { index, imagePath: null, width: 10, height: 10, dpi: null, words, regions: [] }
}

/** Assert every entry's output range slices its own token text out of markdown. */
function assertAligned(
  pages: SourcePage[],
  markdown: string,
  entries: MappingEntry[],
  tokenIds: string[]
): void {
  const textById = new Map<string, string>()
  for (const p of pages) for (const w of p.words) textById.set(w.id, w.text)
  const byId = new Map(entries.map((e) => [e.tokenId, e]))
  for (const id of tokenIds) {
    const e = byId.get(id)!
    expect(markdown.slice(e.output.start, e.output.end)).toBe(textById.get(id))
  }
}

describe('realignCoordinateMap', () => {
  it('corrects the page-boundary drift the OCR seed introduces', () => {
    const pages = [page(0, ['Hello', 'world']), page(1, ['Foo', 'bar'])]
    // The OCR stage seeds offsets against a continuous single-space string, but
    // the real markdown joins pages with a blank line — so every token on page 1
    // is off by the extra separator character.
    const seeded = buildCoordinateMap(pages)
    const markdown = 'Hello world\n\nFoo bar'

    // Seeded ranges are wrong for page 1 (proving the drift the user saw).
    const seededFoo = seeded.find((e) => e.tokenId === 'p1_w0')!
    expect(markdown.slice(seededFoo.output.start, seededFoo.output.end)).not.toBe('Foo')

    const aligned = realignCoordinateMap(pages, markdown, seeded)
    assertAligned(pages, markdown, aligned, ['p0_w0', 'p0_w1', 'p1_w0', 'p1_w1'])
  })

  it('stays sorted by output start', () => {
    const pages = [page(0, ['a', 'bb', 'ccc'])]
    const markdown = 'a bb ccc'
    const aligned = realignCoordinateMap(pages, markdown, buildCoordinateMap(pages))
    const starts = aligned.map((e) => e.output.start)
    expect(starts).toEqual([...starts].sort((x, y) => x - y))
  })

  it('matches a de-hyphenated token by its alphanumeric core', () => {
    // Source token "inter-" (line-end hyphen) but markdown merged it to "inter".
    const pages = [page(0, ['inter-', 'val'])]
    const markdown = 'interval'
    const aligned = realignCoordinateMap(pages, markdown, buildCoordinateMap(pages))
    const first = aligned.find((e) => e.tokenId === 'p0_w0')!
    expect(markdown.slice(first.output.start, first.output.end)).toBe('inter')
  })

  it('degrades locally: a rewritten token collapses but neighbours re-sync', () => {
    // "œuvre" was normalized to "oeuvre" in markdown; the source token still holds
    // the ligature, so it can't be found — but "de" after it must still align.
    const pages = [page(0, ['un', 'œuvre', 'de'])]
    const markdown = 'un oeuvre de'
    const aligned = realignCoordinateMap(pages, markdown, buildCoordinateMap(pages))

    const un = aligned.find((e) => e.tokenId === 'p0_w0')!
    const oeuvre = aligned.find((e) => e.tokenId === 'p0_w1')!
    const de = aligned.find((e) => e.tokenId === 'p0_w2')!

    expect(markdown.slice(un.output.start, un.output.end)).toBe('un')
    // Rewritten token: zero-width anchor (no false highlight).
    expect(oeuvre.output.end).toBe(oeuvre.output.start)
    // Neighbour after the miss still lands correctly.
    expect(markdown.slice(de.output.start, de.output.end)).toBe('de')
  })

  it('passes through entries whose token has no matching word', () => {
    const pages = [page(0, ['a'])]
    const orphan: MappingEntry = {
      tokenId: 'ghost',
      pageIndex: 9,
      bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
      output: { start: 100, end: 105 }
    }
    const entries = [...buildCoordinateMap(pages), orphan]
    const aligned = realignCoordinateMap(pages, 'a', entries)
    expect(aligned.find((e) => e.tokenId === 'ghost')).toEqual(orphan)
  })
})
