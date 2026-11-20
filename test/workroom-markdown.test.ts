import { describe, expect, it } from 'vitest'
import { inline, markdownBlocks } from '@core/work'

/**
 * A sheet read into plain blocks for the Workroom's reading view
 * (`src/core/work/markdown.ts`). Whatever is not Markdown comes through as
 * the text it is: nothing is dropped and nothing is read as HTML.
 */
const text = (t: string) => ({ kind: 'text', text: t })

describe('a sheet’s blocks', () => {
  it('reads headings, paragraphs joined across lines, and rules', () => {
    expect(markdownBlocks('# Readiness\n\nAll the checks\nran today.\n\n---\nTitle\n===')).toEqual([
      { kind: 'heading', level: 1, spans: [text('Readiness')] },
      { kind: 'paragraph', spans: [text('All the checks ran today.')] },
      { kind: 'rule' },
      { kind: 'heading', level: 1, spans: [text('Title')] }
    ])
  })

  it('reads lists with their depth, numbering and task boxes', () => {
    const [list] = markdownBlocks('3. first\n4. second\n   carried on\n   - inner\n   - [x] ticked')
    expect(list).toEqual({
      kind: 'list',
      ordered: true,
      start: 3,
      items: [
        { depth: 0, check: null, spans: [text('first')] },
        { depth: 0, check: null, spans: [text('second carried on')] },
        { depth: 1, check: null, spans: [text('inner')] },
        { depth: 1, check: true, spans: [text('ticked')] }
      ]
    })
  })

  it('reads a pipe table, a quote and fenced code kept exactly', () => {
    const blocks = markdownBlocks(
      '| Check | Result |\n|---|:-:|\n| C1 | passed |\n| C2 \\| R1 | NOT CHECKED |\n\n> a quote\n\n```\n  keep  *this*\n```'
    )
    expect(blocks[0]).toEqual({
      kind: 'table',
      head: [[text('Check')], [text('Result')]],
      rows: [
        [[text('C1')], [text('passed')]],
        [[text('C2 | R1')], [text('NOT CHECKED')]]
      ]
    })
    expect(blocks[1]).toEqual({
      kind: 'quote',
      blocks: [{ kind: 'paragraph', spans: [text('a quote')] }]
    })
    expect(blocks[2]).toEqual({ kind: 'code', text: '  keep  *this*' })
  })

  it('leaves out HTML comments and keeps any other markup as plain text', () => {
    expect(markdownBlocks('<!-- hidden\nnote -->\nA <sc>small</sc> word.')).toEqual([
      { kind: 'paragraph', spans: [text('A <sc>small</sc> word.')] }
    ])
  })
})

describe('the spans of a line', () => {
  it('reads strong, emphasis, code and links', () => {
    expect(inline('**Read** the *queries* in `queries.md`, see [the ledger](ledger.md).')).toEqual([
      { kind: 'strong', spans: [text('Read')] },
      text(' the '),
      { kind: 'em', spans: [text('queries')] },
      text(' in '),
      { kind: 'code', text: 'queries.md' },
      text(', see '),
      { kind: 'link', href: 'ledger.md', spans: [text('the ledger')] },
      text('.')
    ])
  })

  it('keeps an underscore inside a word, a lone star and an escaped mark as text', () => {
    expect(inline('snake_case_name and 2 * 3 and \\*not\\*')).toEqual([
      text('snake_case_name and 2 * 3 and *not*')
    ])
  })

  it('reads emphasis inside strong', () => {
    expect(inline('**a *b* c**')).toEqual([
      { kind: 'strong', spans: [text('a '), { kind: 'em', spans: [text('b')] }, text(' c')] }
    ])
  })
})
