import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain module, no types
import { chapterName, displayTitle, expectedTags, tagsFor } from '../scripts/audio-tags.mjs'

const record = {
  book: 'book.json',
  chapter: 2,
  chapterCount: 11,
  title: 'STRATEGIC THERAPY',
  label: 'I',
  bookTitle: 'Uncommon Therapy',
  subtitle: 'The Psychiatric Techniques of Milton H. Erickson, M.D.',
  author: 'Jay Haley',
  year: '1973',
  voice: 'bm_george'
}

describe('displayTitle', () => {
  it('lowers a title the book set in capitals, keeping small words down', () => {
    expect(displayTitle('THE FAMILY LIFE CYCLE')).toBe('The Family Life Cycle')
    expect(displayTitle('WEANING PARENTS FROM CHILDREN')).toBe('Weaning Parents From Children')
    expect(displayTitle('MIND-READING, AND BEYOND')).toBe('Mind-Reading, and Beyond')
  })
  it('leaves a title in any other case exactly as set', () => {
    expect(displayTitle('The Psychiatric Techniques of Milton H. Erickson, M.D.')).toBe(
      'The Psychiatric Techniques of Milton H. Erickson, M.D.'
    )
    expect(displayTitle('Epilogue')).toBe('Epilogue')
  })
  it('does not treat a numeral or an empty title as capitals', () => {
    expect(displayTitle('1913')).toBe('1913')
    expect(displayTitle('')).toBe('')
  })
})

describe('chapterName', () => {
  it('sets the number line over the title, without a doubled full stop', () => {
    expect(chapterName(record)).toBe('I. Strategic Therapy')
    expect(chapterName({ ...record, label: 'I.' })).toBe('I. Strategic Therapy')
  })
  it('is the title alone where the book prints no number', () => {
    expect(chapterName({ ...record, label: undefined, title: 'EPILOGUE' })).toBe('Epilogue')
  })
})

describe('tagsFor', () => {
  it('asks ffmpeg for the book, the author, the chapter and its place', () => {
    const tags = expectedTags(record)
    expect(tags).toEqual({
      title: 'I. Strategic Therapy',
      artist: 'Jay Haley',
      album_artist: 'Jay Haley',
      album: 'Uncommon Therapy',
      comment: 'The Psychiatric Techniques of Milton H. Erickson, M.D.',
      date: '1973',
      track: '2/11',
      genre: 'Audiobook'
    })
  })
  it('writes ID3 v2.3, the version every player reads', () => {
    const args = tagsFor(record)
    expect(args.slice(0, 2)).toEqual(['-id3v2_version', '3'])
    // Every tag is its own -metadata pair, so a value with a comma or a colon
    // in it cannot run into the next.
    const metadata = args.filter((_: unknown, i: number) => args[i - 1] === '-metadata')
    expect(metadata).toContain('comment=The Psychiatric Techniques of Milton H. Erickson, M.D.')
  })
  it('invents nothing for a book whose file names no author or year', () => {
    const tags = expectedTags({ chapter: 1, title: 'Introduction' })
    expect(tags).toEqual({ title: 'Introduction', track: '1', genre: 'Audiobook' })
    expect(Object.keys(tags)).not.toContain('artist')
  })
})
