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

export interface TranscribedBlock {
  kind: BlockKind
  text: string
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
  'list-item'
]

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
    return block
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
