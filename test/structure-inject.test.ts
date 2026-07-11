import { describe, it, expect } from 'vitest'
import type { StructuralTag } from '@core/model'
import { injectStructure, confirmedHeadings, assembleBody } from '@core/structure'

function heading(
  id: string,
  start: number,
  end: number,
  level: number,
  confirmed: boolean
): StructuralTag {
  return { id, type: 'heading', range: { start, end }, data: { level, confirmed } }
}

describe('confirmedHeadings', () => {
  it('keeps only confirmed heading tags', () => {
    const tags: StructuralTag[] = [
      heading('a', 0, 5, 1, true),
      heading('b', 6, 9, 1, false),
      { id: 'c', type: 'blockquote', range: { start: 10, end: 20 }, data: { confirmed: true } }
    ]
    expect(confirmedHeadings(tags).map((t) => t.id)).toEqual(['a'])
  })
})

describe('injectStructure', () => {
  it('renders a confirmed heading as an ATX heading of the right level', () => {
    const md = 'CHAPTER ONE\n\nIt was a dark night.'
    const out = injectStructure(md, [heading('h1', 0, 11, 1, true)])
    expect(out).toContain('# CHAPTER ONE')
    expect(out).toContain('It was a dark night.')
    // Level 2 -> "##".
    const out2 = injectStructure(md, [heading('h1', 0, 11, 2, true)])
    expect(out2).toContain('## CHAPTER ONE')
  })

  it('ignores unconfirmed headings', () => {
    const md = 'A Heading\n\nBody.'
    const out = injectStructure(md, [heading('h1', 0, 9, 1, false)])
    expect(out).not.toContain('# A Heading')
    expect(out).toContain('A Heading')
  })

  it('applies multiple headings without corrupting later offsets', () => {
    // Two headings; the second is later in the text. Applying end-first must keep
    // both correct.
    const md = 'One\n\nmiddle text\n\nTwo\n\ntail'
    const tags = [heading('h1', 0, 3, 1, true), heading('h2', 18, 21, 1, true)]
    const out = injectStructure(md, tags)
    expect(out).toContain('# One')
    expect(out).toContain('# Two')
    expect(out).toContain('middle text')
    expect(out).toContain('tail')
  })

  it('collapses whitespace in a heading and skips empty ones', () => {
    const md = 'The   Long\n  Title\n\nBody'
    const out = injectStructure(md, [heading('h1', 0, 18, 1, true)])
    expect(out).toContain('# The Long Title')

    const empty = injectStructure('   \n\nBody', [heading('h1', 0, 3, 1, true)])
    expect(empty).not.toContain('#')
  })

  it('returns the text unchanged when there are no confirmed headings', () => {
    const md = 'Just prose.'
    expect(injectStructure(md, [])).toBe(md)
  })
})

function tag(
  id: string,
  type: StructuralTag['type'],
  start: number,
  end: number,
  data?: Record<string, unknown>
): StructuralTag {
  return { id, type, range: { start, end }, ...(data ? { data } : {}) }
}

describe('injectStructure — block tags', () => {
  it('renders a block quote as Markdown blockquote lines (no confirm needed)', () => {
    const md = 'Intro.\n\nTo be or not to be.\n\nOutro.'
    const start = md.indexOf('To be')
    const out = injectStructure(md, [
      tag('q', 'blockquote', start, start + 'To be or not to be.'.length)
    ])
    expect(out).toContain('> To be or not to be.')
  })

  it('renders an epigraph as a blockquote too', () => {
    const md = 'A wise saying here.'
    const out = injectStructure(md, [tag('e', 'epigraph', 0, md.length)])
    expect(out).toContain('> A wise saying here.')
  })

  it('renders verse as a line block preserving each line', () => {
    const md = 'Roses are red\nViolets are blue'
    const out = injectStructure(md, [tag('v', 'verse', 0, md.length)])
    expect(out).toContain('| Roses are red')
    expect(out).toContain('| Violets are blue')
  })

  it('ignores tag types it does not handle (e.g. footnote)', () => {
    const md = 'Body with a note.'
    const out = injectStructure(md, [tag('f', 'footnote', 0, 4)])
    expect(out).toBe(md)
  })

  it('drops a tag that overlaps an already-applied later tag', () => {
    // Outer [0,20) heading overlaps inner [5,10) blockquote; the later-starting
    // (inner) one is applied, the overlapping outer one is skipped.
    const md = 'ONE two three four five'
    const inner = tag('in', 'blockquote', 5, 10)
    const outer = tag('out', 'heading', 0, 20, { level: 1, confirmed: true })
    const out = injectStructure(md, [outer, inner])
    expect(out).toContain('> wo th') // slice(5,10) of the string
    expect(out).not.toContain('# ONE')
  })
})

describe('assembleBody — image/figure inserts', () => {
  it('splices a figure block at the given offset without disturbing the text', () => {
    const md = 'Page one text.\n\nPage two text.'
    const insert = { offset: 14, block: '\\begin{figure}IMG\\end{figure}' } // after "Page one text."
    const out = assembleBody(md, [], [insert])
    expect(out).toContain('\\begin{figure}IMG\\end{figure}')
    expect(out).toContain('Page one text.')
    expect(out).toContain('Page two text.')
    // The figure sits between the two paragraphs, not inside either word.
    expect(out.indexOf('IMG')).toBeGreaterThan(out.indexOf('Page one text.'))
    expect(out.indexOf('IMG')).toBeLessThan(out.indexOf('Page two text.'))
  })

  it('applies headings and figure inserts together against original offsets', () => {
    const md = 'TITLE\n\nbody paragraph here'
    const heads = [heading('h', 0, 5, 1, true)]
    const inserts = [{ offset: md.length, block: '\\begin{figure}END\\end{figure}' }]
    const out = assembleBody(md, heads, inserts)
    expect(out).toContain('# TITLE')
    expect(out).toContain('body paragraph here')
    expect(out).toContain('\\begin{figure}END\\end{figure}')
    // Figure at the end comes after the body.
    expect(out.indexOf('END')).toBeGreaterThan(out.indexOf('body paragraph here'))
  })

  it('ignores blank or out-of-range inserts', () => {
    const md = 'text'
    expect(assembleBody(md, [], [{ offset: 2, block: '   ' }])).toBe(md)
    expect(assembleBody(md, [], [{ offset: 999, block: 'X' }])).toBe(md)
  })
})
