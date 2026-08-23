/**
 * Handing a book to readers who each see one chapter of it.
 *
 * A three-hundred-page book will not fit in one context, and it should not:
 * the failure this whole pass has to avoid is a reader who has absorbed an
 * author's cadence so thoroughly that it can write him. The vision pass was
 * safe because it saw one leaf at a time and could not drift, because it could
 * not see far. Chunking rebuilds that property on purpose.
 *
 * A **chapter** is the unit rather than a fixed word count, because coherence
 * is what is being tested and a chapter is a thing that coheres. A run of
 * paragraphs cut at four thousand words has no beginning and no end, and a
 * reader asked whether it hangs together has been given an unfair question.
 *
 * Pure: no DOM, no I/O.
 */
import type { BookDocument } from '@core/assemble'

export interface SenseChunk {
  /** The chapter this is, for the reader's own orientation. */
  title: string
  /** Its number as the book prints it, where it prints one. */
  label: string | null
  /** Every block of the chapter, with the ids a finding must name. */
  blocks: { id: string; kind: string; text: string }[]
  /** Running words, so a caller can pace batches without re-counting. */
  words: number
}

export interface SenseChunking {
  chunks: SenseChunk[]
  /**
   * Names and terms the book has already established, for every reader.
   *
   * Without it each reader meets "Panchadasi", "akasha" and "Cazotte" cold and
   * files them as incoherent — which is the commonest way a sense pass drowns
   * in false findings on a book of this kind. The register is drawn from the
   * book's *own* text, so it costs nothing and cannot introduce a term the book
   * does not use.
   */
  register: string[]
}

/** How often a capitalised word must appear before it counts as established. */
const ESTABLISHED = 3

/** Too short to be worth registering, and too likely to be an ordinary word. */
const MIN_TERM = 4

const WORD = /[\p{L}][\p{L}'’-]*/gu

function wordCount(text: string): number {
  return text.split(/\s+/u).filter((w) => w.length > 0).length
}

/**
 * The vocabulary the book has taught itself.
 *
 * Capitalised words that recur, plus the italicised ones, which in a book of
 * this period are nearly always the foreign terms a reader most needs warning
 * about. Sentence-initial capitals are not excluded here — unlike the
 * consistency check, a few ordinary words in the register cost nothing, while a
 * missing name costs a false finding.
 */
function registerOf(doc: BookDocument): string[] {
  const counts = new Map<string, number>()
  const bump = (word: string): void => {
    if (word.length < MIN_TERM) return
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  for (const block of doc.blocks) {
    const bare = block.text.replace(/<[^>]*>/gu, '')
    const words = [...bare.matchAll(WORD)].map((m) => m[0])
    for (const word of words) {
      if (/^\p{Lu}/u.test(word) && word !== word.toLocaleUpperCase()) bump(word)
    }
    for (const index of block.emphasis ?? []) {
      const word = words[index]
      if (word) bump(word)
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= ESTABLISHED)
    .map(([word]) => word)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * The book, one chapter to a chunk.
 *
 * Blocks before the first chapter — a preface the book itself printed — become
 * a chunk of their own rather than being dropped, because a preface is prose
 * like any other and the errors in it print like any other.
 *
 * The editor's own written sections are deliberately **not** included. They
 * were written in this century, they have no scan behind them, and a finding
 * against one could never be adjudicated against a crop. They get the prose
 * audit instead.
 */
export function chunkForSense(doc: BookDocument): SenseChunking {
  const starts = [...doc.chapters].sort((a, b) => a.blockIndex - b.blockIndex)
  const chunks: SenseChunk[] = []

  const take = (from: number, to: number, title: string, label: string | null): void => {
    const blocks = doc.blocks.slice(from, to).map((b) => ({
      id: b.id,
      kind: b.kind,
      text: b.text
    }))
    if (blocks.length === 0) return
    chunks.push({
      title,
      label,
      blocks,
      words: blocks.reduce((n, b) => n + wordCount(b.text), 0)
    })
  }

  const first = starts[0]?.blockIndex ?? doc.blocks.length
  if (first > 0) take(0, first, 'Front matter the book printed', null)

  starts.forEach((chapter, i) => {
    const end = starts[i + 1]?.blockIndex ?? doc.blocks.length
    take(chapter.blockIndex, end, chapter.title, chapter.label ?? null)
  })

  return { chunks, register: registerOf(doc) }
}
