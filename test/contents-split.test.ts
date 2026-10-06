import { describe, it, expect } from 'vitest'
import { contentsSplit, fixedWidthMeasurer, layoutWithToc, type PositionedLine } from '@core/layout'
import { assembleBook } from '@core/assemble'
import { defaultStyleProfile } from '@core/style'
import type { PageTranscription } from '@core/transcribe'

/**
 * A contents entry that wraps is cut where its words allow. Left to the
 * breaker, the Hall collection's contents printed "Teacher and Pupil, Part /
 * I" and "Psychology, False and / True": a word alone on a line, and a name
 * cut at random.
 */
const width = (s: string): number => s.length
const opts = (firstWidth: number, labelWords = 0) => ({
  width,
  firstWidth,
  secondWidth: firstWidth - 2,
  labelWords
})

describe('where a wrapped contents entry is cut', () => {
  it('cuts between label and title when the title fits its own line', () => {
    expect(
      contentsSplit('MANUSCRIPT LECTURE No. 3 Teacher and Pupil, Part I', opts(42, 4))
    ).toEqual(['MANUSCRIPT LECTURE No. 3', 'Teacher and Pupil, Part I'])
  })

  it('cuts after punctuation when there is no label', () => {
    expect(
      contentsSplit('Special Class in Secret Doctrine: The Stanzas of Dzyan', opts(40))
    ).toEqual(['Special Class in Secret Doctrine:', 'The Stanzas of Dzyan'])
  })

  it('never leaves one word alone, nor ends a line on a word that binds forward', () => {
    const [first, second] = contentsSplit('The Masters of Wisdom and the Path of Life', opts(34))!
    expect(second.split(' ').length).toBeGreaterThan(1)
    expect(first).not.toMatch(/\b(of|and|the)$/)
  })

  it('gives up when two lines will not hold it', () => {
    expect(contentsSplit('one two three four five six seven eight nine ten', opts(12))).toBeNull()
  })
})

describe('the contents as set', () => {
  // Chapter titles under a label line, long enough that label and title
  // together overrun one line: the shape of the Hall collection's contents.
  const leaves: PageTranscription[] = [
    'Teacher and Pupil, Part I',
    'Psychology, False and True',
    'Talks for Teachers, Part II'
  ].map((title, i) => ({
    pageIndex: i,
    role: 'body',
    uncertain: [],
    furniture: {},
    blocks: [
      { kind: 'heading', level: 1, text: `MANUSCRIPT LECTURE No. ${i + 3}` },
      { kind: 'heading', level: 1, text: title },
      { kind: 'paragraph', text: 'Body text. '.repeat(30) }
    ]
  }))
  const measurer = fixedWidthMeasurer(0.5)
  const laid = layoutWithToc(assembleBook(leaves), defaultStyleProfile(), measurer, {
    edition: { title: 'T', author: 'A' }
  })
  const text = laid.pages
    .filter((p) => p.kind === 'contents')
    .flatMap((p) => p.items.filter((i): i is PositionedLine => i.kind === 'line'))
    .map((l) =>
      l.runs
        .filter((r) => !r.text.startsWith('Page '))
        .map((r) => r.text)
        .join(' ')
    )

  it('sets each label on its own line over its title', () => {
    for (const title of [
      'Teacher and Pupil, Part I',
      'Psychology, False and True',
      'Talks for Teachers, Part II'
    ]) {
      expect(text).toContain(title)
    }
  })
})

describe('the label on a line of its own', () => {
  // Short titles: label and title together fit one line, so only the option
  // can put them on two. The Hall collection's No. 6, "Reincarnation".
  const titles = ['Reincarnation', 'Karma', 'The Mysteries']
  const leaves: PageTranscription[] = titles.map((title, i) => ({
    pageIndex: i,
    role: 'body',
    uncertain: [],
    furniture: {},
    blocks: [
      { kind: 'heading', level: 1, text: `LECTURE No. ${i + 6}` },
      { kind: 'heading', level: 1, text: title },
      { kind: 'paragraph', text: 'Body text. '.repeat(30) }
    ]
  }))
  const contentsLines = (labelLine: boolean) => {
    const profile = { ...defaultStyleProfile(), contentsLabelLine: labelLine }
    const laid = layoutWithToc(assembleBook(leaves), profile, fixedWidthMeasurer(0.5), {
      edition: { title: 'T', author: 'A' }
    })
    return laid.pages
      .filter((p) => p.kind === 'contents')
      .flatMap((p) => p.items.filter((i): i is PositionedLine => i.kind === 'line'))
  }
  const textOf = (l: PositionedLine) =>
    l.runs
      .filter((r) => !r.text.startsWith('Page '))
      .map((r) => r.text)
      .join(' ')

  it('sets every label over its title, short titles included', () => {
    const lines = contentsLines(true)
    const text = lines.map(textOf)
    titles.forEach((title, i) => {
      const at = text.indexOf(`LECTURE No. ${i + 6}`)
      expect(at).toBeGreaterThanOrEqual(0)
      expect(text[at + 1]).toBe(title)
      // The page number rides the title's line, not the label's.
      expect(lines[at]!.runs.some((r) => r.text.startsWith('Page '))).toBe(false)
      expect(lines[at + 1]!.runs.some((r) => r.text.startsWith('Page '))).toBe(true)
    })
  })

  it('runs them on when the option is off', () => {
    const text = contentsLines(false).map(textOf)
    expect(text).toContain('LECTURE No. 6 Reincarnation')
  })
})
