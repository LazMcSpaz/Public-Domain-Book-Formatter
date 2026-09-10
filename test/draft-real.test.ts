import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildVocabulary, draftPage, folioOffset, type DraftWord } from '@core/draft'

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
 * block — so a text that appears **both** ways on one leaf is ambiguous
 * evidence and is left out of the ground truth entirely.
 *
 * That used to go the other way: a text appearing as an ordinary word anywhere
 * counted as ordinary everywhere, on the grounds that the forgiving direction
 * "costs the oracle nothing it was relying on". Leaf 200 of Isis Vol. I
 * falsifies that. It carries a `:` that is a **2 × 5 pixel speck** at the right
 * margin, which lands on a line of its own between two real ones, and it also
 * carries ordinary colons elsewhere — so the speck was admitted to the ground
 * truth, and OCR having emitted it *after* the line below it read as the draft
 * scrambling a page it had laid out correctly.
 *
 * Excluding both is the honest reading: a glyph this module cannot place and
 * this oracle cannot vouch for is not evidence either way. What it costs is
 * recorded here rather than forgotten — every ordinary colon on such a leaf
 * stops being checked for order, which on these fixtures is 14 words across
 * 18 leaves.
 */
function ordinaryWords(words: readonly DraftWord[]): Set<string> {
  const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b)
  const body = heights[heights.length >> 1] ?? 1
  const keep = new Set<string>()
  const doubtful = new Set<string>()
  for (const w of words) {
    const height = w.bbox.y1 - w.bbox.y0
    const ordinary = w.confidence >= 60 && height >= body * 0.45 && height <= body * 1.8
    if (ordinary) keep.add(w.text)
    else doubtful.add(w.text)
  }
  for (const t of doubtful) keep.delete(t)
  return keep
}

/**
 * Where `part` stops appearing in `whole` in order, or -1 when it never does.
 *
 * Returns the index **in `part`** at which the match failed. It used to return
 * `part.indexOf(word)` — the first occurrence of that *text* — so a scramble of
 * the three hundredth `the` was reported as "word 2 of the draft", pointing a
 * reader at the wrong end of the page.
 */
function isSubsequence(part: readonly string[], whole: readonly string[]): number {
  let at = 0
  for (let i = 0; i < part.length; i++) {
    const found = whole.indexOf(part[i]!, at)
    if (found === -1) return i
    at = found + 1
  }
  return -1
}

/**
 * There is no known-failing list any more.
 *
 * There was one, holding `tight-scramble` leaf 7 as `it.fails` while the
 * scramble stood. The rework closed it, and the entry went with it rather than
 * being left behind as an empty object under a comment describing a fixture it
 * no longer named — which is what it had become.
 */
describe('the draft preserves the order the page was read in', () => {
  for (const { name, fixture } of fixtures) {
    for (const leaf of fixture.leaves) {
      it(`${name} leaf ${leaf.pageIndex} — ${leaf.words.length} words`, () => {
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
          ...split(drafted.furniture.folio ?? ''),
          // The scanner's stamp is furniture too. It is *recorded* rather than
          // discarded precisely so this holds — take the assignment out of
          // `draftPage` and these leaves fail again, which is the check.
          ...(drafted.furniture.stamp ?? []).flatMap(split)
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
 *
 * This used to demand unanimity, which was right until the fixture gained a
 * leaf whose folio really is misread: 126 is set `68` on the paper and OCR
 * reads it `63`. Unanimity has no way to say "one of these is wrong and here
 * it is", so the oracle is now `folioOffset` — the shipped rule — which votes
 * a plurality and **names the dissenters**. That is the better test: it asserts
 * the module rather than restating it, and a fixture leaf whose number is
 * genuinely misread is evidence rather than an exception to write down.
 */
describe('folios run in step with the leaves', () => {
  /** The leaves whose printed folio is known wrong, checked against the crop. */
  const misread: Record<string, number[]> = { 'isis-vol1': [126] }

  for (const { name, fixture } of fixtures) {
    it(`${name}`, () => {
      const sightings = fixture.leaves.flatMap((leaf) => {
        const folio = draftPage(toWords(leaf.words)).furniture.folio
        return folio ? [{ pageIndex: leaf.pageIndex, folio }] : []
      })
      if (sightings.length < 2) return
      const voted = folioOffset(sightings, 2)
      expect(voted.offset, `sightings were ${JSON.stringify(sightings)}`).not.toBeNull()
      expect(voted.dissenting).toEqual(misread[name] ?? [])
    })
  }
})

/**
 * The three rules Isis Unveiled needed, and the twelve leaves that guard them.
 *
 * This book is the first here whose scan carries a **digitization stamp** —
 * `Digitized by … CORNELL UNIVERSITY` at the foot of all 693 leaves — and the
 * first with **footnotes** at all: the four Panchadasi fixtures contain not one
 * between them, which is why the module had no rule for either.
 *
 * Both rules are geometric on purpose. The stamp is not matched on its words,
 * because OCR reads the same footer as `Digitized by`, `Diaitieed by`,
 * `— Oriainal from` and `CORMELL UNIVERSITY` across six leaves; a footnote is
 * not required to carry a reference mark, because a note running to a second
 * line has none. What the assertions below are really protecting is that
 * neither rule fires on the four books that have neither.
 */
describe('the scanner’s stamp is not the book', () => {
  const isis = fixtures.find((f) => f.name === 'isis-vol1')!

  it('never reaches a block, on any leaf that carries one', () => {
    for (const leaf of isis.fixture.leaves) {
      const draft = draftPage(toWords(leaf.words))
      const text = draft.blocks.map((b) => b.text).join(' ')
      expect(text, `leaf ${leaf.pageIndex}`).not.toMatch(/CORNELL|UNIVERSITY|Digitized|Oriainal/u)
      expect(
        draft.structural.some((s) => s.includes("scanner's own stamp")),
        `leaf ${leaf.pageIndex} took a stamp but did not say so`
      ).toBe(true)
    }
  })

  it('is never taken off a book that has none', () => {
    for (const { name, fixture } of fixtures) {
      if (name === 'isis-vol1') continue
      for (const leaf of fixture.leaves) {
        const draft = draftPage(toWords(leaf.words))
        expect(
          draft.structural.find((s) => s.includes("scanner's own stamp")),
          `${name} leaf ${leaf.pageIndex}`
        ).toBeUndefined()
      }
    }
  })

  /**
   * The counter-example that set `STAMP_MAX_LINES`.
   *
   * `tight-scramble` leaf 7 has the biggest gap of any leaf in any fixture —
   * 7.3 strides — and it sits under a chapter opening, near the *top*. An
   * unbounded walk up from the foot reaches it and takes the whole leaf.
   */
  it('leaves a chapter opening alone, though its gap is bigger than any stamp’s', () => {
    const leaf = fixtures.find((f) => f.name === 'tight-scramble')!.fixture.leaves[0]!
    const draft = draftPage(toWords(leaf.words))
    expect(draft.blocks.map((b) => b.text).join(' ')).toMatch(/LESSON/u)
  })

  /** `FINIS.` is a last line, set apart, and it is the book's own. */
  it('leaves FINIS. on the leaf', () => {
    const leaf = fixtures
      .find((f) => f.name === 'tight-clairvoyance')!
      .fixture.leaves.find((l) => l.pageIndex === 322)!
    const draft = draftPage(toWords(leaf.words))
    expect(draft.blocks.map((b) => b.text).join(' ')).toMatch(/FINIS/u)
  })
})

describe('footnotes are told from the text by their size', () => {
  const isis = fixtures.find((f) => f.name === 'isis-vol1')!
  const leafAt = (n: number) => isis.fixture.leaves.find((l) => l.pageIndex === n)!

  it('separates three notes on a leaf that sets three', () => {
    const draft = draftPage(toWords(leafAt(300).words))
    const notes = draft.blocks.filter((b) => b.kind === 'footnote')
    expect(notes).toHaveLength(3)
    expect(notes[0]!.text).toMatch(/W\. R\. Grove/u)
    // The third note is the one that measures *taller* than the body by median
    // box height, because `Godfrey`, `Higgins` and `archaeologist` all carry
    // ascenders. Type size is what catches it.
    expect(notes[2]!.text).toMatch(/Godfrey Higgins/u)
  })

  it('keeps a note that carries no reference mark, where it runs on', () => {
    const draft = draftPage(toWords(leafAt(650).words))
    const notes = draft.blocks.filter((b) => b.kind === 'footnote')
    expect(notes.some((n) => /doubted in regard to the naming/u.test(n.text))).toBe(true)
  })

  it('finds none in the four books that print none', () => {
    for (const { name, fixture } of fixtures) {
      if (name === 'isis-vol1') continue
      for (const leaf of fixture.leaves) {
        const draft = draftPage(toWords(leaf.words))
        expect(
          draft.blocks.filter((b) => b.kind === 'footnote'),
          `${name} leaf ${leaf.pageIndex}`
        ).toHaveLength(0)
      }
    }
  })
})

describe('a furniture line declined by a hair says so', () => {
  it('names the running head it kept, and by how much it missed', () => {
    const leaf = fixtures
      .find((f) => f.name === 'isis-vol1')!
      .fixture.leaves.find((l) => l.pageIndex === 101)!
    const draft = draftPage(toWords(leaf.words))
    // 35 against a threshold of 36: one pixel, and the head went into the body.
    expect(draft.furniture.runningHead).toBeUndefined()
    const said = draft.structural.find((s) => s.includes('BARRACHIAS'))
    expect(said, 'the decline was silent').toBeDefined()
    expect(said).toMatch(/close, so check the render/u)
  })
})

/**
 * The line-break hyphen, on leaves that really carry them.
 *
 * `draft` used to count these and leave them: 217 in one chapter of this
 * volume, every one a hand correction, and every one invisible until a page was
 * rendered because both OCR engines break the lines in the same place. The page
 * cannot settle `ad-`/`vanced` against `thought-`/`transference`; the book can,
 * and these fixtures carry both kinds plus the third — OCR damage that is not a
 * word at all and must be left alone.
 *
 * The vocabulary is built from the fixtures' own OCR (which credits no joined
 * form, by construction) plus the whole words being attested, one at a time, so
 * each assertion names the evidence it turns on.
 */
describe('the book settles a line-break hyphen the page cannot', () => {
  const isis = fixtures.find((f) => f.name.includes('isis'))!
  const leafAt = (pageIndex: number) => isis.fixture.leaves.find((l) => l.pageIndex === pageIndex)!
  const ocrOf = (pageIndex: number) =>
    leafAt(pageIndex)
      .words.map(([t]) => t)
      .join(' ')
  const draftOf = (pageIndex: number, attested: string[]) =>
    draftPage(toWords(leafAt(pageIndex).words), {
      vocabulary: buildVocabulary([ocrOf(pageIndex), attested.join(' ')])
    })

  it('joins a word the book sets whole somewhere else', () => {
    const text = draftOf(91, ['immensely', 'Alexandria'])
      .blocks.map((b) => b.text)
      .join(' ')
    expect(text).toContain('immensely')
    expect(text).toContain('Alexandria')
    expect(text).not.toContain('im- mensely')
  })

  /**
   * The case that makes an unconditional join wrong, and the reason assembly's
   * seam healing — which always strips the hyphen — is a guess.
   */
  it('keeps the hyphen on a compound the book sets hyphenated', () => {
    const drafted = draftOf(650, ['World-Mountain'])
    const text = drafted.blocks.map((b) => b.text).join(' ')
    expect(text).toContain('World-Mountain')
    expect(drafted.hyphens.find((h) => h.left === 'World')?.decision).toBe('keep')
  })

  /**
   * `sev- ral` and `mytho- gical` are OCR damage: neither half joins to a word
   * this book contains. Guessing them would be exactly the confident invention
   * the propose/accept rule exists to stop, and they are left character for
   * character so a reader still sees the break.
   */
  it('leaves OCR damage alone, and says it did', () => {
    const drafted = draftOf(91, ['immensely', 'Alexandria'])
    const text = drafted.blocks.map((b) => b.text).join(' ')
    expect(text).toContain('sev- ral')
    expect(text).toContain('mytho- gical')
    expect(drafted.hyphens.filter((h) => h.decision === 'unsettled').length).toBeGreaterThan(1)
    expect(drafted.structural.join(' ')).toMatch(/left as `ad- vanced`/)
  })

  /** `P- 97` is a page reference. A figure is never half of a broken word. */
  it('never treats a hyphen before a figure as a break', () => {
    const drafted = draftOf(91, ['immensely'])
    expect(drafted.hyphens.some((h) => h.right === '97')).toBe(false)
  })

  /**
   * Without a vocabulary the behaviour is exactly what it was — count them and
   * say so. A book barely started has nothing to weigh against, and a rule that
   * quietly did less evidence than it claimed would be worse than no rule.
   */
  it('changes nothing when it is given no vocabulary, and says why', () => {
    const drafted = draftPage(toWords(leafAt(91).words))
    expect(drafted.hyphens).toEqual([])
    expect(drafted.blocks.map((b) => b.text).join(' ')).toContain('im- mensely')
    expect(drafted.structural.join(' ')).toMatch(/line-break hyphen\(s\) are left/)
  })
})

/**
 * The furniture the leaf cannot settle and the volume can.
 *
 * A running head is decided from geometry alone, which is all one leaf has, and
 * on a real scan it is not quite enough: measured over Chapter II of this
 * volume, **7 of 34 leaves** carried a head that missed the standoff test by a
 * pixel or two and went into the body as a paragraph. That is worse than a
 * wrong word — it puts furniture into the prose and nothing downstream can tell.
 *
 * These three leaves are the three shapes it takes, all measured off the paper.
 */
describe('the volume’s numbering settles the furniture a leaf cannot', () => {
  const isis = fixtures.find((f) => f.name.includes('isis'))!
  const leafAt = (pageIndex: number) => isis.fixture.leaves.find((l) => l.pageIndex === pageIndex)!
  const drafted = (pageIndex: number, expectedFolio?: number) =>
    draftPage(
      toWords(leafAt(pageIndex).words),
      expectedFolio === undefined ? {} : { expectedFolio }
    )

  /** Leaf 101: `THE WISE BARRACHIAS-HASSAN-OGLU. 43` stands 35 off where 36 is wanted. */
  it('rescues a head that misses the standoff and carries the right number', () => {
    expect(drafted(101).furniture.runningHead).toBeUndefined()
    const guided = drafted(101, 43)
    expect(guided.furniture.runningHead).toBe('THE WISE BARRACHIAS-HASSAN-OGLU.')
    expect(guided.furniture.folio).toBe('43')
    expect(guided.structural.join(' ')).toMatch(/taken anyway/)
  })

  /** Leaf 109: the head runs to 73% of the measure and its `51` reads `5I`. */
  it('rescues a head too wide for the width test, and takes the folio off it', () => {
    expect(drafted(109).furniture.runningHead).toBeUndefined()
    const guided = drafted(109, 51)
    expect(guided.furniture.runningHead).toBe('THE ALKAHEST NO FICTION.')
    expect(guided.furniture.folio).toBe('51')
  })

  /**
   * Leaf 126 is the one the rule must **not** settle. The paper is set `68` —
   * checked at 1200 DPI, an old-style 8 OCR read as a 3 — and from inside the
   * draft a misread number and a book that misnumbers its own leaf are
   * indistinguishable. A reprint does not renumber its original, so this is
   * reported with both numbers and nothing is changed.
   */
  it('reports a folio that disagrees with the volume, and changes nothing', () => {
    const guided = drafted(126, 68)
    expect(guided.furniture.folio).toBe('63')
    expect(guided.structural.join(' ')).toMatch(
      /folio here reads "63" where the volume's numbering predicts "68"/
    )
    expect(guided.structural.join(' ')).toMatch(/Nothing was changed/)
  })

  /**
   * The false positive this rule could produce: a body line that happens to
   * carry the leaf's own number would be lifted out of the prose. Nothing
   * guards that but the geometry it is overriding, so the leaves that already
   * decide correctly must decide the same way with a folio in hand.
   */
  it('changes nothing on the leaves the geometry already settles', () => {
    for (const pageIndex of [91, 99, 200, 300, 400, 650]) {
      const plain = drafted(pageIndex)
      const guided = drafted(pageIndex, pageIndex - 58)
      // Leaf 91 is the one leaf here the folio *does* change: its lone `3` is
      // the signature for gathering 3, which nothing without a folio can know.
      const rest = { ...guided.furniture }
      delete rest.signature
      expect(rest, `leaf ${pageIndex}`).toEqual(plain.furniture)
      expect(guided.blocks.length, `leaf ${pageIndex}`).toBe(plain.blocks.length)
    }
  })
})

/**
 * A report that is not true is the failure mode this module exists to avoid,
 * and the foot of a leaf produced one on six leaves of one chapter: a footnote
 * line drew `"* W. Crookes, F.R.S. …" sits at the foot of the leaf but was kept
 * as text`, while the note pass — which runs after the furniture pass — was
 * lifting exactly that line into a `footnote` block. It sent a reader to look
 * at six lines that were already right.
 */
describe('the foot of a leaf does not call a footnote body text', () => {
  const isis = fixtures.find((f) => f.name.includes('isis'))!

  it('says nothing about a line the note pass is about to take', () => {
    const leaf = isis.fixture.leaves.find((l) => l.pageIndex === 101)!
    const d = draftPage(toWords(leaf.words))
    expect(d.blocks.filter((b) => b.kind === 'footnote')).toHaveLength(1)
    expect(d.structural.filter((s) => /sits at the foot/.test(s))).toEqual([])
  })

  it('leaves every other leaf’s blocks and folio exactly as they were', () => {
    // The guard suppresses a message and must change nothing else. These are
    // the readings from before it existed, written down so a future edit to it
    // cannot quietly move a folio or a block boundary.
    const expected: Record<number, { notes: number; folio?: string; blocks: number }> = {
      91: { notes: 0, folio: '33', blocks: 4 },
      99: { notes: 0, folio: '41', blocks: 2 },
      101: { notes: 1, blocks: 4 },
      109: { notes: 0, blocks: 5 },
      126: { notes: 3, folio: '63', blocks: 6 },
      200: { notes: 1, folio: '142', blocks: 7 },
      300: { notes: 3, folio: '242', blocks: 5 },
      400: { notes: 3, folio: '342', blocks: 6 },
      650: { notes: 3, folio: '592', blocks: 11 }
    }
    for (const leaf of isis.fixture.leaves) {
      const want = expected[leaf.pageIndex]
      if (!want) continue
      const d = draftPage(toWords(leaf.words))
      expect(
        {
          notes: d.blocks.filter((b) => b.kind === 'footnote').length,
          ...(d.furniture.folio === undefined ? {} : { folio: d.furniture.folio }),
          blocks: d.blocks.length
        },
        `leaf ${leaf.pageIndex}`
      ).toEqual(want)
    }
  })
})

/**
 * The printer's signature mark, on the two leaves of this volume that carry
 * one in the fixture.
 *
 * It arrived as a block of body text and then as a query on every sixteenth
 * leaf — three identical questions to the editor across two chapters, about a
 * figure that is not part of the book. It is the binder's.
 */
describe("a signature mark is the printer's, not the book's", () => {
  const isis = fixtures.find((f) => f.name.includes('isis'))!
  const leafAt = (pageIndex: number) => isis.fixture.leaves.find((l) => l.pageIndex === pageIndex)!
  const drafted = (pageIndex: number, expectedFolio?: number) =>
    draftPage(
      toWords(leafAt(pageIndex).words),
      expectedFolio === undefined ? {} : { expectedFolio }
    )

  it('takes the lone figure off the foot and says the arithmetic', () => {
    for (const [pageIndex, folio, mark] of [
      // Leaf 91 was in this fixture long before the rule was, as the
      // footnote-heavy leaf that decides `bodyTypeSize`. Its lone `3` at the
      // foot went unnoticed for exactly as long, and is folio 33 — the first
      // leaf of gathering 3. Confirmed on the render at 900 DPI.
      [91, 33, '3'],
      [155, 97, '7'],
      [171, 113, '8']
    ] as const) {
      const plain = drafted(pageIndex)
      expect(plain.furniture.signature, `leaf ${pageIndex} without a folio`).toBeUndefined()
      expect(
        plain.blocks.map((b) => b.text).join(' '),
        `leaf ${pageIndex} without a folio`
      ).toContain(mark)

      const guided = drafted(pageIndex, folio)
      expect(guided.furniture.signature, `leaf ${pageIndex}`).toBe(mark)
      expect(guided.structural.join(' '), `leaf ${pageIndex}`).toMatch(
        /signature mark.*gathered in\s+16s/su
      )
      expect(
        guided.blocks[guided.blocks.length - 1]!.text.trim().endsWith(mark),
        `leaf ${pageIndex}: the mark is still in the text`
      ).toBe(false)
    }
  })

  /**
   * The rule may only take a figure whose arithmetic lands. Every other leaf of
   * the fixture has a folio in hand and must come back with no signature at
   * all — otherwise it is eating numerals out of the book.
   */
  it('takes nothing off any other leaf', () => {
    for (const leaf of isis.fixture.leaves) {
      if ([91, 155, 171].includes(leaf.pageIndex)) continue
      expect(
        drafted(leaf.pageIndex, leaf.pageIndex - 58).furniture.signature,
        `leaf ${leaf.pageIndex}`
      ).toBeUndefined()
    }
  })
})
