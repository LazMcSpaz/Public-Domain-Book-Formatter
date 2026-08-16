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
import type { PageRole } from '@core/pages'

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
  /** Present only for front-matter pages. */
  metadata?: ExtractedMetadata
}

const PAGE_ROLES: readonly PageRole[] = [
  'half-title',
  'title-page',
  'copyright',
  'dedication',
  'epigraph',
  'preface',
  'table-of-contents',
  'list-of-illustrations',
  'chapter-opening',
  'body',
  'part-divider',
  'plate',
  'index',
  'appendix',
  'glossary',
  'colophon',
  'blank',
  'unknown'
]

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
export function parsePageTranscription(raw: unknown, pageIndex: number): PageTranscription {
  if (!isRecord(raw)) throw new Error(`Page ${pageIndex + 1}: reply was not an object`)

  const role = raw['role']
  if (typeof role !== 'string' || !PAGE_ROLES.includes(role as PageRole)) {
    throw new Error(`Page ${pageIndex + 1}: unknown page role ${JSON.stringify(role)}`)
  }

  const rawBlocks = raw['blocks']
  if (!Array.isArray(rawBlocks)) throw new Error(`Page ${pageIndex + 1}: blocks missing`)

  const blocks: TranscribedBlock[] = rawBlocks.map((b, i) => {
    if (!isRecord(b)) throw new Error(`Page ${pageIndex + 1}: block ${i} is not an object`)
    const kind = b['kind']
    const text = b['text']
    if (typeof kind !== 'string' || !BLOCK_KINDS.includes(kind as BlockKind)) {
      throw new Error(`Page ${pageIndex + 1}: block ${i} has unknown kind ${JSON.stringify(kind)}`)
    }
    if (typeof text !== 'string') {
      throw new Error(`Page ${pageIndex + 1}: block ${i} has no text`)
    }
    const block: TranscribedBlock = { kind: kind as BlockKind, text }
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
    furniture
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
