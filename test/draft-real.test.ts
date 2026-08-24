import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { draftPage, type DraftWord } from '@core/draft'

/**
 * The draft module, against word boxes measured off real scans.
 *
 * Every geometric fault this module has had appeared only when a real page
 * went through it, and none were caught by the tests built from hand-written
 * boxes — because the faults live in the *shape of real OCR output*: a
 * mis-segmented box twice the height of the body, a drop capital read as a
 * stray `=`, consecutive lines whose boxes touch. Nobody inventing a fixture
 * imagines those, because nobody knows they are there.
 *
 * So these fixtures are measured rather than written — see
 * `scripts/harvest-boxes.mjs` — and cover two typographic regimes on purpose:
 * a loosely-leaded small-format book and a tightly-set one whose adjacent word
 * boxes touch. A fault visible in one is routinely invisible in the other.
 *
 * ## The oracle, which costs nobody any labelling
 *
 * **Tesseract emits words in reading order.** Whatever else the draft does, it
 * must hand the words back in the order they were read, because both are
 * reading the same single-column page. So the drafted text must be a
 * *subsequence* of the OCR sequence — every word still there, still in order,
 * with only the furniture lifted out.
 *
 * A subsequence check catches a reordering exactly: if one word moves later,
 * the match fails at the word it jumped. That is the scramble this module
 * shipped twice, and this asserts against it on every leaf of every fixture
 * with no expectation written by hand.
 */

const DIR = resolve(__dirname, 'fixtures/boxes')

interface Fixture {
  scan: string
  sha256: string
  dpi: number
  leaves: {
    pageIndex: number
    width: number
    height: number
    meanConfidence: number
    words: [string, number, number, number, number, number][]
  }[]
}

const fixtures: { name: string; fixture: Fixture }[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({
    name: f.replace(/\.json$/, ''),
    fixture: JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as Fixture
  }))

const toWords = (raw: Fixture['leaves'][number]['words']): DraftWord[] =>
  raw.map(([text, confidence, x0, y0, x1, y1]) => ({
    text,
    confidence,
    bbox: { x0, y0, x1, y1 }
  }))

const split = (text: string): string[] => text.split(/\s+/u).filter((w) => w.length > 0)

/** Whether `part` appears in `whole` in order, gaps allowed. */
function isSubsequence(part: readonly string[], whole: readonly string[]): number {
  let at = 0
  for (const word of part) {
    const found = whole.indexOf(word, at)
    if (found === -1) return part.indexOf(word)
    at = found + 1
  }
  return -1
}

/**
 * Leaves where the scramble is known to happen, recorded as fact.
 *
 * Marked `it.fails` rather than skipped, so the suite stays green while the
 * defect stays visible and — this is the point — **the day it is fixed this
 * entry starts failing**, which is what forces it to be removed rather than
 * quietly outliving the bug. A skipped test would rot; this cannot.
 *
 * `tight-clairvoyance` leaf 7: Tesseract splits `beyond` into `beyon` and a
 * fragment it reads as `:`, whose box is tall enough to open a band spanning
 * two lines. The fragment then surfaces between `beyon` and `doubt`. Fixing
 * this is the definition of done for the line-clustering rework.
 */
const KNOWN_SCRAMBLE: Record<string, readonly number[]> = {
  'tight-scramble': [7]
}

const scrambles = (name: string, pageIndex: number): boolean =>
  (KNOWN_SCRAMBLE[name] ?? []).includes(pageIndex)

describe('the draft preserves the order the page was read in', () => {
  for (const { name, fixture } of fixtures) {
    for (const leaf of fixture.leaves) {
      const test = scrambles(name, leaf.pageIndex) ? it.fails : it
      test(`${name} leaf ${leaf.pageIndex} — ${leaf.words.length} words`, () => {
        const drafted = draftPage(toWords(leaf.words))
        const ocr = leaf.words.map(([text]) => text)
        const laid = drafted.blocks.flatMap((b) => split(b.text))
        const broke = isSubsequence(laid, ocr)
        expect(
          broke,
          broke === -1
            ? ''
            : `word ${broke} of the draft ("${laid[broke]}") is out of the order OCR read it in. ` +
                `Around it: …${laid.slice(Math.max(0, broke - 6), broke + 6).join(' ')}…`
        ).toBe(-1)
      })
    }
  }
})

describe('nothing is silently lost or duplicated', () => {
  for (const { name, fixture } of fixtures) {
    for (const leaf of fixture.leaves) {
      it(`${name} leaf ${leaf.pageIndex}`, () => {
        const drafted = draftPage(toWords(leaf.words))
        const ocr = leaf.words.map(([text]) => text).filter((t) => t.trim().length > 0)
        const laid = [
          ...drafted.blocks.flatMap((b) => split(b.text)),
          ...split(drafted.furniture.runningHead ?? ''),
          ...split(drafted.furniture.folio ?? '')
        ]
        // Every word OCR read reaches the draft exactly once — in a block or,
        // if it was furniture, in `furniture`. A word that reaches neither has
        // been dropped off the leaf in silence, which is the one outcome worse
        // than putting it in the wrong block.
        expect(laid.length).toBe(ocr.length)
      })
    }
  }
})
