import { describe, expect, it } from 'vitest'
import { definitionsOf, entryHeads, glossaryPacket, passagesOf } from '@core/annotate'

/**
 * The packet a glossary entry is written from: Blavatsky's own definition,
 * where else she uses the word, and where the author does. Each test is a
 * way the packet could hand a writer the wrong paragraph.
 */
const b = (id: string, text: string) => ({ id, text })

const TG = [
  b(
    't1',
    'Adept (Lat.). Adeptus, “He who has obtained.” In Occultism one who has reached the stage of Initiation.'
  ),
  b('t2', 'Arhat (Sk.). Also pronounced and written Arahat. Higher than an adept in the scale.'),
  b('t3', 'Mahâtma. Lit., “great soul”. An adept of the highest order.'),
  b('t4', 'Kâma-rûpa (Sk.). Metaphysically, the subjective form created through the desires.'),
  b('t5', 'Abba, or Abba Amona (Heb.). Father; Mother.')
]

describe('the dictionary entry headed by the term', () => {
  it('reads an entry’s heads before its bracket or stop, alternatives split', () => {
    expect(entryHeads('Ânanda-Lahari (Sk.). The wave of joy.')).toEqual(['Ânanda-Lahari'])
    expect(entryHeads('Abba, or Abba Amona (Heb.). Father.')).toEqual(['Abba', 'Abba Amona'])
  })

  it('takes the entry headed by the word, not one that mentions it', () => {
    // "adept" stands in the Arhat and Mahâtma entries too; neither defines it.
    expect(definitionsOf('Adept', TG).map((x) => x.id)).toEqual(['t1'])
  })

  it('folds diacritics and takes a plural against a singular head', () => {
    expect(definitionsOf('Mahatmas', TG).map((x) => x.id)).toEqual(['t3'])
  })

  it('treats hyphen and space alike', () => {
    expect(definitionsOf('Kama rupa', TG).map((x) => x.id)).toEqual(['t4'])
  })

  it('reads a variant named in brackets after the head, never a language tag', () => {
    expect(entryHeads('Atmâ (or Atman) (Sk.). The Universal Spirit.')).toEqual(['Atmâ', 'Atman'])
    expect(entryHeads('Dwellers (on the Threshold). A term invented by Bulwer Lytton.')).toEqual([
      'Dwellers',
      'Dwellers on the Threshold'
    ])
    expect(entryHeads('Arahat (Sk.). The worthy one.')).toEqual(['Arahat'])
    expect(entryHeads('Hermes Sarameyas (Greco-Sanskrit). The God Hermes.')).toEqual([
      'Hermes Sarameyas'
    ])
  })

  it('folds an English sh onto Blavatsky’s s, but only when nothing matched plainly', () => {
    const tg = [b('a1', 'Âkâsa (Sk.). The subtle, supersensuous spiritual essence.')]
    expect(definitionsOf('Akasha', tg).map((x) => x.id)).toEqual(['a1'])
    const both = [b('s1', 'Sela. A word.'), b('s2', 'Shela. Another word.')]
    expect(definitionsOf('Shela', both).map((x) => x.id)).toEqual(['s2'])
  })

  it('closes up a compound the author hyphenates and she writes as one word', () => {
    const tg = [b('m1', 'Mûlaprakriti (Sk.). The Parabrahmic root.')]
    expect(definitionsOf('Mula-Prakriti', tg).map((x) => x.id)).toEqual(['m1'])
  })

  it('cites a Sanskrit stem in -an either way, only after the plain match', () => {
    const tg = [b('u1', 'Sûtrâtman (Sk.). Lit., “the thread of spirit”.')]
    expect(definitionsOf('Sutratma', tg).map((x) => x.id)).toEqual(['u1'])
  })

  it('takes a head that goes on past the term, but only when none is the term itself', () => {
    const tg = [
      b('k1', 'Kundalini Sakti (Sk.). The power of life.'),
      b('h1', 'Hermes Trismegistus (Gr.). The thrice great Hermes.'),
      b('h2', 'Hermes. The messenger.')
    ]
    expect(definitionsOf('Kundalini', tg).map((x) => x.id)).toEqual(['k1'])
    expect(definitionsOf('Hermes', tg).map((x) => x.id)).toEqual(['h2'])
    expect(definitionsOf('Kundal', tg)).toEqual([])
  })

  it('takes a plural on any word of a phrase', () => {
    const tg = [b('d1', 'Dwellers (on the Threshold). A term invented by Bulwer Lytton.')]
    expect(definitionsOf('Dweller on the Threshold', tg).map((x) => x.id)).toEqual(['d1'])
  })

  it('takes a variant spelling from an entry’s first line when no entry is headed by it', () => {
    const tg = [
      b('r1', 'Arahat (Sk.). Also pronounced and written Arhat, Arhan, “the worthy one”.'),
      b('r2', `Bodhi (Sk.). ${'Wisdom. '.repeat(20)}An Arhat attains it.`)
    ]
    expect(definitionsOf('Arhat', tg).map((x) => x.id)).toEqual(['r1'])
  })

  it('does not take an entry that names the word early without marking a variant', () => {
    const tg = [
      b('g1', 'Agni Hotri (Sk.). The priests who served the Fire-God in Aryan antiquity.')
    ]
    expect(definitionsOf('Aryan', tg)).toEqual([])
  })

  it('lets an alias that heads an entry outrank a loose match on the term', () => {
    const tg = [
      b('g1', 'Agni Hotri (Sk.). Also written Agnihotri; priests of the Aryan rite.'),
      b('g2', 'Ârya (Sk.). Lit., “the holy”.')
    ]
    expect(definitionsOf(['Aryan', 'Ârya'], tg).map((x) => x.id)).toEqual(['g2'])
  })

  it('finds a second head of an entry', () => {
    expect(definitionsOf('Abba Amona', TG).map((x) => x.id)).toEqual(['t5'])
  })
})

describe('passages where the word stands', () => {
  const book = [
    b('p1', 'The Manu of the race gave the law, and a manual of it was kept.'),
    b('p2', 'A manual for students.'),
    b('p3', 'There are seven seed Manus° behind the races.')
  ]

  it('matches a whole word only, never inside a longer one', () => {
    expect(passagesOf(['Manu'], [book[1]!], 5, 40)).toEqual([])
  })

  it('puts the author’s circled use first, then book order', () => {
    const uses = passagesOf(['Manu'], book, 5, 40, (m) => m.endsWith('°'))
    expect(uses.map((u) => u.id)).toEqual(['p3', 'p1'])
  })

  it('cuts the passage at word boundaries and marks the cuts', () => {
    const long = b(
      'p9',
      `${'word '.repeat(80)}Devachan is the dwelling of the gods ${'word '.repeat(80)}`
    )
    const [one] = passagesOf(['Devachan'], [long], 1, 32)
    expect(one!.text.startsWith('…word ')).toBe(true)
    // Cut between words on both sides, never through one.
    expect(one!.text).toMatch(/^…word (word )*Devachan is the dwelling of the gods…$/)
    expect(one!.text).toContain('Devachan is the dwelling')
  })

  it('reads through the notation and keeps one passage per block', () => {
    const tagged = b('p4', 'The <i>Devachan</i> state; Devachan again.')
    const got = passagesOf(['Devachan'], [tagged], 5, 200)
    expect(got).toHaveLength(1)
    expect(got[0]!.text).toBe('The Devachan state; Devachan again.')
  })
})

describe('the packet for one entry', () => {
  it('asks the dictionary for the entry and the other books for passages', () => {
    const sources = [
      { title: 'The Theosophical Glossary', blocks: TG, dictionary: true },
      { title: 'The Key to Theosophy', blocks: [b('k1', 'An adept is one who has attained.')] }
    ]
    const packet = glossaryPacket('Adept.', '<b>Adept.</b> Old text.', sources, [
      b('h1', 'Only an adept° can know another.')
    ])
    expect(packet.definitions['The Theosophical Glossary']).toHaveLength(1)
    expect(packet.definitions['The Theosophical Glossary']![0]).toMatch(/^Adept \(Lat\.\)/)
    expect(packet.elsewhere['The Key to Theosophy']).toEqual(['An adept is one who has attained.'])
    expect(packet.elsewhere['The Theosophical Glossary']).toBeUndefined()
    expect(packet.authorUses.map((u) => u.id)).toEqual(['h1'])
    expect(packet.current).toBe('<b>Adept.</b> Old text.')
  })

  it('looks for her spelling in her other books only when the author’s finds nothing', () => {
    const sources = [
      { title: 'The Secret Doctrine', blocks: [b('s1', 'The Mulaprakriti of the Vedantins.')] },
      {
        title: 'The Key to Theosophy',
        blocks: [b('k1', 'Mula-Prakriti is the root.'), b('k2', 'Mulaprakriti again.')]
      }
    ]
    const packet = glossaryPacket('Mula-Prakriti.', undefined, sources, [])
    expect(packet.elsewhere['The Secret Doctrine']).toEqual(['The Mulaprakriti of the Vedantins.'])
    expect(packet.elsewhere['The Key to Theosophy']).toEqual(['Mula-Prakriti is the root.'])
  })

  it('looks a term up under an alias in the sources, and under its own spelling in the book', () => {
    const sources = [
      {
        title: 'The Theosophical Glossary',
        blocks: [b('k1', 'Kabalist. A student of the Kabala.')],
        dictionary: true
      }
    ]
    const book = [b('h1', 'He was called Adam Kadmon by the Cabbalists°.')]
    const without = glossaryPacket('Cabbalist.', undefined, sources, book)
    expect(without.definitions).toEqual({})
    const withAlias = glossaryPacket('Cabbalist.', undefined, sources, book, {
      aliases: { cabbalists: ['Kabalist'] }
    })
    expect(withAlias.definitions['The Theosophical Glossary']).toEqual([
      'Kabalist. A student of the Kabala.'
    ])
    expect(withAlias.authorUses.map((u) => u.id)).toEqual(['h1'])
  })

  it('asks the term and its aliases together, so an alias that heads an entry wins', () => {
    const tg = [
      b('g1', 'Agni Hotri (Sk.). Also written Agnihotri; priests of the Aryan rite.'),
      b('g2', 'Ârya (Sk.). Lit., “the holy”.')
    ]
    const packet = glossaryPacket(
      'Aryan.',
      undefined,
      [{ title: 'TG', blocks: tg, dictionary: true }],
      [],
      { aliases: { Aryan: ['Ârya'] } }
    )
    expect(packet.definitions['TG']).toEqual(['Ârya (Sk.). Lit., “the holy”.'])
  })
})
