import { describe, it, expect } from 'vitest'
import {
  buildAnnotationSystemPrompt,
  buildAnnotationUserPrompt,
  checkProposals,
  chunkBlocks,
  contextFor,
  VOICE_KEYS,
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
  apparatusOf,
  introductionOutlineTask,
  introductionWords,
  parseIntroduction,
  sampleBook,
  proseBlock,
  voiceBlock,
  withExemplar,
  withProseSample,
  MAX_EXEMPLARS,
  MAX_PROSE_SAMPLES,
  type AnnotationProposal,
  type CheckedProposal,
  type EditorVoice
} from '@core/annotate'
import { GLOSSARY_MARK } from '@core/annotate'
import { applyEdits } from '@core/edits'
import { initialState, STEPS, stepById, type WizardState } from '@core/wizard'
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
    skipped: [],
    synopsesUnmatched: []
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

  /**
   * The guard the banking rule rests on, and the one this module went without.
   *
   * The file has always claimed that a voice is the same editor on every book;
   * nothing checked it, so the claim held only as long as whoever added a field
   * read the comment first. Now adding one fails here until somebody has
   * decided whether it is really the editor or really this book.
   */
  it('accounts for every field an EditorVoice carries', () => {
    expect(Object.keys(defaultVoice()).sort()).toEqual([...VOICE_KEYS].sort())
  })

  it('carries the refusals, and as refusals', () => {
    const card = voiceBlock({
      ...defaultVoice(),
      avoid: ['Call the author naive', '  ', 'Open a note with “Interestingly”']
    })
    expect(card).toContain('WHAT THIS EDITOR NEVER DOES:')
    expect(card).toContain('- Call the author naive')
    expect(card).toContain('- Open a note with “Interestingly”')
    // A blank line in the list is a blank line in the textarea, not a refusal.
    expect(card).not.toContain('- \n')
  })

  it('counts a single note per thousand words as one note', () => {
    // "1 notes per thousand" in the instruction that sets the density. Small,
    // and exactly the class of slip this edition spent a day removing from a
    // printed book — no reason to write new ones into the prompt.
    expect(voiceBlock({ ...defaultVoice(), density: 'sparing' })).toContain('1 note per thousand')
    expect(voiceBlock({ ...defaultVoice(), density: 'generous' })).toContain('5 notes per thousand')
  })

  it('says nothing about refusals when the editor has none', () => {
    expect(voiceBlock(defaultVoice())).not.toContain('NEVER DOES')
  })

  it('reads an avoid list back, and survives one written as anything else', () => {
    expect(normalizeVoice({ avoid: ['no jokes', 42, ''] }).avoid).toEqual(['no jokes'])
    expect(normalizeVoice({ avoid: 'no jokes' }).avoid).toEqual([])
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

  it('reads a title through its markup rather than around it', () => {
    // `<i>` is how a title travels in a note, and the extractor was taking the
    // closing tag as part of the word: `The Secret Doctrine</i` is not a claim
    // anybody can check, and because the mangled token matches nothing it was
    // also reported as *outside* the book when the book names it.
    const source = 'He quotes The Secret Doctrine at length in the third lesson.'
    const claims = outsideClaims('The passage is from <i>The Secret Doctrine</i> of 1888.', source)
    expect(claims.some((c) => c.includes('<') || c.includes('>'))).toBe(false)
    expect(claims).not.toContain('Doctrine')
    expect(claims).toContain('1888')
  })

  it('finds a title the book sets in italic', () => {
    // The book's own text carries the tags too, so the haystack needs the same
    // treatment or every italicised title in it reads as never mentioned.
    const source = 'He quotes <i>The Secret Doctrine</i> at length.'
    expect(outsideClaims('Blavatsky published The Secret Doctrine.', source)).not.toContain(
      'Doctrine'
    )
  })

  it('does not read the word after a bold headword as a name', () => {
    // `<b>Aerolite.</b> A stony meteorite` puts the full stop against a `<`,
    // so the sentence never ends and the next capital is no longer
    // sentence-initial. A glossary is 126 headwords of exactly this shape.
    const claims = outsideClaims('<b>Aerolite.</b> Stony meteorite, seen falling.', '')
    expect(claims).not.toContain('Stony')
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

  it('saves after every chunk, so a tab that dies costs one request', async () => {
    // The failure this closes: the pass held every proposal in memory until the
    // last chunk came back, so a locked phone lost a book's worth of notes the
    // user had already been billed for.
    const blocks = Array.from({ length: 6 }, () =>
      block(`Paracelsus. ${'word '.repeat(200).trim()}`)
    )
    const saves: { chunksDone: number; notes: number }[] = []
    // A note on whichever block the chunk actually carries — a reply naming
    // someone else's block is dropped, which is the runner being right and
    // would make this measure nothing.
    const perChunk: Transport = async (url, init) => {
      const body = JSON.parse(String(init.body)) as { messages: { content: { text: string }[] }[] }
      // Not the overlap block at the head of the chunk: it is marked context
      // only, a note on it is dropped by design, and matching it would have
      // this test measure the runner refusing rather than the run growing.
      const id =
        /\[(p0b\d+)\](?! \[context only\])/.exec(body.messages[0]!.content[0]!.text)?.[1] ?? ''
      return replyWith([{ ...note, blockId: id }])(url, init)
    }
    await runAnnotation(blocks, {
      client: { ...CLIENT, transport: perChunk },
      voice: defaultVoice(),
      chunkWords: 200,
      onCheckpoint: ({ chunksDone, result }) => {
        saves.push({ chunksDone, notes: result.proposals.length })
      }
    })
    expect(saves.map((s) => s.chunksDone)).toEqual([1, 2, 3, 4, 5, 6])
    // Every write holds the whole run so far, not the chunk that just landed:
    // a checkpoint is what to carry on from, not a diff to replay.
    expect(saves.at(-1)!.notes).toBeGreaterThan(saves[0]!.notes)
  })

  it('leaves the last save saying how far a cancelled run got', async () => {
    const blocks = Array.from({ length: 6 }, () => block('word '.repeat(200).trim()))
    let calls = 0
    const saves: number[] = []
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
      isCancelled: () => calls >= 2,
      onCheckpoint: ({ chunksDone }) => {
        saves.push(chunksDone)
      }
    })
    expect(result.cancelled).toBe(true)
    // The cancel is checked before a chunk is sent, so the write after the last
    // completed one already says two — no extra save on the way out.
    expect(saves).toEqual([1, 2])
  })

  it('skips the chunks an earlier sitting paid for', async () => {
    const blocks = Array.from({ length: 6 }, () => block('word '.repeat(200).trim()))
    let calls = 0
    const saves: number[] = []
    await runAnnotation(blocks, {
      client: {
        ...CLIENT,
        transport: async (url, init) => {
          calls += 1
          return replyWith([])(url, init)
        }
      },
      voice: defaultVoice(),
      chunkWords: 200,
      alreadyRead: new Set([0, 1, 2, 3]),
      onCheckpoint: ({ chunksDone }) => {
        saves.push(chunksDone)
      }
    })
    // Two requests, not six — which is the whole of what resuming is for.
    expect(calls).toBe(2)
    expect(saves).toEqual([5, 6])
  })

  it('gives up when the same failure keeps coming back', async () => {
    // What a real book did: the account ran out of credit partway through, so
    // every remaining stretch answered with the same 400. The run fired one
    // doomed request per stretch and then reported the *book* as unreadable.
    const blocks = Array.from({ length: 12 }, () => block('word '.repeat(200).trim()))
    let calls = 0
    const transport: Transport = async (url, init) => {
      calls += 1
      if (calls <= 2) return replyWith([])(url, init)
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Your credit balance is too low' } })
      } as Response
    }
    const result = await runAnnotation(blocks, {
      client: { ...CLIENT, transport },
      voice: defaultVoice(),
      chunkWords: 200,
      sleep: async () => {}
    })
    expect(result.haltedBy).toContain('credit balance')
    // Two good stretches, three that failed alike, and then it stopped — rather
    // than nine more requests that could not have worked.
    expect(result.failures).toHaveLength(3)
    expect(calls).toBe(5)
  })

  it('does not give up on a book that fails intermittently', async () => {
    // A bad chunk is still a bad chunk. Only a failure that keeps repeating is
    // evidence about the account rather than about the stretch.
    const blocks = Array.from({ length: 8 }, () => block('word '.repeat(200).trim()))
    let calls = 0
    const transport: Transport = async (url, init) => {
      calls += 1
      if (calls % 2 === 0) {
        return { ok: false, status: 400, json: async () => ({}) } as Response
      }
      return replyWith([])(url, init)
    }
    const result = await runAnnotation(blocks, {
      client: { ...CLIENT, transport },
      voice: defaultVoice(),
      chunkWords: 200,
      sleep: async () => {}
    })
    expect(result.haltedBy).toBeNull()
    expect(calls).toBe(8)
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

  // The largest thing that was wrong with a briefing, and it was measurable.
  // Four accepted introductions run 46 to 67 names and figures per thousand
  // words; a draft written from a briefing of chapter *titles* came back at 7.
  // The analytical contents is where an old book keeps its names, and
  // `synopsis.ts` had already recovered it.
  it('gives the writer the analytical contents, not a list of titles', () => {
    const built = bookOfChapters()
    const described = {
      ...built,
      chapters: built.chapters.map((c, i) =>
        i === 1
          ? { ...c, synopsis: 'The celebrated Creery Experiments, and how Cazotte foretold it.' }
          : c
      )
    }
    const { user } = buildIntroductionPrompt(described, { voice: defaultVoice() })
    expect(user).toContain('Creery Experiments')
    expect(user).toContain('Cazotte')
    // Said to be the book's own words, because that is what makes them safe
    // to use under a rule that forbids inventing a name.
    expect(user).toContain("the book's own words about itself")
  })

  it('says nothing about descriptions when the contents had none', () => {
    const { user } = buildIntroductionPrompt(bookOfChapters(), { voice: defaultVoice() })
    expect(user).toContain('Its chapters, in order:')
    expect(user).not.toContain("the book's own words about itself")
  })

  it('samples across the whole book, not just its opening', () => {
    // The first pages of an old book are its least representative: that is
    // where the dedication and the throat-clearing live.
    const built = bookOfChapters()
    const samples = sampleBook(built, 3)
    expect(samples.length).toBeGreaterThan(1)
    expect(new Set(samples).size).toBe(samples.length)
  })

  it('does not put this edition’s glossary marks in the author’s mouth', () => {
    const marked = doc([block(`${long(1).trim()} the trolley-pole${GLOSSARY_MARK} again.`)])
    const [sample] = sampleBook(marked, 1)
    expect(sample).toBeDefined()
    expect(sample).not.toContain(GLOSSARY_MARK)
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

  // The register is the one thing a card cannot state. Every rule in `about`,
  // `guidance` and `avoid` describes how the editor sounds; only a passage of
  // his own prose *is* how he sounds. The field held it, banked it and carried
  // it between books, and `voiceBlock` never emitted it, so nothing this app
  // ever wrote had seen a line of him.
  it('shows the editor his own prose before asking for more of it', () => {
    const voice: EditorVoice = {
      ...defaultVoice(),
      proseSamples: ['Set from the 1895 Theosophical Publishing Society edition.']
    }
    const { system } = buildIntroductionPrompt(bookOfChapters(), { voice })
    expect(system).toContain('1895 Theosophical Publishing Society')
  })

  it('asks for the register and not the subject', () => {
    const voice: EditorVoice = { ...defaultVoice(), proseSamples: ['A passage of his.'] }
    const { system } = buildIntroductionPrompt(bookOfChapters(), { voice })
    expect(system).toContain('Do not match its subject')
  })

  it('says nothing at all when the editor has published nothing yet', () => {
    const { system } = buildIntroductionPrompt(bookOfChapters(), { voice: defaultVoice() })
    expect(system).not.toContain('PROSE THIS EDITOR')
  })

  // The other half of the same distinction. A page of introduction in the
  // cached half of the annotation prompt would teach a forty-word note
  // nothing and be paid for on every chunk of every book.
  it('keeps the front matter out of the notes prompt', () => {
    const voice: EditorVoice = {
      ...defaultVoice(),
      proseSamples: ['Set from the 1895 Theosophical Publishing Society edition.']
    }
    expect(voiceBlock(voice)).not.toContain('1895 Theosophical')
  })

  it('keeps the newest few, and never the same passage twice', () => {
    let voice = defaultVoice()
    for (let i = 0; i < MAX_PROSE_SAMPLES + 2; i++) {
      voice = withProseSample(voice, `Introduction number ${i}.`)
    }
    expect(voice.proseSamples).toHaveLength(MAX_PROSE_SAMPLES)
    expect(voice.proseSamples.at(-1)).toContain(`number ${MAX_PROSE_SAMPLES + 1}`)
    expect(voice.proseSamples[0]).not.toContain('number 0')

    const before = voice.proseSamples.length
    const oldest = voice.proseSamples[0]!
    voice = withProseSample(voice, oldest)
    expect(voice.proseSamples).toHaveLength(before)
    expect(voice.proseSamples.at(-1)).toBe(oldest)
    expect(voice.proseSamples.filter((s) => s === oldest)).toHaveLength(1)
  })

  it('shows only the newest few, however many the file carries', () => {
    const many = Array.from({ length: MAX_PROSE_SAMPLES + 3 }, (_, i) => `Passage ${i}.`)
    const card = proseBlock({ ...defaultVoice(), proseSamples: many })
    expect(card).not.toContain('Passage 0.')
    expect(card).toContain(`Passage ${MAX_PROSE_SAMPLES + 2}.`)
  })

  it('prints no empty passage line for a note banked without one', () => {
    const voice = withExemplar(defaultVoice(), { passage: '', note: 'A note of his.' })
    const card = voiceBlock(voice)
    expect(card).toContain('Note: A note of his.')
    expect(card).not.toContain('Passage:')
  })

  // The shape is settled before there are twelve hundred words of it, because
  // a finished introduction is very hard to argue with and an outline costs a
  // line to change.
  it('asks for the shape before the prose, and refuses to be given prose', () => {
    const task = introductionOutlineTask('standard')
    expect(task).toContain('Do not write the introduction yet')
    expect(task).toContain('THE OPENING')
    expect(task).toContain('WHAT IS LEFT OUT')
    expect(task).toContain('QUERIES')
    // An outline in finished sentences is a draft in disguise: it gets
    // approved on how it sounds, which is the judgement being deferred.
    expect(task).toContain('Write the outline as notes')
  })

  it('sizes the outline to the length the editor chose', () => {
    expect(introductionOutlineTask('brief')).toContain('350 words')
    expect(introductionOutlineTask('full')).toContain('1400 words')
  })

  it('writes to the shape the editor approved, not the one it proposed', () => {
    const approved = 'Open on the blacksmith. Three movements. Close on the note on the text.'
    const { system } = buildIntroductionPrompt(bookOfChapters(), {
      voice: defaultVoice(),
      outline: approved
    })
    expect(system).toContain(approved)
    expect(system).toContain('do not redesign it')
    // A movement the material will not carry is reported, never quietly
    // filled and never quietly dropped — the footnote rule, applied to shape.
    expect(system).toContain('quietly filling it')
  })

  it('still drafts in one shot when no shape was approved', () => {
    const { system } = buildIntroductionPrompt(bookOfChapters(), { voice: defaultVoice() })
    expect(system).not.toContain('HAS APPROVED THIS SHAPE')
    expect(system).toContain('WHAT AN INTRODUCTION HAS TO DO')
  })

  // The writer was being asked to tell the reader what the apparatus is and
  // given none of it, so the first outline that came back asked under QUERIES
  // whether there was a glossary and how many notes there were. All of it is
  // sitting in the assembled document.
  describe('what this edition carries', () => {
    function withApparatus(): BookDocument {
      const built = bookOfChapters()
      return {
        ...built,
        footnotes: [
          { id: 'n1', originalMarker: '1', text: 'A note.', pageIndex: 0, orphaned: false },
          { id: 'n2', originalMarker: '2', text: 'Another.', pageIndex: 1, orphaned: false }
        ],
        sections: [
          {
            id: 's1',
            placement: 'back',
            title: 'Glossary',
            blocks: [
              { ...block('This glossary explains the vocabulary.'), strong: [] },
              { ...block('Akasha. The subtlest of the elements.'), strong: [0] },
              { ...block('Fohat. The energy that builds.'), strong: [0] }
            ]
          }
        ]
      }
    }

    it('counts the notes and the glossary entries rather than trusting a memory', () => {
      const lines = apparatusOf(withApparatus())
      expect(lines.join('\n')).toContain('2 footnotes')
      // An entry is a block whose bold starts at word 0. The preamble has no
      // bold and must not be counted as one.
      expect(lines.join('\n')).toContain('glossary of 2 entries')
    })

    it('says the apparatus is absent rather than leaving the writer to guess', () => {
      const lines = apparatusOf(bookOfChapters()).join('\n')
      expect(lines).toContain('No footnotes.')
      expect(lines).toContain('No glossary.')
    })

    it('counts the glossary marks in the running text', () => {
      const marked = { ...bookOfChapters() }
      marked.blocks = [block(`A trolley-pole${GLOSSARY_MARK} and an aura${GLOSSARY_MARK}.`)]
      expect(apparatusOf(marked).join('\n')).toContain('2 words in the running text')
    })

    // The failure this is against is already on the shelf: one volume carried
    // 85 marks and 23 notes, the next a 74-entry glossary with no marks at all,
    // and nothing anywhere said so.
    it('reports a glossary whose words were never marked', () => {
      const unmarked = withApparatus()
      expect(apparatusOf(unmarked).join('\n')).toContain('No glossary marks in the text.')
    })
  })

  // The three names were enough while a piece was drafted from a dial. The
  // first real approved outline asked for 1,800 to 2,200 words and the prompt
  // printed "aim for about 1400 words" three lines under it, which is a worse
  // instruction than either number alone.
  it('takes a word count as readily as one of its three sizes', () => {
    expect(introductionWords('full')).toBe(1400)
    expect(introductionWords(2200)).toBe(2200)
    const { system } = buildIntroductionPrompt(bookOfChapters(), {
      voice: defaultVoice(),
      length: 2200
    })
    expect(system).toContain('2200 words')
    expect(system).not.toContain('1400 words')
  })

  it('floors a nonsense length rather than refusing to render a briefing', () => {
    expect(introductionWords(-50)).toBe(100)
  })

  it('says which number wins when a shape has been approved', () => {
    const { system } = buildIntroductionPrompt(bookOfChapters(), {
      voice: defaultVoice(),
      outline: 'Three movements. Target 2,000 words.'
    })
    expect(system).toContain('including over any word count given below')
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

/**
 * The step the pass hangs off. It sits after the proof step because a note
 * written against a misread word wastes both the note and the money, and before
 * the design gate because notes change how many pages the book runs to.
 */
describe('the annotate step in the wizard', () => {
  const ready = (): WizardState => ({
    ...initialState(),
    document: doc([block('The chirurgeon examined the specimen.')]),
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

  it('falls between reading it through and designing it', () => {
    const order = STEPS.map((s) => s.id)
    expect(order.indexOf('annotate')).toBeGreaterThan(order.indexOf('proof'))
    expect(order.indexOf('annotate')).toBeLessThan(order.indexOf('design'))
  })

  it('cannot be entered before the book has been proofed', () => {
    const step = stepById('annotate')
    expect(step.canEnter(initialState())).toBe(false)
    expect(step.canEnter(ready())).toBe(true)
  })

  it('offers a plain reprint, so nobody pays for a pass to decline it', () => {
    const qs = stepById('annotate').questions(ready())
    const valuesOf = (id: string): string[] => {
      const q = qs.find((x) => x.id === id)
      return q && 'options' in q ? q.options.map((o) => String(o.value)) : []
    }
    expect(valuesOf('annotateBook')).toContain('no')
    expect(valuesOf('writeIntroduction')).toContain('none')
  })

  it('arrives prefilled from the banked voice, so book two asks less', () => {
    const state: WizardState = {
      ...ready(),
      voice: { ...defaultVoice(), penName: 'Etsu T. Dhent', density: 'generous' }
    }
    const qs = stepById('annotate').questions(state)
    // Narrowed off the union rather than reached through it: a term grid has no
    // default, and the compiler is right to say so.
    const defaultOf = (id: string): unknown => {
      const q = qs.find((x) => x.id === id)
      return q && 'defaultValue' in q ? q.defaultValue : undefined
    }
    expect(defaultOf('penName')).toBe('Etsu T. Dhent')
    expect(defaultOf('noteDensity')).toBe('generous')
  })
})
