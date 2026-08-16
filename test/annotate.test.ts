import { describe, it, expect } from 'vitest'
import {
  buildAnnotationSystemPrompt,
  buildAnnotationUserPrompt,
  checkProposals,
  chunkBlocks,
  contextFor,
  defaultVoice,
  estimateAnnotationCost,
  findAnchor,
  learnVoice,
  normalizeVoice,
  outsideClaims,
  parseAnnotations,
  proposalsToEdits,
  runAnnotation,
  buildIntroductionPrompt,
  draftIntroduction,
  parseIntroduction,
  sampleBook,
  voiceBlock,
  withExemplar,
  MAX_EXEMPLARS,
  type AnnotationProposal,
  type CheckedProposal,
  type EditorVoice
} from '@core/annotate'
import { applyEdits } from '@core/edits'
import type { BookBlock, BookDocument } from '@core/assemble'
import type { Transport } from '@core/transcribe'

let nextId = 0
function block(text: string, kind: BookBlock['kind'] = 'paragraph'): BookBlock {
  return { id: `p0b${nextId++}`, kind, text, sourcePages: [0] }
}

function doc(blocks: BookBlock[]): BookDocument {
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: []
  }
}

/** A transport that answers every request with the same notes. */
function replyWith(notes: unknown[], onBody?: (body: unknown) => void): Transport {
  return async (_url, init) => {
    onBody?.(JSON.parse(String(init.body)))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ notes }) }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 }
      })
    } as Response
  }
}

const CLIENT = { apiKey: 'sk-test', modelId: 'claude-opus-5' }

/**
 * The voice card is the substance of this feature. A model asked for
 * "footnotes" with no further instruction writes an encyclopaedia entry — flat,
 * hedged, and in the register that makes readers stop reading footnotes.
 */
describe('the editor’s voice', () => {
  it('puts the pen name and the house rules into the instruction', () => {
    const voice: EditorVoice = { ...defaultVoice(), penName: 'Etsu T. Dhent' }
    const card = voiceBlock(voice)
    expect(card).toContain('Etsu T. Dhent')
    expect(card).toContain('curious general reader')
    // The rule that does the most work: a definition is not an explanation.
    expect(card).toContain(`Explain, don't just define`)
  })

  it('tells the model that no notes is a good answer', () => {
    // Without this a density target reads as a quota, and the pass pads.
    const prompt = buildAnnotationSystemPrompt(defaultVoice())
    expect(prompt).toContain('should come back with an empty list')
    expect(prompt).toContain('Never invent a fact')
  })

  it('dates the book’s references against its own year, not today', () => {
    const prompt = buildAnnotationSystemPrompt(defaultVoice(), {
      title: 'A Treatise of Airs',
      author: 'Robert Boyle',
      originalYear: '1662'
    })
    expect(prompt).toContain('1662')
    expect(prompt).toContain('not against today')
  })

  it('asks only for the kinds of note the editor wants', () => {
    const card = voiceBlock({ ...defaultVoice(), kinds: ['measure'] })
    expect(card).toContain('weights, distances')
    expect(card).not.toContain('quotation or allusion')
  })

  it('carries approved notes as exemplars, newest first out the door', () => {
    let voice = defaultVoice()
    for (let i = 0; i < MAX_EXEMPLARS + 2; i++) {
      voice = withExemplar(voice, { passage: `passage ${i}`, note: `note ${i}` })
    }
    expect(voice.exemplars).toHaveLength(MAX_EXEMPLARS)
    expect(voice.exemplars[0]!.note).toBe('note 2')
    expect(voiceBlock(voice)).toContain('note 7')
  })

  it('does not keep the same note twice', () => {
    const once = withExemplar(defaultVoice(), { passage: 'a', note: 'the same note' })
    const twice = withExemplar(once, { passage: 'b', note: 'the same note' })
    expect(twice.exemplars).toHaveLength(1)
  })

  it('reads a stored voice back, and never as one that annotates nothing', () => {
    // An empty kind list would cost money to be told there is nothing to say.
    const restored = normalizeVoice({ penName: 'Etsu T. Dhent', kinds: [], maxWords: 900 })
    expect(restored.penName).toBe('Etsu T. Dhent')
    expect(restored.kinds.length).toBeGreaterThan(0)
    expect(restored.maxWords).toBeLessThanOrEqual(120)
    expect(normalizeVoice('not a voice at all').density).toBe('balanced')
  })
})

describe('cutting the book up to ask about it', () => {
  it('chunks by words, never splitting a block', () => {
    const blocks = Array.from({ length: 10 }, () => block('word '.repeat(100).trim()))
    const chunks = chunkBlocks(blocks, 250)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap((c) => c.blocks)).toHaveLength(10)
  })

  it('hands the previous chunk’s tail over as context', () => {
    // A note often belongs to a sentence set up a paragraph earlier, and a
    // chunk boundary would otherwise hide the setup.
    const blocks = Array.from({ length: 6 }, (_, i) =>
      block(`Paragraph ${i}. ${'word '.repeat(60)}`)
    )
    const chunks = chunkBlocks(blocks, 150)
    const context = contextFor(chunks[0])
    expect(context.length).toBeGreaterThan(0)
    expect(chunks[0]!.blocks).toContain(context[context.length - 1])
  })

  it('marks context blocks as unannotatable in the prompt', () => {
    const body = block('The alembick being set upon a gentle fire.')
    const before = block('What went before.')
    const prompt = buildAnnotationUserPrompt({ index: 1, blocks: [body], wordCount: 8 }, [before])
    expect(prompt).toContain(`[${before.id}] [context only]`)
    expect(prompt).toContain(`[${body.id}] The alembick`)
  })

  it('does not pay for a chunk with nothing annotatable in it', () => {
    const chunks = chunkBlocks([block('CHAPTER II', 'heading'), block('Fig. 1.', 'caption')])
    expect(chunks).toHaveLength(0)
  })
})

/**
 * The model cannot count characters, so it is never asked to. It quotes the
 * words the note hangs on, and the offset is found here.
 */
describe('finding where a note goes', () => {
  const text = 'The chirurgeon examined the specimen with extraordinary care that evening.'

  it('puts the mark after the words the note refers to', () => {
    const at = findAnchor(text, 'chirurgeon')
    expect(at).toBe(text.indexOf('chirurgeon') + 'chirurgeon'.length)
  })

  it('matches a quote that crossed a line break in the original', () => {
    // The text handed to the model has been reflowed, so a quotation carrying
    // the original's line break would otherwise never match.
    const wrapped = 'The chirurgeon\n  examined the specimen.'
    expect(findAnchor(wrapped, 'chirurgeon examined')).toBeGreaterThan(0)
  })

  it('refuses to guess when the words are not there', () => {
    // A note attached to the wrong sentence reads as an editor who did not
    // understand the passage. Better to hand it back unplaced.
    expect(findAnchor(text, 'the doctrine of signatures')).toBeNull()
  })
})

describe('which assertions the book never made', () => {
  const source = 'The chirurgeon examined the specimen, following Paracelsus in every particular.'

  it('flags a date the editor supplied', () => {
    expect(outsideClaims('Paracelsus died in 1541.', source)).toContain('1541')
  })

  it('says nothing about a name the book itself uses', () => {
    // Mid-sentence on purpose: at the start of one it would be skipped as
    // sentence-initial capitalisation whether the book used it or not, and the
    // test would pass without proving anything.
    const claims = outsideClaims('A physician, Paracelsus rejected Galen.', source)
    expect(claims).not.toContain('Paracelsus')
    expect(claims).toContain('Galen')
  })

  it('does not mistake a sentence’s first word for a name', () => {
    // Otherwise every note opens with a flagged "claim".
    expect(outsideClaims('Surgery was then a manual trade.', source)).not.toContain('Surgery')
  })

  it('leaves a note that asserts nothing outside the book unflagged', () => {
    expect(outsideClaims('A specimen the author examined with care.', source)).toEqual([])
  })
})

describe('reading the reply', () => {
  const known = new Set(['p0b1', 'p0b2'])

  it('drops a note naming a block that is not in the chunk', () => {
    // Usually a sign the model invented an id rather than quoting one.
    const { proposals, discarded } = parseAnnotations(
      {
        notes: [
          { blockId: 'p0b1', anchorText: 'a', kind: 'person', text: 'A note.', reason: 'r' },
          { blockId: 'nowhere', anchorText: 'b', kind: 'person', text: 'A note.', reason: 'r' }
        ]
      },
      known
    )
    expect(proposals).toHaveLength(1)
    expect(discarded).toBe(1)
  })

  it('throws only when there is no list of notes at all', () => {
    expect(() => parseAnnotations({ oops: true }, known)).toThrow()
    expect(parseAnnotations({ notes: [] }, known).proposals).toEqual([])
  })
})

describe('running the pass', () => {
  const body = block('The chirurgeon examined the specimen, following Paracelsus.')

  const note = {
    blockId: '',
    anchorText: 'Paracelsus',
    kind: 'person',
    text: 'A Swiss physician who insisted on observing patients rather than reading Galen.',
    reason: 'named as though the reader knows him'
  }

  it('returns proposals located in the book and checked for outside claims', async () => {
    const result = await runAnnotation([body], {
      client: { ...CLIENT, transport: replyWith([{ ...note, blockId: body.id }]) },
      voice: defaultVoice()
    })
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]!.at).toBeGreaterThan(0)
    // "Swiss" and "Galen" are the editor's, not the book's.
    expect(result.proposals[0]!.outsideClaims).toContain('Galen')
    expect(result.usage.outputTokens).toBe(50)
  })

  it('caches the voice card rather than paying for it every chunk', async () => {
    let seen: unknown = null
    await runAnnotation([body], {
      client: { ...CLIENT, transport: replyWith([], (b) => (seen = b)) },
      voice: defaultVoice()
    })
    const system = (seen as { system: { cache_control?: unknown }[] }).system[0]
    expect(system.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('carries on past a chunk that failed instead of losing the book', async () => {
    // A page that fails to transcribe is a hole in the book. A chunk that fails
    // to annotate is some suggestions missing from a list the user is about to
    // go through anyway.
    const blocks = Array.from({ length: 4 }, (_, i) =>
      block(`Paragraph ${i}. ${'word '.repeat(200)}`)
    )
    let call = 0
    const transport: Transport = async (url, init) => {
      call += 1
      if (call === 1) return { ok: false, status: 400, json: async () => ({}) } as Response
      return replyWith([])(url, init)
    }
    const result = await runAnnotation(blocks, {
      client: { ...CLIENT, transport },
      voice: defaultVoice(),
      chunkWords: 250,
      sleep: async () => {}
    })
    expect(result.failures).toHaveLength(1)
    expect(call).toBeGreaterThan(1)
  })

  it('stops between chunks when cancelled', async () => {
    const blocks = Array.from({ length: 6 }, () => block('word '.repeat(200).trim()))
    let calls = 0
    const result = await runAnnotation(blocks, {
      client: {
        ...CLIENT,
        transport: async (url, init) => {
          calls += 1
          return replyWith([])(url, init)
        }
      },
      voice: defaultVoice(),
      chunkWords: 200,
      isCancelled: () => calls >= 2
    })
    expect(result.cancelled).toBe(true)
    expect(calls).toBe(2)
  })
})

describe('an approved note becomes an ordinary correction', () => {
  const body = block('The chirurgeon examined the specimen, following Paracelsus.')

  const checked = (over: Partial<CheckedProposal> = {}): CheckedProposal => ({
    blockId: body.id,
    anchorText: 'Paracelsus',
    kind: 'person',
    text: 'A Swiss physician who preferred observation to authority.',
    reason: 'named in passing',
    at: body.text.indexOf('Paracelsus') + 'Paracelsus'.length,
    outsideClaims: [],
    ...over
  })

  it('is set at the foot of the page, through the machinery that already existed', () => {
    const { edits } = proposalsToEdits([{ proposal: checked(), text: checked().text }])
    expect(edits[0]).toMatchObject({ kind: 'note', blockId: body.id })

    const book = applyEdits(doc([body]), edits)
    expect(book.footnotes).toHaveLength(1)
    expect(book.footnotes[0]!.text).toContain('Swiss physician')
    // Located by an anchor, not by splicing a marker into the text.
    expect(book.blocks[0]!.text).toBe(body.text)
  })

  it('keeps the user’s rewrite, not the model’s draft', () => {
    const { edits } = proposalsToEdits([{ proposal: checked(), text: 'Shorter, and better.' }])
    expect((edits[0] as { text: string }).text).toBe('Shorter, and better.')
  })

  it('hands back an unplaceable note rather than putting it somewhere wrong', () => {
    const stray = checked({ at: null })
    const { edits, unplaced } = proposalsToEdits([{ proposal: stray, text: stray.text }])
    expect(edits).toEqual([])
    expect(unplaced).toEqual([stray])
  })

  it('mints ids that do not collide within a batch', () => {
    const { edits } = proposalsToEdits(
      Array.from({ length: 5 }, () => ({ proposal: checked(), text: 'A note.' })),
      { now: 1_700_000_000_000 }
    )
    const ids = edits.map((e) => (e as { noteId: string }).noteId)
    expect(new Set(ids).size).toBe(5)
  })

  it('learns the voice from what was approved, in the form it was approved in', () => {
    const voice = learnVoice(defaultVoice(), [
      { proposal: checked(), text: 'Shorter, and better.' }
    ])
    expect(voice.exemplars[0]!.note).toBe('Shorter, and better.')
    expect(voiceBlock(voice)).toContain('Shorter, and better.')
  })
})

describe('what it will cost', () => {
  it('is far cheaper than the vision pass, and says so in real money', () => {
    const estimate = estimateAnnotationCost({
      wordCount: 80_000,
      modelId: 'claude-opus-5',
      density: 'balanced'
    })
    expect(estimate.usd).toBeGreaterThan(0)
    expect(estimate.usdLow).toBeLessThan(estimate.usd)
    expect(estimate.usdHigh).toBeGreaterThan(estimate.usd)
  })

  it('costs more to annotate generously than sparingly', () => {
    const inputs = { wordCount: 80_000, modelId: 'claude-opus-5' as const }
    const sparing = estimateAnnotationCost({ ...inputs, density: 'sparing' })
    const generous = estimateAnnotationCost({ ...inputs, density: 'generous' })
    expect(generous.usd).toBeGreaterThan(sparing.usd)
  })
})

describe('checkProposals', () => {
  it('measures the note against the whole book, not only its own passage', () => {
    // A name introduced three chapters earlier is the book's, not the editor's.
    const here = block('He followed the method in every particular.')
    const earlier = block('Paracelsus had taught otherwise.')
    const proposals: AnnotationProposal[] = [
      {
        blockId: here.id,
        anchorText: 'the method',
        kind: 'context',
        text: 'The method Paracelsus taught.',
        reason: 'r'
      }
    ]
    const checked = checkProposals(
      proposals,
      new Map([[here.id, here.text]]),
      [earlier.text, here.text].join('\n')
    )
    expect(checked[0]!.outsideClaims).toEqual([])
  })
})

/**
 * The other half of what an editor adds. It shares the voice card with the
 * notes on purpose: an introduction that reads like a different person from the
 * notes underneath it is worse than either alone.
 */
describe('the editor’s introduction', () => {
  const chapters = ['Of Fire', 'Of Water', 'Of the Quintessence']
  const long = (n: number): string =>
    `Chapter ${n}. ` +
    'The alembick being set upon a gentle fire and the matter therein digested. '.repeat(8)

  function bookOfChapters(): BookDocument {
    const blocks: BookBlock[] = []
    chapters.forEach((title, i) => {
      blocks.push(block(title, 'heading'))
      blocks.push(block(long(i)), block(long(i + 10)))
    })
    const built = doc(blocks)
    return {
      ...built,
      chapters: chapters.map((title, i) => ({
        id: `c${i}`,
        title,
        level: 1,
        blockIndex: i * 3,
        sourcePage: i
      }))
    }
  }

  it('is written in the same voice as the notes', () => {
    const voice: EditorVoice = { ...defaultVoice(), penName: 'Etsu T. Dhent' }
    const { system } = buildIntroductionPrompt(bookOfChapters(), { voice })
    expect(system).toContain('Etsu T. Dhent')
    expect(system).toContain('curious general reader')
  })

  it('shows the book’s own shape and lets it be heard', () => {
    const { user } = buildIntroductionPrompt(bookOfChapters(), {
      voice: defaultVoice(),
      facts: { title: 'A Treatise of Airs', author: 'Robert Boyle', originalYear: '1662' }
    })
    for (const title of chapters) expect(user).toContain(title)
    expect(user).toContain('1662')
    expect(user).toContain('alembick')
  })

  it('samples across the whole book, not just its opening', () => {
    // The first pages of an old book are its least representative: that is
    // where the dedication and the throat-clearing live.
    const built = bookOfChapters()
    const samples = sampleBook(built, 3)
    expect(samples.length).toBeGreaterThan(1)
    expect(new Set(samples).size).toBe(samples.length)
  })

  it('forbids the introduction that would fit any book of the period', () => {
    const { system } = buildIntroductionPrompt(bookOfChapters(), { voice: defaultVoice() })
    expect(system).toContain('Do not write the generic')
    expect(system).toContain('leave it out rather than filling it in')
  })

  it('asks for the length the editor chose', () => {
    const brief = buildIntroductionPrompt(bookOfChapters(), {
      voice: defaultVoice(),
      length: 'brief'
    }).system
    expect(brief).toContain('350 words')
  })

  it('parses paragraphs into the shape a section edit already takes', () => {
    const { title, text } = parseIntroduction({
      title: 'Introduction',
      paragraphs: ['First paragraph.', '  ', 'Second paragraph.']
    })
    expect(title).toBe('Introduction')
    // Blank lines between paragraphs — the convention the section edit splits
    // on, so there is no markup for anyone to learn.
    expect(text).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('refuses an empty draft rather than adding a blank division', () => {
    expect(() => parseIntroduction({ title: 'Introduction', paragraphs: [] })).toThrow()
    expect(() => parseIntroduction({ nope: true })).toThrow()
  })

  it('comes back with the claims the book never made, for checking', async () => {
    const built = bookOfChapters()
    const transport: Transport = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                title: 'Introduction',
                paragraphs: ['Boyle published this in 1662, against the Aristotelians.']
              })
            }
          ],
          usage: { input_tokens: 900, output_tokens: 400, cache_read_input_tokens: 0 }
        })
      }) as Response

    const { draft, usage } = await draftIntroduction(built, {
      client: { ...CLIENT, transport },
      voice: defaultVoice()
    })
    expect(draft.text).toContain('1662')
    expect(draft.outsideClaims).toContain('1662')
    expect(draft.outsideClaims).toContain('Aristotelians')
    expect(usage.outputTokens).toBe(400)
  })
})
