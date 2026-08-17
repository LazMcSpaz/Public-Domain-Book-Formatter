/**
 * An EPUB's markup, turned into the blocks the rest of this app already sets.
 *
 * The whole point of accepting EPUBs is that a great deal of public-domain text
 * is *already digital* — Gutenberg, Standard Ebooks, archive.org — and reading
 * it costs nothing at all. No render, no OCR, no vision pass, no spend. The
 * structure this app otherwise pays a model to recover is sitting in the
 * markup, correctly, because a person put it there.
 *
 * So this is a mapping, not a recovery: `<h2>` *is* a heading, `<blockquote>`
 * *is* a quotation, and there is nothing to be uncertain about. What it must
 * not do is invent — an element it does not recognise contributes its text as a
 * paragraph rather than being dropped, because a chapter quietly missing a
 * passage is the failure this project cares most about.
 *
 * ## Emphasis, for free
 *
 * `<i>` and `<em>` are exactly what `parseInlineMarkup` already reads off the
 * vision pass's replies. Rather than a second implementation, inline content is
 * serialised back to `<i>…</i>` and handed to the existing parser — so italics
 * from an EPUB and italics from a scan arrive as the same word indices and
 * print through the same path.
 *
 * Pure: a tree in, blocks out. No DOM.
 */
import { parseInlineMarkup, type BlockKind, type TranscribedBlock } from '@core/transcribe'
import { collapse, textOf, type EpubElement, type EpubNode } from './tree'

/** Elements whose content is set apart rather than run into the paragraph flow. */
const BLOCK_KIND: Record<string, BlockKind> = {
  p: 'paragraph',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  blockquote: 'blockquote',
  li: 'list-item',
  figcaption: 'caption',
  caption: 'caption',
  table: 'table',
  pre: 'verse'
}

/** Elements that carry no text of their own and nothing below them is wanted. */
const SKIP = new Set(['head', 'script', 'style', 'title', 'nav', 'svg', 'meta', 'link'])

/** Inline elements meaning "italic", matching what `markup.ts` already reads. */
const ITALIC = new Set(['i', 'em', 'cite', 'var', 'dfn'])

/** A picture referenced by the markup, to be pulled out of the archive. */
export interface EpubImage {
  /** The `src` as written, still relative to the document it appeared in. */
  src: string
  alt: string
  /** Index of the block it followed, so it can be anchored where it was. */
  afterBlock: number
}

export interface EpubContent {
  blocks: TranscribedBlock[]
  images: EpubImage[]
}

/**
 * Serialise inline content back to the `<i>` markup `parseInlineMarkup` reads.
 *
 * The round trip is the point: emphasis recovered from a scan and emphasis
 * written into an EPUB become the same word indices, so everything downstream —
 * the seam repair, the proof editor, the line breaker, the PDF — has one thing
 * to handle rather than two.
 */
function inlineMarkup(nodes: readonly EpubNode[]): string {
  let out = ''
  const visit = (list: readonly EpubNode[]): void => {
    for (const node of list) {
      if (node.kind === 'text') {
        out += node.text
        continue
      }
      if (SKIP.has(node.name)) continue
      // A line break inside a paragraph is presentation, and this book reflows
      // to a measure it has not chosen yet — so it becomes a space.
      if (node.name === 'br') {
        out += ' '
        continue
      }
      if (ITALIC.has(node.name)) {
        out += '<i>'
        visit(node.children)
        out += '</i>'
        continue
      }
      visit(node.children)
    }
  }
  visit(nodes)
  return collapse(out)
}

function tableOf(el: EpubElement): string[][] {
  const rows: string[][] = []
  const collect = (node: EpubNode): void => {
    if (node.kind !== 'element') return
    if (node.name === 'tr') {
      const cells = node.children
        .filter(
          (c): c is EpubElement => c.kind === 'element' && (c.name === 'td' || c.name === 'th')
        )
        .map((c) => textOf(c))
      if (cells.length > 0) rows.push(cells)
      return
    }
    for (const child of node.children) collect(child)
  }
  collect(el)
  return rows
}

/** Whether a table's first row is its column heads, read off the markup. */
function hasHeaderRow(el: EpubElement): boolean {
  const firstRow = [...el.children].flatMap(function flatten(n: EpubNode): EpubElement[] {
    if (n.kind !== 'element') return []
    if (n.name === 'tr') return [n]
    return n.children.flatMap(flatten)
  })[0]
  if (!firstRow) return false
  return firstRow.children.some((c) => c.kind === 'element' && c.name === 'th')
}

/**
 * Read one XHTML document into blocks and the pictures it referenced.
 *
 * `startIndex` is where this document's blocks will sit in the book, so an
 * image can name the block it followed even though documents are read one at a
 * time.
 */
export function blocksFromDocument(root: EpubNode, startIndex = 0): EpubContent {
  const blocks: TranscribedBlock[] = []
  const images: EpubImage[] = []

  const push = (kind: BlockKind, raw: string, extra: Partial<TranscribedBlock> = {}): void => {
    const markup = parseInlineMarkup(raw)
    if (kind !== 'table' && markup.text.trim().length === 0) return
    blocks.push({
      kind,
      text: markup.text,
      ...(markup.emphasis.length > 0 ? { emphasis: markup.emphasis } : {}),
      ...extra
    })
  }

  /**
   * `within` is the kind a container has already established.
   *
   * A `<blockquote>` almost always wraps `<p>` elements rather than holding
   * text itself. Recursing plainly would turn every one of them into an
   * ordinary paragraph and lose the only thing the quotation was marking — so
   * the container's kind travels down to the blocks it contains.
   */
  const visit = (node: EpubNode, within: BlockKind | null = null): void => {
    if (node.kind === 'text') {
      // Loose text between block elements — rare, and real when it happens.
      const value = collapse(node.text)
      if (value) push(within ?? 'paragraph', value)
      return
    }
    if (SKIP.has(node.name)) return

    if (node.name === 'img' || node.name === 'image') {
      const src = node.attrs['src'] ?? node.attrs['xlink:href'] ?? node.attrs['href'] ?? ''
      if (src) {
        images.push({
          src,
          alt: node.attrs['alt'] ?? '',
          afterBlock: startIndex + blocks.length - 1
        })
      }
      return
    }

    // A paragraph inside a quotation is a quoted paragraph, not a plain one.
    const own = BLOCK_KIND[node.name]
    const kind = within !== null && own === 'paragraph' ? within : own

    if (kind === 'table') {
      const cells = tableOf(node)
      if (cells.length > 0) {
        blocks.push({
          kind: 'table',
          // Derived from the cells, never the other way about — the same rule
          // `normalizeTable` enforces everywhere else a table can enter.
          text: cells.map((row) => row.join(' | ')).join('\n'),
          cells,
          ...(hasHeaderRow(node) ? { headerRow: true } : {})
        })
      }
      return
    }

    if (kind) {
      // A blockquote usually wraps paragraphs rather than holding text itself.
      // Recursing keeps their structure; flattening would run a whole quoted
      // passage into one block and lose every break the author put in it.
      const nested = node.children.some(
        (c) => c.kind === 'element' && BLOCK_KIND[c.name] !== undefined
      )
      if (nested) {
        // Headings and list items keep their own kind wherever they appear;
        // only a container that *sets its contents apart* passes its kind on.
        const carried = kind === 'blockquote' || kind === 'verse' ? kind : within
        for (const child of node.children) visit(child, carried)
        return
      }
      const level = /^h([1-6])$/u.exec(node.name)
      push(kind, inlineMarkup(node.children), level ? { level: Number(level[1]) } : {})
      return
    }

    for (const child of node.children) visit(child, within)
  }

  visit(root)
  return { blocks, images }
}
