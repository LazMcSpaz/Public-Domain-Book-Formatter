/**
 * How much of a paragraph the voice is given at once.
 *
 * The model reads what it is handed and nothing else, so every break between
 * chunks is a standing start. Measured on chapter one of *The Human Aura*: 16
 * paragraphs, 55 sentences, and only 6 paragraphs short enough to be read whole.
 */
import { describe, expect, it } from 'vitest'
import { CHUNK_BUDGET, MODEL_LIMIT, packSentences, type Measured } from '@core/speech'

const of = (...costs: number[]): Measured[] => costs.map((cost, i) => ({ text: `S${i + 1}`, cost }))

describe('packSentences', () => {
  it('fills a chunk before starting another', () => {
    const { chunks } = packSentences(of(100, 100, 100), 250)
    expect(chunks).toEqual(['S1 S2', 'S3'])
  })

  it('reads a whole paragraph in one breath when it fits', () => {
    const { chunks } = packSentences(of(100, 100, 100), 400)
    expect(chunks).toEqual(['S1 S2 S3'])
  })

  it('keeps the book in its own order', () => {
    // The only choice here is where to break. Reordering to pack tighter would
    // be a different book.
    const { chunks } = packSentences(of(300, 50, 300), 400)
    expect(chunks).toEqual(['S1 S2', 'S3'])
  })

  it('reports a sentence that will be truncated however it is packed', () => {
    // The failure this exists for: the tokenizer truncates at the model's limit
    // with no error, so an over-long sentence loses its tail into a book nobody
    // is going to re-read.
    const { chunks, tooLong } = packSentences(of(100, 900, 100), 460)
    expect(tooLong.map((s) => s.cost)).toEqual([900])
    expect(chunks).toEqual(['S1', 'S2', 'S3'])
  })

  it('says nothing about a book with nothing over the limit', () => {
    expect(packSentences(of(100, 100), 460).tooLong).toEqual([])
  })

  it('drops nothing and invents nothing', () => {
    const sentences = of(200, 200, 200, 900, 50)
    const { chunks } = packSentences(sentences, 460)
    expect(chunks.join(' ').split(' ').sort()).toEqual(sentences.map((s) => s.text).sort())
  })

  it('leaves the model headroom rather than sitting on its limit', () => {
    // Measured with the phonemizer, but the model normalises the text first, so
    // the two counts are close and not equal — and the direction is unknowable.
    expect(CHUNK_BUDGET).toBeLessThan(MODEL_LIMIT)
  })

  it('ignores empty sentences without counting them as content', () => {
    const { chunks } = packSentences(
      [
        { text: '   ', cost: 0 },
        { text: 'S1', cost: 10 }
      ],
      460
    )
    expect(chunks).toEqual(['S1'])
  })
})
