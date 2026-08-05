import { describe, it, expect } from 'vitest'
import {
  buildExport,
  editionFromAnswers,
  publicDomainNotice,
  safeFileName,
  noTexEngine,
  tryCompile,
  parseTexLog,
  pageCountFromLog,
  TexCompileError,
  type EditionDetails,
  type TexEngine
} from '@core/export'
import { assembleBook } from '@core/assemble'
import type { BookDocument } from '@core/assemble'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'
import type { PageRole } from '@core/pages'
import { profileFromAnswers } from '@core/design'
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
  })

  it('is explicit that only this edition is new', () => {
    expect(publicDomainNotice('1662')).toContain('typesetting and design are new')
  })
})

describe('editionFromAnswers', () => {
  it('carries the identity gate’s title and author through', () => {
    const e = editionFromAnswers({ title: 'The Alchemist', author: 'Anonymous' }, {})
    expect(e.title).toBe('The Alchemist')
    expect(e.author).toBe('Anonymous')
  })

  it('treats blank fields as absent rather than as empty values', () => {
    const e = editionFromAnswers({}, { imprint: '   ', isbn: '' })
    expect(e.imprint).toBeNull()
    expect(e.isbn).toBeNull()
  })

  it('never produces an untitled-but-not-labelled book', () => {
    expect(editionFromAnswers({}, {}).title).toBe('Untitled')
  })

  it('adds the public-domain notice by default', () => {
    expect(editionFromAnswers({ originalYear: '1662' }, {}).notices[0]).toContain('1662')
  })

  it('omits the notice only when the user declined it', () => {
    expect(editionFromAnswers({}, { publicDomainNotice: false }).notices).toEqual([])
  })
})

describe('buildExport', () => {
  it('produces a complete, compilable document', () => {
    const { tex } = build()
    expect(tex).toContain('\\documentclass')
    expect(tex).toContain('\\begin{document}')
    expect(tex).toContain('\\end{document}')
    expect(tex).toContain('% !TEX program = xelatex')
  })

  it('includes the body and excludes the original front matter', () => {
    const { tex } = build()
    expect(tex).toContain('\\chapter{Chapter I}')
    expect(tex).toContain('The alembick being set upon a gentle fire.')
    // The scanned title page is a metadata source, not something to reprint.
    expect(tex).not.toContain('THE ALCHEMIST\\par')
  })

  it('puts the edition details on the copyright page', () => {
    const { tex } = build()
    expect(tex).toContain('Blackthorn Press')
    expect(tex).toContain('A. Reprinter')
    expect(tex).toContain('978-0-00-000000-0')
    expect(tex).toContain('A new edition of the 1662 original.')
  })

  it('prints the public-domain notice when one was chosen', () => {
    const { tex } = build({ notices: [publicDomainNotice('1662')] })
    expect(tex).toContain('public domain')
  })

  it('names the file after the book', () => {
    expect(build().fileName).toBe('the-alchemist-his-practise.tex')
  })

  it('emits the drop cap only when the style asks for it', () => {
    const plain = profileFromAnswers({
      kind: 'novel',
      period: 'early-modern',
      chapterOpener: 'plain',
      runningHeads: 'author-title'
    })
    const dropped = profileFromAnswers({
      kind: 'novel',
      period: 'early-modern',
      chapterOpener: 'drop-cap',
      runningHeads: 'author-title'
    })
    expect(build({}, plain).tex).not.toContain('\\lettrine')
    const withCap = build({}, dropped).tex
    // The package and the command must appear together or the run fails.
    expect(withCap).toContain('\\usepackage{lettrine}')
    expect(withCap).toContain('\\lettrine')
  })

  it('wires the chosen ornament through to an includegraphics path', () => {
    const ornamented = profileFromAnswers({
      kind: 'novel',
      period: 'early-modern',
      chapterOpener: 'ornamented',
      runningHeads: 'author-title'
    })
    const tex = buildExport({
      document: sampleDoc(),
      profile: ornamented,
      edition: edition(),
      estimatedPageCount: 180,
      ornamentDir: 'orn'
    }).tex
    expect(tex).toContain('orn/chapter-flourish.pdf')
  })

  it('reports the KDP checks before a PDF exists', () => {
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

describe('parseTexLog', () => {
  const log = [
    'This is XeTeX, Version 3.141592653',
    'Overfull \\hbox (12.4pt too wide) in paragraph at lines 88--90',
    'Underfull \\vbox (badness 10000) has occurred while \\output is active',
    'LaTeX Font Warning: Font shape undefined',
    'Output written on book.pdf (312 pages, 1204418 bytes).'
  ].join('\n')

  it('keeps the box warnings that show up as ragged printed pages', () => {
    const warnings = parseTexLog(log)
    expect(warnings.some((w) => w.startsWith('Overfull'))).toBe(true)
    expect(warnings.some((w) => w.startsWith('Underfull'))).toBe(true)
  })

  it('leaves out the font and file chatter that would bury the signal', () => {
    expect(parseTexLog(log).some((w) => w.includes('Font Warning'))).toBe(false)
  })

  it('returns nothing for a clean log', () => {
    expect(parseTexLog('This is XeTeX.\nOutput written on book.pdf (10 pages).')).toEqual([])
  })

  it('reads the final page count the cover spine needs', () => {
    expect(pageCountFromLog(log)).toBe(312)
    expect(pageCountFromLog('no such line')).toBeNull()
  })
})

describe('tryCompile', () => {
  it('explains rather than throws when no engine is available', async () => {
    const outcome = await tryCompile(noTexEngine, { tex: '\\documentclass{book}' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('XeLaTeX')
  })

  it('returns the result when an engine works', async () => {
    const engine: TexEngine = {
      name: 'fake',
      available: async () => true,
      compile: async () => ({
        pdf: new Uint8Array([37, 80, 68, 70]),
        pageCount: 312,
        warnings: [],
        log: ''
      })
    }
    const outcome = await tryCompile(engine, { tex: '' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.result.pageCount).toBe(312)
  })

  it('surfaces the log with a compile failure, so it can be diagnosed', async () => {
    const engine: TexEngine = {
      name: 'fake',
      available: async () => true,
      compile: async () => {
        throw new TexCompileError('Undefined control sequence', '! Undefined control sequence.')
      }
    }
    const outcome = await tryCompile(engine, { tex: '' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toContain('Undefined control sequence')
      expect(outcome.log).toContain('!')
    }
  })

  it('does not let a non-TeX error escape as an unhandled rejection', async () => {
    const engine: TexEngine = {
      name: 'fake',
      available: async () => true,
      compile: async () => {
        throw new Error('out of memory')
      }
    }
    const outcome = await tryCompile(engine, { tex: '' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('out of memory')
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

  it('reports real numbers once a TeX run has produced them', () => {
    const result = buildExport({
      document: sampleDoc(),
      profile: defaultStyleProfile(),
      edition: edition(),
      estimatedPageCount: 180,
      compiled: { pageCount: 312, warnings: ['Overfull \\hbox in paragraph at lines 88--90'] }
    })
    const pageCount = result.validation.checks.find((c) => c.id === 'page-count')!
    expect(pageCount.level).toBe('ok')
    expect(pageCount.detail).toContain('312 pages')
    expect(result.validation.pageCount).toBe(312)

    const warnings = result.validation.checks.find((c) => c.id === 'latex-warnings')!
    expect(warnings.level).toBe('warn')
    expect(warnings.detail).toContain('1 overfull-box')
  })

  it('is still "ready" pre-compile — an unmeasured count is a caveat, not a failure', () => {
    expect(build().validation.ready).toBe(true)
  })
})
