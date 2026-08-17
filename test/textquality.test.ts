import { describe, it, expect } from 'vitest'
import { assessText, describeAssessment, MIN_WORDS } from '@core/textquality'

/** Padding of ordinary prose, so a sample clears the "too little to judge" floor. */
const filler = (n: number) =>
  'the alembick being set upon a gentle fire the spirit ascendeth and is gathered in the receiver '
    .repeat(n)
    .trim()

describe('assessText — telling typed text from machine OCR', () => {
  it('says nothing at all about a scrap', () => {
    // A title page is forty words and half of them capitals; a verdict from
    // that is noise dressed up as a measurement.
    const a = assessText('Of the Air. A treatise.')
    expect(a.words).toBeLessThan(MIN_WORDS)
    expect(a.signals).toContain('too little text to judge')
    expect(describeAssessment(a)).toMatch(/too little text/i)
  })

  it('trusts prose that reads as prose', () => {
    const a = assessText(filler(30))
    expect(a.verdict).toBe('trustworthy')
    expect(a.score).toBeGreaterThan(0.99)
    expect(a.signals).toEqual([])
  })

  it('condemns the real thing — an archive.org page as it actually arrived', () => {
    // Verbatim from a book this app was pointed at. Every failure mode at once:
    // symbols mid-word, capitals inside words, digits inside words.
    const real =
      'SYNOPSIS OF THE LESSONS WESSON I THE ASTRAL SENSES ™ J^? ske5>tlcal Person who ' +
      'believes only the evidence of his senses » The man who has much to say about ' +
      '"noise sense/\' \' "Common 1w?p» versus Uncommon Senses. The ordinary five senses ' +
      'are nS the Snlv senses. What Is back of the o?Lns of physical sense All senses an ' +
      'evolution of the sense of feeling! How tS/wSf r2p?it of the senses* The R*al Knower ' +
      'behind the senses. Man has seven physical oexSes nD5eadw LfS!11 flIe*, Each Physical ' +
      'sense has its astral sense counter: P£T ,^hat fc«e astral senses ««• Sensing on the ' +
      'astral plane. How ThA^Ln^Jwti? n^0nAt?eiaItral plane by means of the astral senses. '
    const a = assessText(real.repeat(3))
    expect(a.verdict).not.toBe('trustworthy')
    expect(a.signals.join(' ')).toMatch(/stray symbols/)
    expect(describeAssessment(a)).toMatch(/machine OCR/i)
  })

  it('cannot see a misreading shaped like a word — and must not pretend to', () => {
    // `chirnrgeon` for `chirurgeon`, `rnineralls` for `mineralls`, `thc` for
    // `the`: every one is letters only, so nothing about its *shape* is wrong.
    // Good OCR of a clean scan is made almost entirely of these, which is why
    // this measurement must never be what decides that a text needs no reading.
    // The structural test does that — see `looksScanned` in the platform layer,
    // which asks whether the page is a picture rather than how the words look.
    const nearly = `${filler(28)} ${'chirnrgeon rnineralls thc Iaid arid '.repeat(6)}`
    expect(assessText(nearly).verdict).toBe('trustworthy')
  })

  it('does not punish a book for its own vocabulary', () => {
    // `chirurgeon`, `alembick` and `ſhew` are not in any dictionary. A word the
    // book uses again and again is a word the book means.
    const archaic = `${filler(20)} ${'chirurgeon ſhew alembick quintessence '.repeat(12)}`
    const a = assessText(archaic)
    expect(a.verdict).toBe('trustworthy')
  })

  it('counts a word the book repeats, but not one carrying symbols', () => {
    // OCR repeats its own mistakes, so recurrence alone cannot vouch for a
    // token that is plainly damaged.
    const repeatedJunk = `${filler(20)} ${'ske5>tlcal '.repeat(30)}`
    const a = assessText(repeatedJunk)
    expect(a.verdict).not.toBe('trustworthy')
    expect(a.noise).toBeGreaterThan(0)
  })

  it('names what is wrong rather than only scoring it', () => {
    const a = assessText(`${filler(20)} ${'nD5eadw ThA^Ln 1w?p LfS!11 '.repeat(10)}`)
    expect(a.signals.join(' ')).toMatch(/capitals appear inside words/)
    expect(a.signals.join(' ')).toMatch(/digits appear inside words/)
  })

  it('ignores bare punctuation, which is evidence for nothing', () => {
    const withDashes = `${filler(30)} — — — … ( ) `
    expect(assessText(withDashes).verdict).toBe('trustworthy')
  })

  it('keeps numbers, which a book of tables is full of', () => {
    const figures = `${filler(20)} ${'1665 1,204 12.5 1666-1667 '.repeat(10)}`
    expect(assessText(figures).verdict).toBe('trustworthy')
  })

  it('reports an empty text without dividing by zero', () => {
    const a = assessText('')
    expect(a.words).toBe(0)
    expect(a.score).toBe(0)
    expect(a.verdict).toBe('mixed')
  })
})
