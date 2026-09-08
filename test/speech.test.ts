/**
 * Preparing a book to be read aloud: the two things that go wrong before a
 * voice sees a word.
 *
 * Both cases here were measured on a real reading rather than imagined, and the
 * phonemes each one produced are quoted where they matter.
 */
import { describe, expect, it } from 'vitest'
import {
  applyPronunciations,
  checkPronunciations,
  pronunciationsIn,
  romanValue,
  speakHeadingNumbers,
  spellNumber,
  type Pronunciation
} from '@core/speech'

describe('romanValue', () => {
  it('reads the numerals a book actually prints', () => {
    expect(romanValue('I')).toBe(1)
    expect(romanValue('IV')).toBe(4)
    expect(romanValue('VIII')).toBe(8)
    expect(romanValue('XIV')).toBe(14)
    expect(romanValue('XL')).toBe(40)
    expect(romanValue('MCMXVI')).toBe(1916)
  })

  it('leaves a numeral it has no words for exactly as it is', () => {
    // A Roman year on a title page wants "nineteen sixteen", not "one thousand
    // nine hundred and sixteen" — a different question, and not this one.
    expect(speakHeadingNumbers('MCMXVI')).toBe('MCMXVI')
    expect(speakHeadingNumbers('BOOK MCMXVI')).toBe('BOOK MCMXVI')
  })

  it('refuses anything that is not the canonical spelling of its own value', () => {
    // A lenient parser makes a number of every one of these, and the words they
    // are sitting in stop being words.
    expect(romanValue('DID')).toBeNull()
    expect(romanValue('DIM')).toBeNull()
    expect(romanValue('VIM')).toBeNull()
    expect(romanValue('CIVIC')).toBeNull()
    expect(romanValue('IIII')).toBeNull()
    expect(romanValue('VV')).toBeNull()
    expect(romanValue('IC')).toBeNull()
    expect(romanValue('LESSON')).toBeNull()
    expect(romanValue('')).toBeNull()
  })
})

describe('spellNumber', () => {
  it('writes a chapter number out', () => {
    expect(spellNumber(1)).toBe('One')
    expect(spellNumber(8)).toBe('Eight')
    expect(spellNumber(14)).toBe('Fourteen')
    expect(spellNumber(21)).toBe('Twenty-One')
    expect(spellNumber(40)).toBe('Forty')
    expect(spellNumber(105)).toBe('One Hundred Five')
  })
})

describe('speakHeadingNumbers', () => {
  it('converts the numeral after a divider word', () => {
    // Measured: "LESSON VIII" is read as "lesson roman eight".
    expect(speakHeadingNumbers('LESSON VIII')).toBe('LESSON Eight')
    expect(speakHeadingNumbers('Chapter XIV')).toBe('Chapter Fourteen')
    expect(speakHeadingNumbers('LESSON VIII.')).toBe('LESSON Eight.')
  })

  it('converts a heading that is only a number', () => {
    expect(speakHeadingNumbers('VIII')).toBe('Eight')
    expect(speakHeadingNumbers('IX.')).toBe('Nine.')
  })

  it('leaves the pronoun alone, which is the whole reason for the divider rule', () => {
    // Measured: "LESSON I" is read as "lesson eye" — quiet, plausible, wrong.
    expect(speakHeadingNumbers('LESSON I')).toBe('LESSON One')
    // And an occult shelf is exactly where this heading turns up.
    expect(speakHeadingNumbers('I AM THAT I AM')).toBe('I AM THAT I AM')
    expect(speakHeadingNumbers('WHAT I SAW')).toBe('WHAT I SAW')
  })

  it('leaves alone the English words that are genuinely valid numerals', () => {
    // `MIX` really is 1009 and `MI` really is 1001 — the parser is right and
    // refusing them would be wrong. What keeps them out of a book being read is
    // that there are no words for a number that size, so nothing is changed.
    expect(romanValue('MIX')).toBe(1009)
    expect(speakHeadingNumbers('MIX')).toBe('MIX')
    expect(speakHeadingNumbers('CHAPTER MIX')).toBe('CHAPTER MIX')
  })

  it('leaves a title that merely contains numeral letters alone', () => {
    expect(speakHeadingNumbers('MIND-READING, AND BEYOND')).toBe('MIND-READING, AND BEYOND')
    expect(speakHeadingNumbers('THE ASTRAL SENSES')).toBe('THE ASTRAL SENSES')
  })
})

const LIST: Pronunciation[] = [
  { word: 'Siddhis', say: 'siddees', expect: 'sˈɪdiːz', dialect: 'en', sounds: 'SID-eez' },
  { word: 'Zschokke', say: 'shockah', expect: 'ʃˈɒkə', dialect: 'en', sounds: 'SHOK-uh' },
  {
    word: "Vicq d'Azyr",
    say: 'veek dah-zeer',
    expect: 'vˈiːk dˈɑːzˈiə',
    dialect: 'en',
    sounds: 'veek dah-ZEER'
  }
]

describe('applyPronunciations', () => {
  it('replaces a listed word whatever case the book prints it in', () => {
    expect(applyPronunciations('The Siddhis are not a fifth.', LIST)).toBe(
      'The siddees are not a fifth.'
    )
    expect(applyPronunciations('SIDDHIS', LIST)).toBe('siddees')
  })

  it('replaces a phrase before anything inside it', () => {
    expect(applyPronunciations("Felix Vicq d'Azyr and Zschokke", LIST)).toBe(
      'Felix veek dah-zeer and shockah'
    )
  })

  it('does not reach inside a longer word', () => {
    expect(applyPronunciations('Siddhistic Zschokkeish', LIST)).toBe('Siddhistic Zschokkeish')
    expect(applyPronunciations('anti-Siddhis', LIST)).toBe('anti-Siddhis')
  })

  it('keeps the punctuation around what it replaces', () => {
    expect(applyPronunciations('(Siddhis), Zschokke;', LIST)).toBe('(siddees), shockah;')
  })
})

describe('pronunciationsIn', () => {
  it('reports only the words a passage really uses', () => {
    expect(pronunciationsIn('The Siddhis.', LIST).map((p) => p.word)).toEqual(['Siddhis'])
    expect(pronunciationsIn('Nothing here.', LIST)).toEqual([])
  })
})

describe('checkPronunciations', () => {
  it('says nothing while every respelling still produces what it was approved for', async () => {
    const stub = async (text: string) => LIST.find((p) => p.say === text)?.expect ?? '?'
    expect(await checkPronunciations(LIST, stub)).toEqual([])
  })

  it('names an entry whose respelling has stopped meaning what it meant', async () => {
    // The failure this exists for: a phonemizer version changes and a list that
    // was approved by ear quietly starts saying something else, into a book
    // somebody then listens to for six hours.
    const stub = async (text: string) => (text === 'shockah' ? 'ʃˈəʊkɑː' : '?')
    const drift = await checkPronunciations([LIST[1]], stub)
    expect(drift).toEqual([
      { word: 'Zschokke', say: 'shockah', expected: 'ʃˈɒkə', actual: 'ʃˈəʊkɑː' }
    ])
  })
})
