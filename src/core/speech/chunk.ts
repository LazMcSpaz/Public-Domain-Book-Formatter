/**
 * How much of a paragraph the voice is given at once.
 *
 * ## Why this exists
 *
 * The model reads what it is handed and nothing else: given one sentence it has
 * no idea what preceded it, so every sentence starts from a standing start and
 * the joins between them are where a reading stops sounding like a person.
 * Measured on chapter one of *The Human Aura*: 16 paragraphs, **55 sentences**,
 * so 55 fresh starts in thirteen minutes. Packed to the model's own limit that
 * falls to roughly half, and six of those paragraphs are read whole, in one
 * breath, with the pauses inside them chosen by the model rather than by a
 * constant in this file.
 *
 * ## Why there is a limit at all, and why it is not the model's
 *
 * Kokoro takes 510 phoneme tokens per pass and its tokenizer is built with
 * `truncation: true` — so a stretch over the limit is **silently cut**, with no
 * error and no gap a listener could notice. That is the failure this whole
 * module set is arranged against, so the budget here sits below 510 rather than
 * at it. The headroom is deliberate: the cost of a chunk is measured with the
 * phonemizer directly, while the model normalises the text first ("Dr." becomes
 * "Doctor"), so the two counts are close but not equal, and the direction of
 * the difference is not knowable in advance.
 *
 * A sentence that cannot fit even alone is **reported**, never quietly handed
 * over to be truncated.
 *
 * Pure.
 */

/** Kokoro's own ceiling, in phoneme tokens. */
export const MODEL_LIMIT = 510

/**
 * What a chunk is allowed to cost, leaving room for the model's own
 * normalisation to disagree with our measurement.
 */
export const CHUNK_BUDGET = 460

/** One sentence and what it costs in phonemes. */
export interface Measured {
  text: string
  cost: number
}

export interface Packed {
  /** Sentences joined, to be spoken in one pass. */
  chunks: string[]
  /** Sentences that will be truncated however they are packed. Never dropped. */
  tooLong: Measured[]
}

/**
 * Sentences packed into as few passes as the budget allows, in order.
 *
 * Greedy rather than optimal on purpose: the order of a book's sentences is not
 * ours to change, so the only choice is where to break, and a greedy pass makes
 * the same breaks a person would. An over-long sentence is emitted as its own
 * chunk *and* reported — leaving it out would be a hole in the reading, and
 * silently packing it with others would make the truncation worse.
 */
export function packSentences(sentences: readonly Measured[], budget = CHUNK_BUDGET): Packed {
  const chunks: string[] = []
  const tooLong: Measured[] = []
  let current: string[] = []
  let cost = 0

  const flush = () => {
    if (current.length > 0) chunks.push(current.join(' '))
    current = []
    cost = 0
  }

  for (const sentence of sentences) {
    const text = sentence.text.trim()
    if (text.length === 0) continue
    if (sentence.cost > budget) {
      flush()
      chunks.push(text)
      tooLong.push({ text, cost: sentence.cost })
      continue
    }
    if (cost + sentence.cost > budget) flush()
    current.push(text)
    cost += sentence.cost
  }
  flush()
  return { chunks, tooLong }
}
