import { describe, it, expect } from 'vitest'
import type { FrontMatterFields, PerBookConfig, StyleProfile, TocEntry } from '@core/model'
import { defaultStyleProfile, mergeStyle } from '@core/style'
import { buildLatexDocument, parseTrimSize } from '@core/typeset'

const config: PerBookConfig = {
  title: 'The Great Work',
  author: 'Jane Author',
  isbn: '978-0-00-000000-0',
  editionDate: '2026',
  trimSize: '6x9',
}

const frontMatter: FrontMatterFields = {
  isbn: '978-0-00-000000-0',
  publicationDate: '2026',
  editionStatement: 'First Reprint Edition',
  imprint: 'Reprint House',
  copyrightHolder: 'Public Domain',
  notices: ['Printed in the United States of America.'],
}

const toc: TocEntry[] = [
  { title: 'Chapter One', level: 1, outputOffset: 0, pageNumber: 1 },
  { title: 'A Subsection', level: 2, outputOffset: 50, pageNumber: 3 },
]

const body = '\\chapter{Chapter One}\nSome body text.\n'

function build(profile: StyleProfile, opts: Partial<Parameters<typeof buildLatexDocument>[0]> = {}) {
  return buildLatexDocument({
    profile,
    config,
    frontMatter,
    toc,
    bodyLatex: body,
    ...opts,
  })
}

describe('parseTrimSize', () => {
  it('parses 6x9', () => {
    expect(parseTrimSize('6x9')).toEqual({ widthIn: 6, heightIn: 9 })
  })
  it('parses decimals and unicode times', () => {
    expect(parseTrimSize('5.5×8.5')).toEqual({ widthIn: 5.5, heightIn: 8.5 })
  })
  it('falls back to 6x9 on garbage', () => {
    expect(parseTrimSize('huge')).toEqual({ widthIn: 6, heightIn: 9 })
  })
})

describe('buildLatexDocument', () => {
  it('emits a complete standalone document', () => {
    const tex = build(defaultStyleProfile())
    expect(tex).toContain('\\documentclass')
    expect(tex).toContain('{book}')
    expect(tex).toContain('\\begin{document}')
    expect(tex).toContain('\\end{document}')
  })

  it('configures geometry from trim, margins and gutter', () => {
    const profile = defaultStyleProfile()
    const tex = build(profile)
    expect(tex).toContain('{geometry}')
    expect(tex).toContain('paperwidth=6in')
    expect(tex).toContain('paperheight=9in')
    // inner = margins.inner (0.75) + gutter (0.13) = 0.88
    expect(tex).toContain('inner=0.88in')
    expect(tex).toContain('outer=0.5in')
  })

  it('selects body and heading fonts via fontspec', () => {
    const profile = mergeStyle(defaultStyleProfile(), {
      bodyFont: 'EB Garamond',
      headingFont: 'Linux Libertine',
    })
    const tex = build(profile)
    expect(tex).toContain('\\usepackage{fontspec}')
    expect(tex).toContain('\\setmainfont{EB Garamond}')
    expect(tex).toContain('\\newfontfamily\\headingfont{Linux Libertine}')
  })

  it('sets fancyhdr running heads per verso/recto modes', () => {
    const profile = mergeStyle(defaultStyleProfile(), {
      runningHeads: { verso: 'author', recto: 'chapterTitle' },
    })
    const tex = build(profile)
    expect(tex).toContain('\\usepackage{fancyhdr}')
    // verso = author -> LE
    expect(tex).toContain('\\fancyhead[LE]{\\theauthor}')
    // recto = chapterTitle -> RO via leftmark
    expect(tex).toContain('\\fancyhead[RO]{\\leftmark}')
  })

  it('honors page-number position bottomCenter', () => {
    const profile = mergeStyle(defaultStyleProfile(), { pageNumber: 'bottomCenter' })
    const tex = build(profile)
    expect(tex).toContain('\\fancyfoot[C]{\\thepage}')
  })

  it('honors page-number position bottomOuter', () => {
    const profile = mergeStyle(defaultStyleProfile(), { pageNumber: 'bottomOuter' })
    const tex = build(profile)
    expect(tex).toContain('\\fancyfoot[LE,RO]{\\thepage}')
  })

  it('renders title and copyright pages with escaped fields', () => {
    const tex = build(defaultStyleProfile())
    expect(tex).toContain('The Great Work')
    expect(tex).toContain('Jane Author')
    expect(tex).toContain('First Reprint Edition')
    expect(tex).toContain('ISBN: 978-0-00-000000-0')
    expect(tex).toContain('Reprint House')
    expect(tex).toContain('Printed in the United States of America.')
    expect(tex).toContain('\\textcopyright')
  })

  it('omits title page when toggled off', () => {
    const profile = mergeStyle(defaultStyleProfile(), {
      frontMatter: { titlePage: false, copyrightPage: false, halfTitle: false },
    })
    const tex = build(profile)
    expect(tex).not.toContain('Title page')
    expect(tex).not.toContain('Copyright \\textcopyright')
  })

  it('renders the TOC entries with edition page numbers', () => {
    const tex = build(defaultStyleProfile())
    expect(tex).toContain('Contents')
    expect(tex).toContain('Chapter One')
    expect(tex).toContain('A Subsection')
    expect(tex).toContain('\\dotfill 1')
    expect(tex).toContain('\\dotfill 3')
  })

  it('includes ornament graphics when paths given', () => {
    const tex = build(defaultStyleProfile(), {
      ornamentPaths: { chapterOpener: '/o/chap.pdf', sectionDivider: '/o/div.pdf' },
    })
    expect(tex).toContain('\\includegraphics')
    expect(tex).toContain('/o/chap.pdf')
    expect(tex).toContain('/o/div.pdf')
  })

  it('omits ornament includegraphics when no paths', () => {
    const tex = build(defaultStyleProfile())
    expect(tex).not.toContain('\\includegraphics')
  })

  it('includes the body fragment', () => {
    const tex = build(defaultStyleProfile())
    expect(tex).toContain('\\chapter{Chapter One}')
    expect(tex).toContain('Some body text.')
  })
})
