import { describe, it, expect } from 'vitest'
import {
  buildExport,
  editionFromAnswers,
  publicDomainNotice,
  safeFileName,
  type EditionDetails
} from '@core/export'
import { assembleBook } from '@core/assemble'
import type { BookDocument } from '@core/assemble'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'
import type { PageRole } from '@core/pages'
import { defaultStyleProfile } from '@core/style'

function page(
  pageIndex: number,
  blocks: TranscribedBlock[],
  role: PageRole = 'body'
): PageTranscription {
  return { pageIndex, role, blocks, uncertain: [], furniture: {} }
}

const sampleDoc = (): BookDocument =>
  assembleBook([
    page(0, [{ kind: 'paragraph', text: 'THE ALCHEMIST' }], 'title-page'),
    page(1, [
      { kind: 'heading', text: 'Chapter I', level: 1 },
      { kind: 'paragraph', text: 'The alembick being set upon a gentle fire.' }
    ])
  ])

const edition = (patch: Partial<EditionDetails> = {}): EditionDetails => ({
  title: 'The Alchemist His Practise',
  author: 'Anonymous',
  imprint: 'Blackthorn Press',
  copyrightHolder: 'A. Reprinter',
  isbn: '978-0-00-000000-0',
  editionDate: '2026',
  editionStatement: 'A new edition of the 1662 original.',
  notices: [],
  seriesLine: null,
  epigraph: null,
  imprintLine: null,
  works: [],
  ...patch
})

const build = (patch: Partial<EditionDetails> = {}, profile = defaultStyleProfile()) =>
  buildExport({
    document: sampleDoc(),
    profile,
    edition: edition(patch),
    estimatedPageCount: 180
  })

describe('safeFileName', () => {
  it('slugifies a title', () => {
    expect(safeFileName('The Alchemist His Practise', 'tex')).toBe('the-alchemist-his-practise.tex')
  })

  it('strips accents and punctuation rather than passing them to the filesystem', () => {
    expect(safeFileName('Œuvres: Naïve & Co. (1662)', 'pdf')).toBe('uvres-naive-co-1662.pdf')
  })

  it('falls back to a usable name when the title has nothing to slugify', () => {
    expect(safeFileName('———', 'tex')).toBe('book.tex')
    expect(safeFileName('', 'tex')).toBe('book.tex')
  })

  it('bounds the length so no filesystem rejects it', () => {
    const name = safeFileName('word '.repeat(80), 'tex')
    expect(name.length).toBeLessThanOrEqual(64)
  })
})

describe('publicDomainNotice', () => {
  it('names the original year when it is known', () => {
    expect(publicDomainNotice('1662')).toContain('first published in 1662')
  })

  it('still makes the claim when the year is unknown', () => {
    const text = publicDomainNotice(null)
    expect(text).toContain('public domain')
    expect(text).not.toContain('first published in')
    // The comma belongs to the clause the year sits in. Without this the
    // copyright page of a volume of two works — which has no single original
    // year — read "The original work, is in the public domain."
    expect(text).toContain('The original work is in the public domain')
  })

  it('is explicit that only this edition is new', () => {
    expect(publicDomainNotice('1662')).toContain('typesetting and design are new')
  })
})

describe('editionFromAnswers — the copyright page’s other two lines', () => {
  it('says the edition is annotated only when the editor claims it', () => {
    expect(editionFromAnswers({ annotatedNotice: true }).notices.join(' ')).toContain(
      'annotated edition'
    )
    // A book with nothing added must not carry the claim, and the answer
    // missing is not the same as the answer being yes.
    expect(editionFromAnswers({}).notices.join(' ')).not.toContain('annotated edition')
    expect(editionFromAnswers({ annotatedNotice: false }).notices.join(' ')).not.toContain(
      'annotated edition'
    )
  })

  it('prints the scanning library’s credit as given', () => {
    const credit = 'Digitized by the Internet Archive from a University of California copy.'
    expect(editionFromAnswers({ sourceNotice: credit }).notices).toContain(credit)
    // Blank is "not given", not "given as blank" — an empty line on a
    // copyright page is a hole nobody can explain later.
    expect(editionFromAnswers({ sourceNotice: '   ' }).notices).toHaveLength(1)
  })
})

describe('editionFromAnswers', () => {
  it('carries the export gate’s title and author through', () => {
    const e = editionFromAnswers({ title: 'The Alchemist', author: 'Anonymous' })
    expect(e.title).toBe('The Alchemist')
    expect(e.author).toBe('Anonymous')
  })

  it('treats blank fields as absent rather than as empty values', () => {
    const e = editionFromAnswers({ imprint: '   ', isbn: '' })
    expect(e.imprint).toBeNull()
    expect(e.isbn).toBeNull()
  })

  it('never produces an untitled-but-not-labelled book', () => {
    expect(editionFromAnswers({}).title).toBe('Untitled')
  })

  it('adds the public-domain notice by default', () => {
    expect(editionFromAnswers({ originalYear: '1662' }).notices[0]).toContain('1662')
  })

  it('omits the notice only when the user declined it', () => {
    expect(editionFromAnswers({ publicDomainNotice: false }).notices).toEqual([])
  })
})

describe('buildExport', () => {
  it('names the file after the book, as a PDF', () => {
    // There is no .tex any more; the interior is the deliverable.
    expect(build().fileName).toBe('the-alchemist-his-practise.pdf')
  })

  it('reports the KDP checks before the book has been laid out', () => {
    const { validation } = build()
    expect(validation.checks.length).toBeGreaterThan(0)
    expect(validation.pageCount).toBe(180)
  })

  it('tells the user what was left out rather than letting it pass silently', () => {
    const { notes } = buildExport({
      document: assembleBook([
        page(0, [{ kind: 'paragraph', text: 'Title' }], 'title-page'),
        page(1, [
          { kind: 'paragraph', text: 'Prose with no chapters.' },
          { kind: 'footnote', text: 'A stranded note.', marker: '9' }
        ])
      ]),
      profile: defaultStyleProfile(),
      edition: edition({ isbn: null }),
      estimatedPageCount: 100
    })
    expect(notes.join(' ')).toContain('no table of contents')
    expect(notes.join(' ')).toContain('footnote')
    expect(notes.join(' ')).toContain('not transcribed')
    expect(notes.join(' ')).toContain('No ISBN')
  })

  it('says nothing when there is nothing to report', () => {
    const { notes } = buildExport({
      document: assembleBook([
        page(0, [
          { kind: 'heading', text: 'Chapter I', level: 1 },
          { kind: 'paragraph', text: 'Clean prose.' }
        ])
      ]),
      profile: defaultStyleProfile(),
      edition: edition(),
      estimatedPageCount: 100
    })
    expect(notes).toEqual([])
  })
})

describe('buildExport — honesty about what has not happened yet', () => {
  const check = (result: ReturnType<typeof build>, id: string) =>
    result.validation.checks.find((c) => c.id === id)!

  it('does not present the scan’s page count as the spine measurement', () => {
    const pageCount = check(build(), 'page-count')
    expect(pageCount.level).toBe('pending')
    expect(pageCount.label).toContain('estimated')
    expect(pageCount.detail).toContain('Typeset the book before')
  })

  it('does not claim there are no layout warnings before anything is typeset', () => {
    const warnings = check(build(), 'latex-warnings')
    expect(warnings.level).toBe('pending')
    expect(warnings.detail).toContain('Not checked yet')
  })

  it('reports real numbers once the book has actually been laid out', () => {
    const result = buildExport({
      document: sampleDoc(),
      profile: defaultStyleProfile(),
      edition: edition(),
      estimatedPageCount: 180,
      typeset: { pageCount: 312, warnings: ['Overfull \\hbox in paragraph at lines 88--90'] }
    })
    const pageCount = result.validation.checks.find((c) => c.id === 'page-count')!
    expect(pageCount.level).toBe('ok')
    expect(pageCount.detail).toContain('312 pages')
    expect(result.validation.pageCount).toBe(312)

    const warnings = result.validation.checks.find((c) => c.id === 'latex-warnings')!
    expect(warnings.level).toBe('warn')
    expect(warnings.detail).toContain('1 line(s)')
  })

  it('is still "ready" pre-compile — an unmeasured count is a caveat, not a failure', () => {
    expect(build().validation.ready).toBe(true)
  })
})

describe('buildExport — the structure gate’s footnote choice', () => {
  const withOrphan = () =>
    assembleBook([
      page(0, [
        { kind: 'paragraph', text: 'No marker anywhere in this text.' },
        { kind: 'footnote', text: 'A stranded note.', marker: '9' }
      ])
    ])

  const buildWith = (omitOrphanFootnotes: boolean) =>
    buildExport({
      document: withOrphan(),
      profile: defaultStyleProfile(),
      edition: edition(),
      estimatedPageCount: 100,
      omitOrphanFootnotes
    })

  it('says the notes were collected at the end when the user asked for that', () => {
    expect(buildWith(false).notes.join(' ')).toContain('collected at the end')
  })

  it('says they were left out when the user asked for that instead', () => {
    expect(buildWith(true).notes.join(' ')).toContain('left out')
  })
})

describe('buildExport — a book whose only heading is the editor’s own', () => {
  it('still has a table of contents, and says whose headings are in it', () => {
    // Counting only the book's own chapters said "no table of contents" for a
    // book that demonstrably had one, because the engine lists sections too.
    const doc = assembleBook([page(0, [{ kind: 'paragraph', text: 'Plain prose.' }])])
    const withIntro = {
      ...doc,
      sections: [
        {
          id: 'intro',
          placement: 'front' as const,
          title: 'Introduction',
          blocks: [{ id: 'intro/b0', kind: 'paragraph' as const, text: 'Mine.', sourcePages: [] }]
        }
      ]
    }
    const { notes } = buildExport({
      document: withIntro,
      profile: defaultStyleProfile(),
      edition: edition(),
      estimatedPageCount: 100,
      typeset: { pageCount: 40, warnings: [] }
    })
    const text = notes.join(' ')
    expect(text).not.toContain('no table of contents')
    expect(text).toContain('1 heading(s), 1 of them yours')
  })

  it('still says there is none when there is nothing to list', () => {
    const { notes } = buildExport({
      document: assembleBook([page(0, [{ kind: 'paragraph', text: 'Plain prose.' }])]),
      profile: defaultStyleProfile(),
      edition: edition(),
      estimatedPageCount: 100,
      typeset: { pageCount: 40, warnings: [] }
    })
    expect(notes.join(' ')).toContain('no table of contents')
  })
})

describe('buildExport — the account it gives of the pictures', () => {
  const illustrated = () =>
    assembleBook(
      [
        page(0, [
          { kind: 'paragraph', text: 'The alembick being set upon a gentle fire.' },
          { kind: 'caption', text: 'Fig. 1. The alembick.' }
        ])
      ],
      {
        illustrations: [
          { id: 'fig1', pageIndex: 0, sourceWidth: 1200, sourceHeight: 800 },
          { id: 'fig2', pageIndex: 0, sourceWidth: 600, sourceHeight: 400 }
        ]
      }
    )

  const report = (typeset: Parameters<typeof buildExport>[0]['typeset']) =>
    buildExport({
      document: illustrated(),
      profile: defaultStyleProfile(),
      edition: edition(),
      estimatedPageCount: 100,
      ...(typeset ? { typeset } : {})
    })

  const imageCheck = (result: ReturnType<typeof report>) =>
    result.validation.checks.find((c) => c.id === 'image-dpi')!

  it('measures the DPI of what was placed rather than reporting nothing to check', () => {
    // The whole point of this check. It read "No placed images to check" for as
    // long as nothing could place one, which looked like a pass.
    const check = imageCheck(
      report({
        pageCount: 40,
        warnings: [],
        imagesPlaced: [
          { id: 'fig1', pageIndex: 4, dpi: 420 },
          { id: 'fig2', pageIndex: 9, dpi: 380 }
        ]
      })
    )
    expect(check.level).toBe('ok')
    expect(check.detail).toContain('300 DPI')
    expect(check.detail).not.toContain('No placed images')
  })

  it('warns about a picture scaled past what its scan supports', () => {
    const check = imageCheck(
      report({
        pageCount: 40,
        warnings: [],
        imagesPlaced: [
          { id: 'fig1', pageIndex: 4, dpi: 420 },
          { id: 'fig2', pageIndex: 9, dpi: 147 }
        ]
      })
    )
    expect(check.level).toBe('warn')
    expect(check.detail).toContain('1 image(s)')
  })

  it('says how many were set, and how many carried their caption', () => {
    const { notes } = report({
      pageCount: 40,
      warnings: [],
      imagesPlaced: [
        { id: 'fig1', pageIndex: 4, dpi: 420 },
        { id: 'fig2', pageIndex: 9, dpi: 380 }
      ]
    })
    expect(notes.join(' ')).toContain('2 illustrations set into the book')
    expect(notes.join(' ')).toContain('2 cut from the scan')
    expect(notes.join(' ')).toContain('1 with the caption it was printed under')
  })

  it('does not say a picture the editor supplied carries a printed caption', () => {
    // It was never printed anywhere. Counting it with the scanned ones would be
    // describing a scan that does not exist.
    const doc = illustrated()
    const withOwn = {
      ...doc,
      illustrations: [
        ...doc.illustrations,
        {
          id: 'mine',
          pageIndex: -1,
          sourceWidth: 1000,
          sourceHeight: 800,
          caption: 'The author, from life.',
          origin: 'supplied' as const
        }
      ]
    }
    const { notes } = buildExport({
      document: withOwn,
      profile: defaultStyleProfile(),
      edition: edition(),
      estimatedPageCount: 100,
      typeset: {
        pageCount: 40,
        warnings: [],
        imagesPlaced: [
          { id: 'fig1', pageIndex: 4, dpi: 420 },
          { id: 'fig2', pageIndex: 9, dpi: 380 },
          { id: 'mine', pageIndex: 12, dpi: 350 }
        ]
      }
    })
    const text = notes.join(' ')
    expect(text).toContain('3 illustrations set into the book')
    expect(text).toContain('2 cut from the scan')
    expect(text).toContain('1 of your own')
    // The one caption counted as printed is the scan's, not the editor's.
    expect(text).toContain('1 with the caption it was printed under')
  })

  it('never lets one go missing quietly', () => {
    const { notes } = report({
      pageCount: 40,
      warnings: [],
      imagesPlaced: [{ id: 'fig1', pageIndex: 4, dpi: 420 }],
      imagesDropped: [{ id: 'fig2', reason: 'its pixels could not be cut out of the scan' }]
    })
    expect(notes.join(' ')).toContain('1 illustration(s) could not be set')
    expect(notes.join(' ')).toContain('could not be cut out of the scan')
  })

  it('says nothing about pictures before the book has been laid out', () => {
    // Where they land, and so what resolution they get, is not known yet —
    // and a count of what "will" be set is a promise this cannot make.
    const { notes } = report(undefined)
    expect(notes.join(' ')).not.toContain('illustration')
    expect(imageCheck(report(undefined)).detail).toContain('No placed images')
  })

  it('says nothing at all for a book with no pictures', () => {
    const { notes } = buildExport({
      document: sampleDoc(),
      profile: defaultStyleProfile(),
      edition: edition(),
      estimatedPageCount: 100,
      typeset: { pageCount: 40, warnings: [] }
    })
    expect(notes.join(' ')).not.toContain('illustration')
  })
})
