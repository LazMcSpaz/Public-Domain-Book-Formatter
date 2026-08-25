/**
 * The contract for one page of the vision pass.
 *
 * The model is shown the page image *and* the OCR text, and returns this shape.
 * Structured output (schema-enforced) rather than prose, so there is no parsing
 * guesswork and a malformed reply is a validation error rather than a silent
 * corruption of the book.
 *
 * Pure: types, the JSON schema, and a strict parser. No I/O, no client.
 */
import { ALL_PAGE_ROLES, type PageRole } from '@core/pages'
import { parseInlineMarkup } from './markup'

/** Structural role of a run of text within the page. */
export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'verse'
  | 'epigraph'
  | 'caption'
  | 'footnote'
  | 'list-item'
  | 'table'

export interface TranscribedBlock {
  kind: BlockKind
  /**
   * The block as running text.
   *
   * For a `table` this is the flattened view — rows on their own lines, cells
   * separated by ` | ` — and it is *derived from* `cells`, never the other way
   * about. Everything that treats a page as prose reads this: the word-count
   * cross-check against OCR, the seam checks, the proof editor. Keeping one
   * canonical structure and one derived view is what stops the two disagreeing
   * about what the page says.
   */
  text: string
  /**
   * The rows of a `table`, each an array of cells. Never set on anything else.
   *
   * Present on every table after parsing: a reply that names a table without
   * giving its cells has them recovered from the text, because a table whose
   * columns were lost still has its lines, and printing those beats printing
   * the numbers run together into a paragraph.
   */
  cells?: string[][]
  /**
   * True when the table's first row is its column heads rather than data.
   *
   * A heads row is set apart — italic, with a rule under it — which is the
   * whole visual difference between a table and a grid of numbers. The model
   * can see the printed rule, so this is read off the page rather than guessed
   * from the first row's contents.
   */
  headerRow?: boolean
  /**
   * Indices of whitespace-separated words to set in italic.
   *
   * Recovered from the inline markup the model emits — see `markup.ts`. Absent
   * on a block with no emphasis, which is nearly all of them.
   */
  emphasis?: number[]
  /**
   * Indices of whitespace-separated words to set strong.
   *
   * Same convention as `emphasis` and recovered the same way, from `<b>` in the
   * inline markup. What "strong" prints as is the layout engine's decision: a
   * real bold where the book's face has one, italic where it has none, and
   * never a bold smeared out of the regular outlines.
   */
  strong?: number[]
  /** Heading level 1–6, only meaningful when `kind` is 'heading'. */
  level?: number
  /**
   * For `footnote` blocks: the marker tying this note to its in-text reference
   * (e.g. "1", "*", "†"), so the note can be re-linked at typeset time.
   */
  marker?: string
  /**
   * True when this block continues a paragraph begun on the previous page.
   * Drives seam repair — books don't respect page boundaries.
   */
  continuesPrevious?: boolean
  /** True when the paragraph runs on past the end of this page. */
  continuesNext?: boolean
}

/**
 * A span the model could not read confidently. Surfacing an honest "I couldn't
 * read this, here are the candidates" is far more useful than a confident wrong
 * word, because it lands in review with the pixels beside it instead of
 * silently corrupting the text.
 */
export interface UncertainSpan {
  /** The text as transcribed (best guess). */
  text: string
  /** Other plausible readings, best first. */
  alternatives: string[]
  /** Why it was uncertain, in plain language. */
  reason: string
}

/**
 * A decision that belongs to the editor, raised rather than taken.
 *
 * Not the same thing as an `UncertainSpan`, and the difference is the whole
 * point: uncertainty means *nobody could read it*, while a query means **it was
 * read perfectly well and what it says needs a person to rule on**.
 *
 * The case this exists for: a 1916 leaf prints `belleves`. Not OCR noise — at
 * 600 DPI both strokes are ascender height, against the x-height dotless `i` of
 * `skeptical` in the same line. The compositor set it wrong. Whether a reprint
 * keeps a compositor's error, silently fixes it, or notes it is the editor's
 * call and nobody else's, so the transcription carries the page as printed and
 * the query carries the question.
 *
 * **There is deliberately no field for a proposed fix.** A reader who has been
 * allowed to suggest one has been allowed to decide, because a suggestion sat
 * beside a question is an answer in all but name. `quote` is what the paper
 * says and `why` is why it is worth a ruling; the ruling is not this reader's
 * to make.
 */
export interface EditorialQuery {
  /**
   * The words as printed, exactly as they appear in the transcription.
   *
   * A quotation and not an offset, for the reason the notes pass quotes too: an
   * offset is a number nobody can check and one that goes stale the moment a
   * correction changes the text by a letter.
   */
  quote: string
  /** Why this needs a person. The argument, never the answer. */
  why: string
  kind: EditorialQueryKind
}

/**
 * What kind of decision is being asked for.
 *
 * A closed list, and short. Each is a case where "faithful to the original" and
 * "correct" genuinely disagree — which is the only reason to interrupt an
 * editor at all.
 */
export type EditorialQueryKind =
  /** The compositor set it wrong, and the page is unambiguous about it. */
  | 'printers-error'
  /** The book contradicts itself, and both readings are clear. */
  | 'inconsistent'
  /** Legible, but what it means for the edition is not obvious. */
  | 'unclear'

export const EDITORIAL_QUERY_KINDS: readonly EditorialQueryKind[] = [
  'printers-error',
  'inconsistent',
  'unclear'
]

/** Text that is page furniture, not content — stripped from the body flow. */
export interface PageFurniture {
  runningHead?: string
  folio?: string
}

/** Bibliographic fields read off front matter (title page, imprint). */
export interface ExtractedMetadata {
  title?: string
  subtitle?: string
  author?: string
  originalYear?: string
  originalPublisher?: string
  originalPlace?: string
  contributors?: string[]
}

/** The model's full reply for one page. */
export interface PageTranscription {
  pageIndex: number
  role: PageRole
  blocks: TranscribedBlock[]
  uncertain: UncertainSpan[]
  furniture: PageFurniture
  /**
   * Decisions raised for the editor, never taken. Absent on nearly every leaf.
   */
  queries?: EditorialQuery[]
  /** Present only for front-matter pages. */
  metadata?: ExtractedMetadata
}

const PAGE_ROLES: readonly PageRole[] = ALL_PAGE_ROLES

/**
 * Every block kind, as data.
 *
 * Exported because the JSON schema is no longer the only thing that has to
 * know: a correction read back from storage names a kind, and validating it
 * against a second hand-written list is how the two drift apart.
 */
export const BLOCK_KINDS: readonly BlockKind[] = [
  'paragraph',
  'heading',
  'blockquote',
  'verse',
  'epigraph',
  'caption',
  'footnote',
  'list-item',
  'table'
]

/**
 * The separator between cells in a table's flattened text.
 *
 * A pipe rather than a tab because the flattened text is what the proof step
 * puts in a textarea for the user to correct, and a tab there moves focus
 * instead of typing. A pipe is visible, typeable, and already what anyone who
 * has written a table in plain text reaches for.
 */
export const CELL_SEPARATOR = ' | '

/** A table's rows as running text: rows on lines, cells separated by a pipe. */
export function tableToText(cells: readonly (readonly string[])[]): string {
  return cells.map((row) => row.join(CELL_SEPARATOR)).join('\n')
}

/**
 * Recover a table's rows from its flattened text.
 *
 * The inverse of `tableToText`, and the reason a table can be corrected in the
 * proof step with an ordinary textarea: the user edits the text, and the
 * columns come back. A row with no pipe in it is a single wide cell, which is
 * what a caption or a spanning heading inside a table actually is.
 */
export function parseTableText(text: string): string[][] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split('|').map((cell) => cell.trim()))
}

/**
 * Strip any inline markup from a block, keeping what it meant.
 *
 * The same conversion `parsePageTranscription` does, applied to a block that
 * arrived some other way — a transcription restored from storage that was
 * saved before this existed, or a correction typed with a tag in it. Idempotent:
 * text with no tags comes back untouched and keeps whatever emphasis it had.
 */
export function normalizeMarkup<T extends TranscribedBlock>(block: T): T {
  if (!block.text.includes('<')) return block
  const markup = parseInlineMarkup(block.text)
  if (markup.text === block.text) return block
  return {
    ...block,
    text: markup.text,
    ...(markup.emphasis.length > 0 ? { emphasis: markup.emphasis } : {}),
    ...(markup.strong.length > 0 ? { strong: markup.strong } : {})
  }
}

/**
 * Put a block's table structure and its text beyond disagreement.
 *
 * Called on every block that claims to be a table, wherever one can enter the
 * book — the model's reply, and a correction typed at the proof step. `cells`
 * wins where it exists and the text is regenerated from it; where it does not,
 * the text is parsed for it. Either way both come out of here consistent, so
 * nothing downstream has to decide which to believe.
 */
export function normalizeTable<T extends TranscribedBlock>(block: T): T {
  if (block.kind !== 'table') {
    // A block retyped away from a table keeps no rows behind it.
    if (block.cells === undefined && block.headerRow === undefined) return block
    const { cells: _cells, headerRow: _headerRow, ...rest } = block
    // Removing two optional properties leaves the same block; the cast says so,
    // because `Omit` cannot express that to a generic parameter.
    return rest as T
  }
  const cells = (block.cells ?? parseTableText(block.text))
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0))
  return { ...block, cells, text: tableToText(cells) }
}

/**
 * JSON Schema handed to the API so replies are shape-guaranteed.
 * `additionalProperties: false` everywhere — a field we didn't ask for is a
 * signal the prompt and schema have drifted apart.
 */
export const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: [...PAGE_ROLES] },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...BLOCK_KINDS] },
          text: { type: 'string' },
          cells: {
            type: 'array',
            items: { type: 'array', items: { type: 'string' } }
          },
          headerRow: { type: 'boolean' },
          level: { type: 'integer' },
          marker: { type: 'string' },
          continuesPrevious: { type: 'boolean' },
          continuesNext: { type: 'boolean' }
        },
        required: ['kind', 'text'],
        additionalProperties: false
      }
    },
    uncertain: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          alternatives: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' }
        },
        required: ['text', 'alternatives', 'reason'],
        additionalProperties: false
      }
    },
    furniture: {
      type: 'object',
      properties: {
        runningHead: { type: 'string' },
        folio: { type: 'string' }
      },
      required: [],
      additionalProperties: false
    },
    metadata: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string' },
        author: { type: 'string' },
        originalYear: { type: 'string' },
        originalPublisher: { type: 'string' },
        originalPlace: { type: 'string' },
        contributors: { type: 'array', items: { type: 'string' } }
      },
      required: [],
      additionalProperties: false
    }
  },
  required: ['role', 'blocks', 'uncertain', 'furniture'],
  additionalProperties: false
} as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validate and normalize a raw reply. Throws on anything structurally wrong —
 * a bad page should fail loudly and be retried, never be quietly half-imported.
 */
/**
 * Fields a page may carry. Anything else is refused.
 *
 * The parser used to build a fresh object from the fields it knew and drop the
 * rest without a word, which made silence the failure mode for exactly the
 * thing that must never be silent: an editorial query attached to a leaf was
 * discarded, and the report came back green. A reader doing the right thing got
 * no record and no error.
 *
 * `words` and `structural` are on the list because `draft` writes them — see
 * `carriesDraftNotes`, which is how a batch that was never corrected is
 * noticed rather than refused.
 */
const PAGE_FIELDS = new Set([
  'pageIndex',
  'role',
  'blocks',
  'uncertain',
  'furniture',
  'queries',
  'metadata',
  'words',
  'structural'
])

const BLOCK_FIELDS = new Set([
  'kind',
  'text',
  'cells',
  'headerRow',
  'emphasis',
  'strong',
  'level',
  'marker',
  'continuesPrevious',
  'continuesNext'
])

function refuseUnknown(raw: Record<string, unknown>, allowed: ReadonlySet<string>, where: string) {
  const unknown = Object.keys(raw).filter((k) => !allowed.has(k))
  if (unknown.length > 0) {
    throw new Error(
      `${where}: ${unknown.map((k) => `"${k}"`).join(', ')} ` +
        `${unknown.length === 1 ? 'is not a field' : 'are not fields'} this schema has. ` +
        'Refused rather than dropped, because a field silently discarded is how ' +
        'an editorial query disappears with a green report beside it.'
    )
  }
}

/**
 * Whether a page still carries the annotations `draft` put on it.
 *
 * A draft is the left-hand column of a transcription, not a transcription, and
 * `structural` is the list of everything it guessed. A batch arriving with that
 * list still attached has very likely not been checked against the render —
 * which is not refusable, because a reader may have checked it and left the
 * list alone, but is worth saying out loud.
 */
export function carriesDraftNotes(raw: unknown): boolean {
  return isRecord(raw) && (Array.isArray(raw['structural']) || typeof raw['words'] === 'number')
}

export function parsePageTranscription(raw: unknown, pageIndex: number): PageTranscription {
  if (!isRecord(raw)) throw new Error(`Page ${pageIndex + 1}: reply was not an object`)
  refuseUnknown(raw, PAGE_FIELDS, `Page ${pageIndex + 1}`)

  const role = raw['role']
  if (typeof role !== 'string' || !PAGE_ROLES.includes(role as PageRole)) {
    throw new Error(`Page ${pageIndex + 1}: unknown page role ${JSON.stringify(role)}`)
  }

  const rawBlocks = raw['blocks']
  if (!Array.isArray(rawBlocks)) throw new Error(`Page ${pageIndex + 1}: blocks missing`)

  const blocks: TranscribedBlock[] = rawBlocks.map((b, i) => {
    if (!isRecord(b)) throw new Error(`Page ${pageIndex + 1}: block ${i} is not an object`)
    refuseUnknown(b, BLOCK_FIELDS, `Page ${pageIndex + 1}, block ${i}`)
    const kind = b['kind']
    const text = b['text']
    if (typeof kind !== 'string' || !BLOCK_KINDS.includes(kind as BlockKind)) {
      throw new Error(`Page ${pageIndex + 1}: block ${i} has unknown kind ${JSON.stringify(kind)}`)
    }
    if (typeof text !== 'string') {
      throw new Error(`Page ${pageIndex + 1}: block ${i} has no text`)
    }
    // The model emits `<em>`, `<i>` and `<sup>` although nothing asked it to,
    // because the original prints those words in italic and the schema gave it
    // no field to say so. Read the tags, keep what they meant, remove them —
    // left in, they are drawn verbatim and the book prints angle brackets.
    const markup = parseInlineMarkup(text)
    const block: TranscribedBlock = { kind: kind as BlockKind, text: markup.text }
    if (markup.emphasis.length > 0) block.emphasis = markup.emphasis
    if (markup.strong.length > 0) block.strong = markup.strong
    const level = b['level']
    if (typeof level === 'number' && Number.isFinite(level)) {
      block.level = Math.min(6, Math.max(1, Math.round(level)))
    }
    if (typeof b['marker'] === 'string') block.marker = b['marker']
    if (b['continuesPrevious'] === true) block.continuesPrevious = true
    if (b['continuesNext'] === true) block.continuesNext = true
    const rawCells = b['cells']
    if (Array.isArray(rawCells)) {
      block.cells = rawCells
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.map((cell) => (typeof cell === 'string' ? cell : '')))
    }
    if (b['headerRow'] === true) block.headerRow = true
    return normalizeTable(block)
  })

  const rawUncertain = Array.isArray(raw['uncertain']) ? raw['uncertain'] : []
  const uncertain: UncertainSpan[] = rawUncertain.filter(isRecord).map((u) => ({
    text: typeof u['text'] === 'string' ? u['text'] : '',
    alternatives: Array.isArray(u['alternatives'])
      ? u['alternatives'].filter((a): a is string => typeof a === 'string')
      : [],
    reason: typeof u['reason'] === 'string' ? u['reason'] : 'unspecified'
  }))

  // Strict, and throwing rather than dropping. A query exists to interrupt a
  // person; one that is half-understood is worse than none, because it will be
  // read as the whole of what was noticed.
  const rawQueries = Array.isArray(raw['queries']) ? raw['queries'] : []
  const queries: EditorialQuery[] = rawQueries.map((q, i) => {
    const where = `Page ${pageIndex + 1}, query ${i + 1}`
    if (!isRecord(q)) throw new Error(`${where}: not an object`)
    refuseUnknown(q, new Set(['quote', 'why', 'kind']), where)
    const quote = typeof q['quote'] === 'string' ? q['quote'].trim() : ''
    if (!quote) throw new Error(`${where}: no quote — a query must say which words`)
    const why = typeof q['why'] === 'string' ? q['why'].trim() : ''
    if (!why) throw new Error(`${where}: no reason given`)
    const kind = q['kind'] as EditorialQueryKind
    if (!EDITORIAL_QUERY_KINDS.includes(kind)) {
      throw new Error(
        `${where}: "${String(q['kind'] ?? '')}" is not a kind of query. ` +
          `One of ${EDITORIAL_QUERY_KINDS.join(', ')}.`
      )
    }
    return { quote, why, kind }
  })

  const rawFurniture = isRecord(raw['furniture']) ? raw['furniture'] : {}
  const furniture: PageFurniture = {}
  if (typeof rawFurniture['runningHead'] === 'string') {
    furniture.runningHead = rawFurniture['runningHead']
  }
  if (typeof rawFurniture['folio'] === 'string') furniture.folio = rawFurniture['folio']

  const result: PageTranscription = {
    pageIndex,
    role: role as PageRole,
    blocks,
    uncertain,
    furniture,
    ...(queries.length > 0 ? { queries } : {})
  }

  const rawMeta = raw['metadata']
  if (isRecord(rawMeta)) {
    const metadata: ExtractedMetadata = {}
    for (const key of [
      'title',
      'subtitle',
      'author',
      'originalYear',
      'originalPublisher',
      'originalPlace'
    ] as const) {
      const v = rawMeta[key]
      if (typeof v === 'string' && v.trim()) metadata[key] = v.trim()
    }
    if (Array.isArray(rawMeta['contributors'])) {
      metadata.contributors = rawMeta['contributors'].filter(
        (c): c is string => typeof c === 'string'
      )
    }
    if (Object.keys(metadata).length > 0) result.metadata = metadata
  }

  return result
}

/** Plain text of a page's body blocks, for word-count and anchor checks. */
export function transcriptionText(page: PageTranscription): string {
  return page.blocks.map((b) => b.text).join('\n\n')
}

/**
 * Everything the page *has*, including its furniture — what the cross-checks
 * compare OCR against.
 *
 * Not the same as `transcriptionText`, and the difference is the whole point.
 * The body text is what the reader gets and what the seam checks and the proof
 * sheet work on, so the running head and folio are rightly absent from it: the
 * layout engine sets those itself, and a head spliced into the body would print
 * twice.
 *
 * But OCR read them off the paper, so a check that compares OCR against the
 * body alone concludes that every running head and every folio in the book has
 * been dropped. On a book with heads on every leaf that is one false finding
 * per page, and — worse — it offers to put the head *back into the body*, which
 * is the one edit that would actually damage the page.
 *
 * So the checks get this, and only the checks.
 */
export function checkableText(page: PageTranscription): string {
  const furniture = [page.furniture?.runningHead, page.furniture?.folio]
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .join(' ')
  const body = transcriptionText(page)
  return furniture ? `${furniture}\n\n${body}` : body
}
