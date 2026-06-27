import { describe, it, expect } from 'vitest'
import {
  markdownToSpans,
  splitParagraphs,
  type SpanNode
} from '../src/renderer/utils/markdown-to-spans'
import type { MappingEntry } from '../src/core/model/types'

/** Minimal MappingEntry factory — only `tokenId` and `output` matter here. */
function entry(tokenId: string, start: number, end: number): MappingEntry {
  return {
    tokenId,
    pageIndex: 0,
    bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    output: { start, end }
  }
}

/** Assert the nodes reconstruct the original string exactly (no gaps/overlaps). */
function joined(nodes: SpanNode[]): string {
  return nodes.map((n) => n.text).join('')
}

describe('markdownToSpans', () => {
  it('maps entries to their exact [start,end) slices', () => {
    const md = 'The quick fox'
    const entries = [entry('a', 0, 3), entry('b', 4, 9), entry('c', 10, 13)]
    const nodes = markdownToSpans(md, entries)

    const words = nodes.filter((n) => n.entry)
    expect(words.map((n) => n.text)).toEqual(['The', 'quick', 'fox'])
    expect(words.map((n) => n.entry?.tokenId)).toEqual(['a', 'b', 'c'])
    expect(joined(nodes)).toBe(md)
  })

  it('emits plain nodes for gaps between/around entries', () => {
    const md = 'a, b.'
    // "a" at [0,1), "b" at [3,4); gaps ", " and "." stay plain.
    const entries = [entry('a', 0, 1), entry('b', 3, 4)]
    const nodes = markdownToSpans(md, entries)

    expect(nodes).toEqual([
      { text: 'a', entry: entries[0] },
      { text: ', ' },
      { text: 'b', entry: entries[1] },
      { text: '.' }
    ])
    expect(joined(nodes)).toBe(md)
  })

  it('handles unsorted entries by sorting on output.start', () => {
    const md = 'one two three'
    const entries = [entry('c', 8, 13), entry('a', 0, 3), entry('b', 4, 7)]
    const nodes = markdownToSpans(md, entries)

    const words = nodes.filter((n) => n.entry)
    expect(words.map((n) => n.entry?.tokenId)).toEqual(['a', 'b', 'c'])
    expect(words.map((n) => n.text)).toEqual(['one', 'two', 'three'])
    expect(joined(nodes)).toBe(md)
  })

  it('treats empty entries as a single plain node covering the whole string', () => {
    const md = 'plain text only'
    const nodes = markdownToSpans(md, [])
    expect(nodes).toEqual([{ text: 'plain text only' }])
  })

  it('returns no nodes for an empty string', () => {
    expect(markdownToSpans('', [entry('a', 0, 0)])).toEqual([])
  })

  it('skips out-of-range entries defensively', () => {
    const md = 'abc'
    const entries = [entry('a', 0, 1), entry('oob', 5, 9)]
    const nodes = markdownToSpans(md, entries)
    expect(joined(nodes)).toBe(md)
    expect(nodes.filter((n) => n.entry).map((n) => n.entry?.tokenId)).toEqual(['a'])
  })

  it('skips overlapping entries defensively (keeps the first)', () => {
    const md = 'abcdef'
    const entries = [entry('a', 0, 3), entry('overlap', 2, 5)]
    const nodes = markdownToSpans(md, entries)
    expect(joined(nodes)).toBe(md)
    expect(nodes.filter((n) => n.entry).map((n) => n.entry?.tokenId)).toEqual(['a'])
  })

  it('skips empty/zero-width entries', () => {
    const md = 'abc'
    const nodes = markdownToSpans(md, [entry('z', 1, 1)])
    expect(nodes).toEqual([{ text: 'abc' }])
  })
})

describe('splitParagraphs', () => {
  it('splits on blank lines and keeps absolute starts', () => {
    const md = 'first para\n\nsecond para'
    const paras = splitParagraphs(md, [])

    expect(paras.map((p) => p.text)).toEqual(['first para', 'second para'])
    expect(paras[0].start).toBe(0)
    expect(paras[1].start).toBe(md.indexOf('second'))
  })

  it('handles runs of more than two newlines', () => {
    const md = 'a\n\n\n\nb'
    const paras = splitParagraphs(md, [])
    expect(paras.map((p) => p.text)).toEqual(['a', 'b'])
    expect(paras[1].start).toBe(md.indexOf('b'))
  })

  it('partitions nodes into the right paragraph with absolute offsets intact', () => {
    const md = 'one two\n\nthree four'
    const entries = [
      entry('a', 0, 3), // one
      entry('b', 4, 7), // two
      entry('c', 9, 14), // three
      entry('d', 15, 19) // four
    ]
    const paras = splitParagraphs(md, entries)

    const p0Words = paras[0].nodes.filter((n) => n.entry)
    const p1Words = paras[1].nodes.filter((n) => n.entry)

    expect(p0Words.map((n) => n.entry?.tokenId)).toEqual(['a', 'b'])
    expect(p1Words.map((n) => n.entry?.tokenId)).toEqual(['c', 'd'])

    // Offsets in entry.output stay absolute into the full markdown.
    expect(p1Words[0].entry?.output.start).toBe(9)
    expect(p1Words[1].entry?.output.end).toBe(19)

    // Each paragraph's nodes reconstruct that paragraph's text.
    expect(paras[0].nodes.map((n) => n.text).join('')).toBe('one two')
    expect(paras[1].nodes.map((n) => n.text).join('')).toBe('three four')
  })

  it('returns a single paragraph when there are no blank lines', () => {
    const md = 'just one line of text'
    const paras = splitParagraphs(md, [entry('a', 0, 4)])
    expect(paras).toHaveLength(1)
    expect(paras[0].start).toBe(0)
    expect(paras[0].text).toBe(md)
  })

  it('returns no paragraphs for empty markdown', () => {
    expect(splitParagraphs('', [])).toEqual([])
  })
})
