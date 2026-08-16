import { describe, it, expect } from 'vitest'
import {
  bankStem,
  buildHarvestBlock,
  buildHarvestSystemPrompt,
  canonicalTag,
  canonicalTags,
  checkFacts,
  chunkBlocks,
  dedupeFacts,
  emptyVocabulary,
  estimateHarvestCost,
  factsFromNotes,
  growVocabulary,
  normalizeTag,
  normalizeVocabulary,
  parseFacts,
  renderBank,
  renderBankJsonl,
  renderBankMarkdown,
  runHarvest,
  topTags,
  type Fact,
  type FactSource,
  type RawFact,
  type TagVocabulary
} from '@core/harvest'
import { defaultVoice, runAnnotation } from '@core/annotate'
import type { BookBlock } from '@core/assemble'
import type { Transport } from '@core/transcribe'
import { initialState, stepById, type WizardState } from '@core/wizard'

let nextId = 0
function block(text: string, kind: BookBlock['kind'] = 'paragraph', page = 0): BookBlock {
  return { id: `p${page}b${nextId++}`, kind, text, sourcePages: [page] }
}

const SOURCE: FactSource = {
  title: 'A Treatise of Airs',
  author: 'Robert Boyle',
  originalYear: '1662',
  fileName: 'boyle.pdf',
  harvestedAt: '2026-08-16T12:00:00.000Z'
}

const CLIENT = { apiKey: 'sk-test', modelId: 'claude-opus-5' }

function replyWith(facts: unknown[], onBody?: (body: unknown) => void): Transport {
  return async (_url, init) => {
    onBody?.(JSON.parse(String(init.body)))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ notes: [], facts }) }],
        usage: { input_tokens: 900, output_tokens: 700, cache_read_input_tokens: 0 }
      })
    } as Response
  }
}

function raw(over: Partial<RawFact> = {}): RawFact {
  return {
    title: 'The alembick',
    body: 'A two-part still: the cucurbit held the matter over the fire and the cap carried the vapour off.',
    footing: 'stated',
    category: 'apparatus',
    tags: ['distillation'],
    blockId: '',
    quote: '',
    ...over
  }
}

/**
 * A model already knows the general history of any subject an old book covers.
 * What nothing else has is *this* book, of a known year, saying this — so the
 * bank is built around primary attestation, and an entry that restates common
 * knowledge is worth less than nothing because it buries the ones that are not.
 */
describe('what the harvest is asked for', () => {
  it('asks for what only this book witnesses, and says what to leave out', () => {
    const block_ = buildHarvestBlock()
    expect(block_).toContain('THIS book uniquely witnesses')
    expect(block_).toContain('worse')
    expect(block_).toContain('anything you would have known without')
  })

  it('asks for length, because the reader will not have the book', () => {
    // The failure mode this prevents: a file of one-line labels, useless two
    // years later with no book beside it.
    expect(buildHarvestBlock()).toContain('WRITE THEM AT LENGTH')
    expect(buildHarvestBlock()).toContain('Do not compress')
  })

  it('explains that overclaiming a footing is checked and demoted', () => {
    const block_ = buildHarvestBlock()
    expect(block_).toContain('demoted')
    expect(block_).toContain('Never paraphrase')
  })

  it('dates the book against its own year', () => {
    const prompt = buildHarvestSystemPrompt({ originalYear: '1662' })
    expect(prompt).toContain('1662')
    expect(prompt).toContain('not against today')
  })

  it('weights the harvest towards what the editor is collecting for', () => {
    const block_ = buildHarvestBlock({ interest: 'early modern glassmaking' })
    expect(block_).toContain('early modern glassmaking')
    // But never at the price of what the book actually has.
    expect(block_).toContain('do not force it')
  })
})

/**
 * The failure that kills these banks: forty books in, `alchemy`, `alchemical`
 * and `Alchemy` are three tags that join nothing to anything.
 */
describe('the tag vocabulary, which grows instead of drifting', () => {
  const vocabulary: TagVocabulary = { counts: { alchemy: 9, distillation: 4, mineral: 2 } }

  it('offers the tags already in use to the next book', () => {
    const block_ = buildHarvestBlock({ vocabulary })
    expect(block_).toContain('already in use')
    expect(block_).toContain('alchemy')
    expect(block_).toContain('Coin a new one only when')
  })

  it('sets the vocabulary deliberately when the bank is empty', () => {
    const block_ = buildHarvestBlock({ vocabulary: emptyVocabulary() })
    expect(block_).toContain('setting the vocabulary')
  })

  it('folds case and spacing onto an existing tag', () => {
    expect(canonicalTag('  Alchemy ', ['alchemy'])).toBe('alchemy')
    expect(normalizeTag('Natural_Philosophy')).toBe('natural philosophy')
  })

  it('folds a plural onto the singular already banked, and the reverse', () => {
    expect(canonicalTag('minerals', ['mineral'])).toBe('mineral')
    expect(canonicalTag('mineral', ['minerals'])).toBe('minerals')
  })

  it('coins a new tag rather than forcing a bad match', () => {
    // Deliberately conservative: anything fuzzier would merge tags a person
    // kept apart on purpose.
    expect(canonicalTag('glassmaking', ['alchemy'])).toBe('glassmaking')
  })

  it('drops duplicates and empties in one pass', () => {
    expect(canonicalTags(['Alchemy', 'alchemy', '  ', 'mineral'], ['alchemy'])).toEqual([
      'alchemy',
      'mineral'
    ])
  })

  it('grows by use, so the offered tags are the ones organising the bank', () => {
    const grown = growVocabulary(vocabulary, [
      {
        ...raw({ tags: ['glassmaking'], category: 'apparatus' }),
        id: 'a',
        sourcePage: 0,
        quoteVerified: true
      } as Fact
    ])
    expect(grown.counts['glassmaking']).toBe(1)
    expect(grown.counts['apparatus']).toBe(1)
    expect(topTags(grown)[0]).toBe('alchemy')
  })

  it('reads a stored vocabulary back, normalising as it goes', () => {
    const restored = normalizeVocabulary({ counts: { ' Alchemy ': 3, bad: 'x' } })
    expect(restored.counts['alchemy']).toBe(3)
    expect(restored.counts['bad']).toBeUndefined()
    expect(normalizeVocabulary('nonsense')).toEqual(emptyVocabulary())
  })
})

/**
 * The check that makes the file usable years later. Mixing "the book says this"
 * with "the model knows this" produces a document nobody can rely on, because
 * there is no way left to tell which is which.
 */
describe('footing, and the quotation that has to back it', () => {
  const body = block('The alembick being set upon a gentle fire, and the matter therein digested.')

  it('keeps a stated entry whose words are in the book', () => {
    const [fact] = checkFacts(
      [raw({ blockId: body.id, quote: 'The alembick being set upon a gentle fire' })],
      [body],
      'key'
    )
    expect(fact!.footing).toBe('stated')
    expect(fact!.quoteVerified).toBe(true)
    expect(fact!.demotedFrom).toBeUndefined()
  })

  it('demotes a stated entry whose words are nowhere in the book', () => {
    // Whatever it is, it is not attested here — and an overclaim that survived
    // would be indistinguishable from a real citation later.
    const [fact] = checkFacts(
      [raw({ blockId: body.id, quote: 'the doctrine of signatures, as Paracelsus taught' })],
      [body],
      'key'
    )
    expect(fact!.footing).toBe('context')
    expect(fact!.demotedFrom).toBe('stated')
    expect(fact!.quote).toBe('')
  })

  it('accepts the right words attributed to the wrong block', () => {
    // A bookkeeping slip, not a false claim — demoting for it would throw away
    // a good entry.
    const elsewhere = block('Another leaf entirely.')
    const [fact] = checkFacts(
      [raw({ blockId: elsewhere.id, quote: 'the matter therein digested' })],
      [body, elsewhere],
      'key'
    )
    expect(fact!.footing).toBe('stated')
    expect(fact!.quoteVerified).toBe(true)
  })

  it('matches a quotation that crossed a line break', () => {
    const wrapped = block('The alembick being\n   set upon a gentle fire.')
    const [fact] = checkFacts(
      [raw({ blockId: wrapped.id, quote: 'alembick being set upon' })],
      [wrapped],
      'key'
    )
    expect(fact!.quoteVerified).toBe(true)
  })

  it('leaves a context entry alone — it is not claiming the book said it', () => {
    const [fact] = checkFacts([raw({ footing: 'context', blockId: body.id })], [body], 'key')
    expect(fact!.footing).toBe('context')
    expect(fact!.demotedFrom).toBeUndefined()
  })

  it('treats an unrecognised footing as the weakest, never the strongest', () => {
    const { facts } = parseFacts({ facts: [{ ...raw(), footing: 'gospel' }] })
    expect(facts[0]!.footing).toBe('context')
  })

  it('records the scan page, so the leaf can be found again', () => {
    const onPage = block('Words on a later leaf.', 'paragraph', 41)
    const [fact] = checkFacts([raw({ blockId: onPage.id, quote: 'a later leaf' })], [onPage], 'key')
    expect(fact!.sourcePage).toBe(41)
  })
})

describe('reading a reply', () => {
  it('drops an entry with no substance and counts it', () => {
    const { facts, discarded } = parseFacts({
      facts: [raw(), { ...raw(), body: '' }, 'nonsense']
    })
    expect(facts).toHaveLength(1)
    expect(discarded).toBe(2)
  })

  it('says nothing rather than throwing when a reply carries no facts at all', () => {
    // The notes in the same reply must not be lost to a malformed harvest.
    expect(parseFacts({ notes: [] })).toEqual({ facts: [], discarded: 0 })
  })

  it('gives the same entry the same id every time the book is harvested', () => {
    const one = checkFacts([raw()], [], 'boyle.pdf')[0]!
    const two = checkFacts([raw()], [], 'boyle.pdf')[0]!
    expect(one.id).toBe(two.id)
    expect(checkFacts([raw()], [], 'other.pdf')[0]!.id).not.toBe(one.id)
  })

  it('drops a repeat within one book', () => {
    const facts = checkFacts([raw(), raw()], [], 'key')
    expect(dedupeFacts(facts)).toHaveLength(1)
  })
})

describe('harvesting a book nobody is annotating', () => {
  const blocks = [
    block('The alembick being set upon a gentle fire, and the matter therein digested.'),
    block('Rates of exchange', 'table')
  ]

  it('reads the book and returns entries located in it', async () => {
    const result = await runHarvest(blocks, {
      client: {
        ...CLIENT,
        transport: replyWith([raw({ blockId: blocks[0]!.id, quote: 'a gentle fire' })])
      },
      sourceKey: 'boyle.pdf'
    })
    expect(result.facts).toHaveLength(1)
    expect(result.facts[0]!.quoteVerified).toBe(true)
    expect(result.usage.outputTokens).toBe(700)
  })

  it('harvests tables, which the annotation pass has nothing to say about', () => {
    // A table of weights or rates is some of the densest material an old book
    // has, and it carries no prose to annotate.
    const tablesOnly = [block('Rates of exchange', 'table'), block('Weights', 'table')]
    expect(chunkBlocks(tablesOnly, { requireProse: false })).toHaveLength(1)
    expect(chunkBlocks(tablesOnly)).toHaveLength(0)
  })

  it('carries on past a failed stretch rather than losing the harvest', async () => {
    const many = Array.from({ length: 4 }, (_, i) =>
      block(`Paragraph ${i}. ${'word '.repeat(200)}`)
    )
    let call = 0
    const transport: Transport = async (url, init) => {
      call += 1
      if (call === 1) return { ok: false, status: 400, json: async () => ({}) } as Response
      return replyWith([])(url, init)
    }
    const result = await runHarvest(many, {
      client: { ...CLIENT, transport },
      sourceKey: 'k',
      chunkWords: 250,
      sleep: async () => {}
    })
    expect(result.failures).toHaveLength(1)
    expect(call).toBeGreaterThan(1)
  })
})

describe('harvesting alongside the notes', () => {
  const body = block('The alembick being set upon a gentle fire, and the matter therein digested.')

  it('returns entries from the same reply as the notes', async () => {
    const result = await runAnnotation([body], {
      client: {
        ...CLIENT,
        transport: replyWith([raw({ blockId: body.id, quote: 'a gentle fire' })])
      },
      voice: defaultVoice(),
      harvest: { sourceKey: 'boyle.pdf' }
    })
    expect(result.facts).toHaveLength(1)
    expect(result.facts[0]!.title).toBe('The alembick')
  })

  it('harvests nothing when nothing was asked for, even if the reply offers it', async () => {
    const result = await runAnnotation([body], {
      client: { ...CLIENT, transport: replyWith([raw({ blockId: body.id })]) },
      voice: defaultVoice()
    })
    expect(result.facts).toEqual([])
  })

  it('puts the harvest instruction in the cached half of the prompt', async () => {
    let seen: unknown = null
    await runAnnotation([body], {
      client: { ...CLIENT, transport: replyWith([], (b) => (seen = b)) },
      voice: defaultVoice(),
      harvest: { sourceKey: 'k' }
    })
    const system = (seen as { system: { text: string; cache_control?: unknown }[] }).system[0]!
    expect(system.text).toContain('HARVEST WHAT IS WORTH KEEPING')
    expect(system.cache_control).toEqual({ type: 'ephemeral' })
  })
})

describe('the notes the editor approved, banked for free', () => {
  const body = block('The alembick being set upon a gentle fire, following Paracelsus.')

  it('banks a note that explains something', () => {
    const [fact] = factsFromNotes(
      [
        {
          blockId: body.id,
          anchorText: 'Paracelsus',
          kind: 'person',
          text: 'A Swiss physician who insisted on observing patients rather than reading Galen, and whose followers dominated chymical medicine for a century.'
        }
      ],
      [body],
      'boyle.pdf'
    )
    expect(fact!.category).toBe('person')
    // The editor's assertion, not the book's — the book supplied the word being
    // explained, not the explanation.
    expect(fact!.footing).toBe('context')
    expect(fact!.quote).toBe('Paracelsus')
    expect(fact!.sourcePage).toBe(0)
  })

  it('skips a gloss too short to be worth anything without the book', () => {
    const banked = factsFromNotes(
      [{ blockId: body.id, anchorText: 'alembick', kind: 'archaic-word', text: 'A still.' }],
      [body],
      'k'
    )
    expect(banked).toEqual([])
  })
})

describe('writing the bank out', () => {
  const onLeaf = block('The alembick being set upon a gentle fire.', 'paragraph', 12)
  const facts: Fact[] = checkFacts(
    [
      raw({ blockId: onLeaf.id, quote: 'a gentle fire', tags: ['distillation', 'apparatus'] }),
      raw({
        title: 'Fourty dayes of digestion',
        body: 'The standard period for the wet way, counted from the first sign of vapour.',
        category: 'method',
        footing: 'implied',
        tags: ['distillation']
      })
    ],
    [onLeaf],
    'boyle.pdf'
  )

  it('writes a file a person can read, with the standing of every entry on it', () => {
    const md = renderBankMarkdown(SOURCE, facts)
    expect(md).toContain('# A Treatise of Airs — Robert Boyle, 1662')
    expect(md).toContain('## apparatus')
    expect(md).toContain('### The alembick')
    expect(md).toContain('stated by the book')
    expect(md).toContain('implied by the book')
    expect(md).toContain('> a gentle fire')
    expect(md).toContain('**Tags:** distillation, apparatus')
  })

  it('says which leaf of the scan an entry came from', () => {
    // One-based in the file, because that is how a person counts pages.
    expect(renderBankMarkdown(SOURCE, facts)).toContain('scan p. 13')
  })

  it('indexes the tags so an entry filed elsewhere can still be found', () => {
    expect(renderBankMarkdown(SOURCE, facts)).toContain('**Tags in this book:** distillation (2)')
  })

  it('writes one JSON object per line, each carrying its own book', () => {
    // `cat *.jsonl` has to be a valid way to combine banks, which rules out a
    // header line and requires the provenance on every record.
    const lines = renderBankJsonl(SOURCE, facts).split('\n')
    expect(lines).toHaveLength(facts.length)
    for (const line of lines) {
      const parsed = JSON.parse(line) as { source: { title: string }; footing: string }
      expect(parsed.source.title).toBe('A Treatise of Airs')
      expect(parsed.footing).toBeTruthy()
    }
  })

  it('names the files so a shelf of them sorts sensibly', () => {
    expect(bankStem(SOURCE)).toBe('robert-boyle--a-treatise-of-airs--1662')
    const files = renderBank(SOURCE, facts)
    expect(files.map((f) => f.fileName)).toEqual([
      'robert-boyle--a-treatise-of-airs--1662.facts.md',
      'robert-boyle--a-treatise-of-airs--1662.facts.jsonl'
    ])
  })

  it('says so when an entry was demoted, rather than quietly lowering it', () => {
    const demoted = checkFacts(
      [raw({ blockId: onLeaf.id, quote: 'words not in this book' })],
      [onLeaf],
      'k'
    )
    expect(renderBankMarkdown(SOURCE, demoted)).toContain('its quotation was not in the book')
  })
})

describe('what it costs', () => {
  const inputs = { wordCount: 80_000, modelId: 'claude-opus-5', depth: 'standard' as const }

  it('is far cheaper riding the notes than reading the book again', () => {
    // The number that makes the choice between the two paths an informed one.
    const riding = estimateHarvestCost({ ...inputs, standalone: false })
    const alone = estimateHarvestCost({ ...inputs, standalone: true })
    expect(alone.usd).toBeGreaterThan(riding.usd)
    expect(riding.inputTokens).toBeLessThan(alone.inputTokens / 5)
  })

  it('costs more to harvest thoroughly than selectively', () => {
    const selective = estimateHarvestCost({ ...inputs, depth: 'selective', standalone: true })
    const thorough = estimateHarvestCost({ ...inputs, depth: 'thorough', standalone: true })
    expect(thorough.usd).toBeGreaterThan(selective.usd)
  })
})

/**
 * The gate. Harvesting is deliberately independent of the notes: a book can be
 * worth mining and not worth annotating, and the two are priced apart because
 * riding the annotation pass is nearly free and reading the book again is not.
 */
describe('the harvest question at the gate', () => {
  const ready = (): WizardState => ({
    ...initialState(),
    document: {
      blocks: [],
      footnotes: [],
      chapters: [],
      asides: [],
      illustrations: [],
      sections: [],
      skipped: []
    },
    completed: [
      'intake',
      'recon',
      'gate-identity',
      'transcribe',
      'gate-uncertainties',
      'gate-structure',
      'proof'
    ]
  })

  const valuesOf = (id: string): string[] => {
    const q = stepById('annotate')
      .questions(ready())
      .find((x) => x.id === id)
    return q && 'options' in q ? q.options.map((o) => String(o.value)) : []
  }

  it('can be answered independently of the notes', () => {
    expect(valuesOf('harvestFacts')).toEqual(['selective', 'standard', 'thorough', 'none'])
  })

  it('can be skipped, so a plain reprint stays free', () => {
    expect(valuesOf('harvestFacts')).toContain('none')
  })

  it('remembers what the user is collecting towards, across books', () => {
    const state: WizardState = { ...ready(), harvestInterest: 'early modern glassmaking' }
    const q = stepById('annotate')
      .questions(state)
      .find((x) => x.id === 'harvestInterest')
    expect(q && 'defaultValue' in q ? q.defaultValue : '').toBe('early modern glassmaking')
  })
})
