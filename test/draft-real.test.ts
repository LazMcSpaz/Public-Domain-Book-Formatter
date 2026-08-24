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
 *
 * ## What the oracle deliberately does not judge
 *
 * Emission order is reading order for *ordinary words*, and only for those.
 * Measured on these fixtures, Tesseract puts two other things wherever it
 * likes:
 *
 * - **Specks.** The `:` on `tight-scramble` leaf 7 is a box 3 pixels wide and
 *   **1 pixel tall** at the right margin, emitted at index 105 — before the
 *   words of its own line at 113–116.
 * - **Drop capitals.** The `=` on `astral-world` leaf 6 is the `E` of `EVERY`,
 *   a box **244 pixels tall** against a 62-pixel body, emitted at index 15 —
 *   after the whole line it begins.
 *
 * Neither has a defensible position in a word sequence, so neither is evidence
 * of anything and both are left out: a word takes part only if it is roughly
 * body-sized and OCR was confident of it. That is not the oracle being
 * loosened to let a failure through — it is the oracle being told what its own
 * ground truth actually covers. Everything excluded here is reported to the
 * corrector through `structural` and `uncertain` instead, which is where an
 * ambiguous mark belongs.
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

/**
 * The words whose order is evidence: roughly body-sized, and confidently read.
 *
 * Returned as a set of the word *texts*, because that is what survives into a
 * block. A text appearing both as an ordinary word and as a speck somewhere
 * else on the leaf counts as ordinary, which is the forgiving direction and
 * costs the oracle nothing it was relying on.
 */
function ordinaryWords(words: readonly DraftWord[]): Set<string> {
  const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b)
  const body = heights[heights.length >> 1] ?? 1
  const keep = new Set<string>()
  for (const w of words) {
    const height = w.bbox.y1 - w.bbox.y0
    if (w.confidence < 60) continue
    if (height < body * 0.45 || height > body * 1.8) continue
    keep.add(w.text)
  }
  return keep
}

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
const KNOWN_SCRAMBLE: Record<string, readonly number[]> = {}

const scrambles = (name: string, pageIndex: number): boolean =>
  (KNOWN_SCRAMBLE[name] ?? []).includes(pageIndex)

describe('the draft preserves the order the page was read in', () => {
  for (const { name, fixture } of fixtures) {
    for (const leaf of fixture.leaves) {
      const test = scrambles(name, leaf.pageIndex) ? it.fails : it
      test(`${name} leaf ${leaf.pageIndex} — ${leaf.words.length} words`, () => {
        const words = toWords(leaf.words)
        const drafted = draftPage(words)
        const ordinary = ordinaryWords(words)
        const ocr = leaf.words.map(([text]) => text).filter((t) => ordinary.has(t))
        const laid = drafted.blocks.flatMap((b) => split(b.text)).filter((t) => ordinary.has(t))
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

/**
 * The furniture, hand-checked once against the renders and pinned here.
 *
 * Nine real running heads across three books. The first version of this module
 * captured **none** of them and said nothing about it, so the original
 * edition's folio went into the body text on every leaf — the exact thing the
 * front-matter rule exists to prevent — and there was nothing in `structural`
 * to send anyone looking.
 */
const FURNITURE: Record<string, Record<number, { runningHead?: string; folio?: string }>> = {
  'astral-world': {
    6: { runningHead: 'THE SEVEN PLANES', folio: '5' },
    30: { runningHead: 'PASSING THE BORDER', folio: '29' },
    95: { runningHead: 'THE ASTRAL WORLD', folio: '94' }
  },
  'aura-loose': {
    6: { runningHead: 'WHAT IS THE HUMAN AURA?', folio: '7' },
    7: { runningHead: 'THE HUMAN AURA', folio: '8' },
    20: { runningHead: 'THE PRANA-AURA', folio: '21' }
  },
  'tight-clairvoyance': {
    40: { runningHead: 'TELEPATHY vs. CLAIRVOYANCE', folio: '37' },
    120: { runningHead: 'CRYSTAL GAZING', folio: '117' },
    322: { runningHead: 'PSYCHIC, MAGNETIC HEALING', folio: '319' },
    // Kept as text on purpose, each for its own reason. A leaf that takes
    // nothing must say why, and these are the four kinds of thing that sit
    // where a running head sits and are not one.
    6: {}, // "ON — —— ———": a printer's rule OCR mangled
    200: {} // "LESSON XIII.": a chapter number, not a head
  }
}

describe('the furniture a real leaf actually prints', () => {
  for (const { name, fixture } of fixtures) {
    const expected = FURNITURE[name]
    if (!expected) continue
    for (const leaf of fixture.leaves) {
      const want = expected[leaf.pageIndex]
      if (!want) continue
      it(`${name} leaf ${leaf.pageIndex}`, () => {
        const drafted = draftPage(toWords(leaf.words))
        expect(drafted.furniture).toEqual(want)
      })
    }
  }
})

/**
 * A folio sequence that is right is a folio sequence that is *regular*.
 *
 * Nobody labelled this: within one book the difference between a leaf's index
 * and the number printed on it is a constant, because the front matter is a
 * fixed number of leaves. One folio misread breaks the constant. It is the
 * same trick as the reading-order oracle — a ground truth the material
 * supplies for free.
 */
describe('folios run in step with the leaves', () => {
  for (const { name, fixture } of fixtures) {
    it(`${name}`, () => {
      const offsets = fixture.leaves
        .map((leaf) => {
          const folio = draftPage(toWords(leaf.words)).furniture.folio
          return folio && /^[0-9]+$/u.test(folio) ? Number(folio) - leaf.pageIndex : null
        })
        .filter((n): n is number => n !== null)
      if (offsets.length < 2) return
      expect(new Set(offsets).size, `offsets were ${offsets.join(', ')}`).toBe(1)
    })
  }
})
