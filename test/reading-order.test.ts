import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { orderBoxes, readingOrder, type TextBox } from '@core/witness/reading-order'
import { matchingRuns } from '@core/witness'

interface Fixture {
  leaves: { pageIndex: number; words: [string, number, number, number, number, number][] }[]
}

const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures/boxes', `${name}.json`), 'utf8')) as Fixture

const boxesOf = (words: Fixture['leaves'][number]['words']): TextBox[] =>
  words.map(([text, confidence, x0, y0, x1, y1]) => ({
    text,
    confidence,
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0
  }))

/** A deterministic shuffle, so a failure is the same failure every run. */
function shuffled<T>(list: readonly T[], seed = 7): T[] {
  const out = [...list]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Letters and digits only, as `compareWitnesses` normalises: punctuation is not order. */
const norm = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)

/** How much of Tesseract's emission order the ordering reproduces. */
function agreement(ordered: string, emitted: readonly string[]): number {
  const b = norm(emitted.join(' '))
  return matchingRuns(norm(ordered), b).length / Math.max(1, b.length)
}

describe('readingOrder — boxes back into the order a reader takes them', () => {
  /**
   * The fixtures are Tesseract's words in Tesseract's emission order, which
   * on a single-column leaf is the reading order. Shuffled and put back,
   * they should come out as they went in. The floor is measured, not chosen
   * (0.972 is the lowest, leaf 6 of Clairvoyance): the few words that move
   * are the folio and running head, which Tesseract emits as a block of its
   * own and which a row-and-column rule sets where they sit on the page.
   */
  for (const [name, floor] of [
    ['aura-loose', 0.97],
    ['tight-clairvoyance', 0.97],
    ['astral-world', 0.97],
    ['isis-vol1', 0.97],
    ['tight-scramble', 0.97]
  ] as const) {
    it(`reproduces the emission order on ${name}`, () => {
      for (const leaf of fixture(name).leaves) {
        if (leaf.words.length < 50) continue
        const emitted = leaf.words.map((w) => w[0])
        const text = readingOrder(shuffled(boxesOf(leaf.words)))
        expect(agreement(text, emitted), `leaf ${leaf.pageIndex}`).toBeGreaterThanOrEqual(floor)
      }
    })
  }

  /**
   * The columns of Patterns Vol. II: a narrow transcript beside a wider
   * commentary. Tesseract reads these across, and its emission order is the
   * documented fault (`look takes up and when on are a you wonderful`), so
   * it is no yardstick here. What is asserted is the geometry the draft
   * measures: the leaf is cut into its columns, every box of the left column
   * stands left of every box of the right, and within a column the rows run
   * top to bottom. The proofed text of such a leaf is a *table* read row by
   * row across both columns, which is a third order neither reader gives;
   * the ledger names it.
   */
  it('orders a two-column leaf column by column, each top to bottom', () => {
    const leaf = fixture('patterns-vol2').leaves.find((l) => l.pageIndex === 120)!
    const ordered = orderBoxes(shuffled(boxesOf(leaf.words)))
    const columns = new Set(ordered.map((b) => b.column))
    expect(columns.size).toBeGreaterThanOrEqual(2)
    const left = ordered.filter((b) => b.column === 0)
    const right = ordered.filter((b) => b.column === 1)
    expect(Math.max(...left.map((b) => b.x + b.width))).toBeLessThanOrEqual(
      Math.min(...right.map((b) => b.x)) + 1
    )
    for (const col of columns) {
      const rows = ordered.filter((b) => b.column === col)
      for (let i = 1; i < rows.length; i++) {
        if (rows[i]!.row !== rows[i - 1]!.row)
          expect(rows[i]!.y).toBeGreaterThan(rows[i - 1]!.y - rows[i]!.height)
      }
    }
  })

  /**
   * A two-page leaf (Patterns Vol. I is scanned two pages to a leaf). The
   * gutter cut is `findColumns`'s, and the left page reads entire before
   * the right one begins.
   */
  it('reads the left page of a two-up leaf before the right', () => {
    const leaf = fixture('patterns-vol1').leaves.find((l) => l.pageIndex === 35)!
    const ordered = orderBoxes(shuffled(boxesOf(leaf.words)))
    expect(new Set(ordered.map((b) => b.column)).size).toBeGreaterThanOrEqual(2)
    const firstRight = ordered.findIndex((b) => b.column > 0)
    expect(firstRight).toBeGreaterThan(0)
    expect(ordered.slice(0, firstRight).every((b) => b.column === 0)).toBe(true)
    const leftMax = Math.max(...ordered.filter((b) => b.column === 0).map((b) => b.x + b.width))
    const rightMin = Math.min(...ordered.filter((b) => b.column > 0).map((b) => b.x))
    expect(leftMax).toBeLessThanOrEqual(rightMin + 1)
  })

  it('puts a row’s boxes left to right and rows top to bottom', () => {
    const boxes: TextBox[] = [
      { text: 'world', x: 60, y: 10, width: 40, height: 10 },
      { text: 'second', x: 10, y: 30, width: 50, height: 10 },
      { text: 'hello', x: 10, y: 11, width: 40, height: 10 },
      { text: 'line', x: 70, y: 29, width: 30, height: 10 }
    ]
    expect(readingOrder(boxes)).toBe('hello world\nsecond line')
  })

  it('is empty for no boxes', () => {
    expect(readingOrder([])).toBe('')
    expect(orderBoxes([])).toEqual([])
  })
})
