import { describe, expect, it } from 'vitest'
import { shelfTitle, shelfTitleParts } from '../src/core/sync/progress'

const sha = 'c77f699e62cfb22ddae9c6dc67b110d9187d107bdd7a65557690479df6aa62e1.pdf'

describe('shelfTitle', () => {
  it('reads a renamed directory rather than the file under it', () => {
    expect(shelfTitle({ fileName: sha, dir: 'Blavatsky-TheTheosophicalGlossary-1s37ewg' })).toBe(
      'The Theosophical Glossary · Blavatsky'
    )
  })

  it('spaces a volume numeral and keeps words the directory set apart', () => {
    expect(shelfTitle({ fileName: 'x.pdf', dir: 'Blavatsky-TheSecretDoctrineVolII-tup' })).toBe(
      'The Secret Doctrine Vol II · Blavatsky'
    )
    expect(
      shelfTitle({
        fileName: 'x.pdf',
        dir: 'SwamiPanchadasi-TheHumanAura-and-TheAstralWorld-fht48i'
      })
    ).toBe('The Human Aura and The Astral World · Swami Panchadasi')
  })

  it('does not take a title word for the tag when there is no tag', () => {
    expect(shelfTitle({ fileName: 'x.pdf', dir: 'JayHaley-UncommonTherapy' })).toBe(
      'Uncommon Therapy · Jay Haley'
    )
  })

  it('falls back to the file name for a computed directory, or none', () => {
    expect(shelfTitle({ fileName: 'isis-vol1.pdf', dir: 'isis-vol1-vjj34f' })).toBe('isis vol1')
    expect(shelfTitle({ fileName: 'The_Human-Aura.pdf' })).toBe('The Human Aura')
  })
})

describe('shelfTitleParts', () => {
  it('keeps the title and the author apart', () => {
    expect(
      shelfTitleParts({ fileName: sha, dir: 'Blavatsky-TheTheosophicalGlossary-1s37ewg' })
    ).toEqual({ title: 'The Theosophical Glossary', author: 'Blavatsky' })
  })

  it('names no author when the directory does not', () => {
    expect(shelfTitleParts({ fileName: 'isis-vol1.pdf', dir: 'isis-vol1-vjj34f' })).toEqual({
      title: 'isis vol1',
      author: null
    })
  })
})
