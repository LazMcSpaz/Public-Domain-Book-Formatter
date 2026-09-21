import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  largestImageCoverage,
  SCANNED_COVERAGE,
  shapeOfPdf,
  shapeOfEpub,
  declaredShape,
  parseShape,
  describeShape,
  routeFor,
  routeKey,
  routeTable,
  withRouteTable,
  allRoutes,
  STAGE_IDS,
  FLOW_BEGIN,
  FLOW_END,
  type BookShape,
  type PdfMeasurement,
  type PageSample
} from '@core/provenance'

/** pdf.js's opcode numbers, as the walk is handed them. Arbitrary here; only identity matters. */
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  formBegin: 74,
  formEnd: 75,
  image: [85, 83, 86]
}

/** `pdfjs.Util.transform`, verbatim: the product of two PDF matrices. */
const multiply = (m1: number[], m2: number[]): number[] => [
  m1[0]! * m2[0]! + m1[2]! * m2[1]!,
  m1[1]! * m2[0]! + m1[3]! * m2[1]!,
  m1[0]! * m2[2]! + m1[2]! * m2[3]!,
  m1[1]! * m2[2]! + m1[3]! * m2[3]!,
  m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
  m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!
]

const PAGE = { w: 612, h: 792 }

describe('largestImageCoverage — is this page a photograph?', () => {
  it('reads the drawn size off the transform in force when the image is painted', () => {
    const fn = [OPS.save, OPS.transform, OPS.image[0]!, OPS.restore]
    const args = [null, [PAGE.w * 0.9, 0, 0, PAGE.h * 0.9, 30, 40], ['im1'], null]
    const c = largestImageCoverage(fn, args, PAGE.w * PAGE.h, OPS, multiply)
    expect(c).toBeCloseTo(0.81, 5)
    expect(c).toBeGreaterThanOrEqual(SCANNED_COVERAGE)
  })

  it('is zero for a page that draws no image', () => {
    const fn = [OPS.save, OPS.transform, OPS.restore]
    const args = [null, [PAGE.w, 0, 0, PAGE.h, 0, 0], null]
    expect(largestImageCoverage(fn, args, PAGE.w * PAGE.h, OPS, multiply)).toBe(0)
  })

  it('a decorative header on a typeset page does not make it a scan', () => {
    const fn = [OPS.save, OPS.transform, OPS.image[2]!, OPS.restore]
    const args = [null, [PAGE.w * 0.5, 0, 0, 40, 0, 700], ['inline'], null]
    expect(largestImageCoverage(fn, args, PAGE.w * PAGE.h, OPS, multiply)).toBeLessThan(0.1)
  })

  it('a restore undoes the transform, so a later image is measured afresh', () => {
    const fn = [OPS.save, OPS.transform, OPS.restore, OPS.transform, OPS.image[0]!]
    const args = [null, [2, 0, 0, 2, 0, 0], null, [PAGE.w * 0.3, 0, 0, PAGE.h * 0.3, 0, 0], ['im']]
    // 0.09 with the restore honoured; 0.36 if the doubled transform leaked through.
    expect(largestImageCoverage(fn, args, PAGE.w * PAGE.h, OPS, multiply)).toBeCloseTo(0.09, 5)
  })

  it('applies a form XObject’s own matrix, which pdf.js delivers as its own opcode', () => {
    // The Human Aura paints its scans inside a form scaled 2:1. Ignore the
    // form's matrix and every leaf measures a quarter of the page and is
    // called typeset; honour it and the leaf is the photograph it is.
    const fn = [OPS.formBegin, OPS.transform, OPS.image[0]!, OPS.formEnd]
    const args = [
      [[2, 0, 0, 2, 0, 0], null],
      [PAGE.w * 0.5, 0, 0, PAGE.h * 0.5, 0, 0],
      ['im'],
      null
    ]
    const c = largestImageCoverage(fn, args, PAGE.w * PAGE.h, OPS, multiply)
    expect(c).toBeCloseTo(1, 5)
    expect(c).toBeGreaterThanOrEqual(SCANNED_COVERAGE)
  })

  it('an image mask counts as an image', () => {
    const fn = [OPS.transform, OPS.image[1]!]
    const args = [[PAGE.w, 0, 0, PAGE.h, 0, 0], ['mask']]
    expect(largestImageCoverage(fn, args, PAGE.w * PAGE.h, OPS, multiply)).toBeCloseTo(1, 5)
  })
})

/** A sample as the platform hands one over. */
const sample = (page: number, coverage: number, text: number): PageSample => ({
  page,
  coverage,
  scanned: coverage >= SCANNED_COVERAGE,
  text
})

/**
 * Every PDF on the shelf, measured under Node on 2026-09-21 with the same
 * walk: eight evenly spaced leaves each, coverage and characters of text.
 * These are measurements, not inventions, and the expected route is the one
 * each book was in fact read by.
 */
const SHELF: { name: string; m: PdfMeasurement; route: string; layer: string }[] = [
  {
    name: 'Patterns Vol. I — a .doc of somebody’s OCR printed to PDF in 2016',
    m: {
      pages: 121,
      producer: 'Acrobat PDFWriter 5.0 for Windows NT',
      creator: 'Patterns of the Hypnotic Techniques of Milton Erickson Vol I.doc - Microsoft Word',
      samples: [99, 4676, 1862, 4376, 5160, 2513, 5377, 4043].map((t, i) => sample(i * 15, 0, t))
    },
    route: 'converted-text',
    layer: 'converted'
  },
  {
    name: 'Patterns Vol. II — archive.org scan with its OCR under it',
    m: {
      pages: 237,
      producer: 'Internet Archive PDF 1.4.24; including mupdf and pymupdf/skimage',
      creator: 'Internet Archive',
      samples: [118, 2052, 1881, 1102, 1180, 1347, 1289, 1357].map((t, i) => sample(i * 29, 1, t))
    },
    route: 'scan-with-layer',
    layer: 'converted'
  },
  {
    name: 'Clairvoyance — LuraDocument scan, OCR under it',
    m: {
      pages: 328,
      producer: 'Recoded by LuraDocument PDF v2.16',
      creator: null,
      samples: [
        sample(0, 0.94, 0),
        ...[1532, 1489, 1380, 1515, 1496, 1367, 1547].map((t, i) => sample(41 * (i + 1), 0.86, t))
      ]
    },
    route: 'scan-with-layer',
    layer: 'converted'
  },
  {
    name: 'Thought Vibration — Google Books scan, text only on Google’s own first page',
    m: {
      pages: 161,
      producer: 'Google Books PDF Converter (rel 1 21/8/06)',
      creator: null,
      samples: [sample(0, 0.02, 2923), ...[1, 2, 3, 4, 5, 6, 7].map((i) => sample(i * 20, 0.67, 0))]
    },
    route: 'scan',
    layer: 'none'
  },
  {
    name: 'The Human Aura — Acrobat Paper Capture, scans inside a form scaled 2:1',
    m: {
      pages: 88,
      producer: 'Adobe Acrobat 10.1.4 Paper Capture Plug-in',
      creator: null,
      samples: [0, 1140, 1002, 1165, 1101, 1071, 1057, 236].map((t, i) => sample(i * 11, 2.21, t))
    },
    route: 'scan-with-layer',
    layer: 'converted'
  },
  {
    name: 'Uncommon Therapy — AppleWorks through Ghostscript, no images',
    m: {
      pages: 210,
      producer: 'GPL Ghostscript 9.55.0',
      creator: 'AppleWorks',
      samples: [113, 2680, 4044, 4313, 4080, 3698, 3388, 3725].map((t, i) => sample(i * 26, 0, t))
    },
    route: 'converted-text',
    layer: 'converted'
  }
]

describe('shapeOfPdf — every book on the shelf resolves to the route it was read by', () => {
  for (const book of SHELF) {
    it(book.name, () => {
      const s = shapeOfPdf(book.m)
      expect(s.how).toBe('measured')
      expect(s.container).toBe('pdf')
      expect(s.textLayer).toBe(book.layer)
      expect(routeKey(s)).toBe(book.route)
      expect(s.evidence.some((e) => /sampled leaves are a photograph/u.test(e))).toBe(true)
    })
  }

  it('decides the text layer by the majority of pages, never by the mean', () => {
    // Thought Vibration: 2,923 characters of Google boilerplate on the first
    // page and nothing on the other seven. The mean is 365 a page, over the
    // floor; the majority is one page in eight.
    const s = shapeOfPdf(SHELF[3]!.m)
    expect(s.textLayer).toBe('none')
    expect(s.externalText).toBe(false)
  })

  it('a layer under pixels is a second digitisation, whoever produced it', () => {
    const s = shapeOfPdf(SHELF[1]!.m)
    expect(s.pixels).toBe(true)
    expect(s.externalText).toBe(true)
  })

  it('a text layer with no pixels is taken as somebody’s OCR unless a compositor is named', () => {
    const typed = shapeOfPdf({ ...SHELF[0]!.m, producer: 'pdfTeX-1.40.25', creator: 'LaTeX' })
    expect(typed.textLayer).toBe('typeset')
    expect(routeKey(typed)).toBe('typeset-text')
    // Word is what an OCR'd typescript gets printed through as well.
    expect(shapeOfPdf(SHELF[0]!.m).textLayer).toBe('converted')
  })

  it('a compositor named under pixels changes nothing: nobody types text under a photograph', () => {
    const s = shapeOfPdf({ ...SHELF[1]!.m, producer: 'pdfTeX' })
    expect(s.textLayer).toBe('converted')
  })

  it('names this app’s own export, which is not a source', () => {
    const s = shapeOfPdf({
      pages: 200,
      producer: 'Public-Domain Book Formatter',
      creator: null,
      samples: [1, 2, 3, 4].map((i) => sample(i, 0, 2000))
    })
    expect(s.evidence.some((e) => /export of this app/u.test(e))).toBe(true)
    expect(s.textLayer).toBe('converted')
  })

  it('a file with neither pixels nor text has nothing to read', () => {
    const s = shapeOfPdf({ pages: 3, producer: null, creator: null, samples: [sample(0, 0, 0)] })
    expect(routeKey(s)).toBe('nothing-to-read')
    expect(routeFor(s).stages.every((st) => !st.runs)).toBe(true)
  })
})

describe('shapeOfEpub', () => {
  it('trusts a publisher known to type its text, and nobody else', () => {
    expect(shapeOfEpub({ publisher: 'Standard Ebooks' }).textLayer).toBe('typeset')
    expect(shapeOfEpub({ publisher: 'Project Gutenberg' }).textLayer).toBe('typeset')
    expect(shapeOfEpub({ publisher: 'Advanced Thought Publishing Co.' }).textLayer).toBe(
      'converted'
    )
    expect(shapeOfEpub({ publisher: null }).textLayer).toBe('converted')
  })

  it('is never pixels', () => {
    const s = shapeOfEpub({ publisher: 'Standard Ebooks' })
    expect(s.pixels).toBe(false)
    expect(s.container).toBe('epub')
    expect(routeKey(s)).toBe('typeset-text')
  })
})

describe('declaredShape and parseShape', () => {
  const isis: BookShape = declaredShape(
    { pixels: true, textLayer: 'none', externalText: false, container: 'pdf' },
    'the scan is 357 MB and past what the shelf holds; scan.md says there is no text layer'
  )

  it('a declaration needs its reason', () => {
    expect(() =>
      declaredShape(
        { pixels: true, textLayer: 'none', externalText: false, container: 'pdf' },
        '  '
      )
    ).toThrow(/reason/u)
    expect(isis.how).toBe('declared')
    expect(isis.evidence).toHaveLength(1)
  })

  it('survives the round trip through a stored record', () => {
    expect(parseShape(JSON.parse(JSON.stringify(isis)))).toEqual(isis)
  })

  it('refuses a shape that would route a book down a path no code takes', () => {
    for (const bad of [
      null,
      'scan',
      { ...isis, textLayer: 'ocr' },
      { ...isis, container: 'djvu' },
      { ...isis, how: 'guessed' },
      { ...isis, pixels: 'yes' },
      Object.fromEntries(Object.entries(isis).filter(([k]) => k !== 'externalText'))
    ]) {
      expect(parseShape(bad)).toBeNull()
    }
  })

  it('describes each shape in one line a person can read', () => {
    expect(describeShape(isis)).toMatch(/photographed leaves with no text layer, declared/u)
    expect(describeShape(shapeOfPdf(SHELF[0]!.m))).toMatch(/OCR with no page images/u)
    expect(describeShape(shapeOfEpub({ publisher: 'Standard Ebooks' }))).toMatch(
      /typeset text.*epub/u
    )
  })
})

describe('the route table', () => {
  it('lists every stage once on every route', () => {
    for (const r of allRoutes()) {
      expect(r.stages.map((s) => s.id)).toEqual([...STAGE_IDS])
      for (const s of r.stages) expect(s.why.length).toBeGreaterThan(10)
    }
  })

  it('a crop is refused wherever there are no pixels, and offered wherever there are', () => {
    for (const r of allRoutes()) {
      const crops = r.stages.find((s) => s.id === 'crops')!
      const concordance = r.stages.find((s) => s.id === 'concordance')!
      const pixels = r.key === 'scan' || r.key === 'scan-with-layer'
      expect(crops.runs).toBe(pixels)
      if (r.key !== 'nothing-to-read') expect(concordance.runs).toBe(!pixels)
    }
  })

  it('docs/FLOW.md carries exactly the table this code generates', () => {
    const doc = readFileSync(resolve(__dirname, '..', 'docs', 'FLOW.md'), 'utf8')
    const begin = doc.indexOf(FLOW_BEGIN)
    const end = doc.indexOf(FLOW_END)
    expect(begin).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(begin)
    const generated = doc.slice(begin + FLOW_BEGIN.length, end)
    expect(generated.trim()).toBe(routeTable().trim())
    // And regenerating it changes nothing.
    expect(withRouteTable(doc)).toBe(doc)
  })

  it('withRouteTable refuses a doc that has lost its markers', () => {
    expect(() => withRouteTable('# Flow\n\nnothing here\n')).toThrow(/markers/u)
  })
})
