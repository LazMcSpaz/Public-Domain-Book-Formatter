/**
 * Opening an EPUB: unzip it, parse its markup, hand back a finished book.
 *
 * Two platform capabilities and nothing else. `DecompressionStream` inflates
 * the archive's entries — no zip library is needed for that, and adding one to
 * carry a single call would be the larger cost. `DOMParser` turns each XHTML
 * document into a tree, which is then handed to `@core/epub` where every
 * decision about what the markup *means* is made and tested.
 *
 * Everything a scan needs and an EPUB does not — rendering, OCR, the word
 * crops, the coordinate map, the vision pass — is simply absent here. That is
 * the feature: a book already typed by a person costs nothing to bring in.
 */
import {
  blocksFromDocument,
  parsePackage,
  payloadRange,
  readZipDirectory,
  resolveInZip,
  type EpubElement,
  type EpubNode,
  type EpubPackage
} from '@core/epub'
import { assembleBook, type BookDocument } from '@core/assemble'
import { assessText, type TextAssessment } from '@core/textquality'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

export interface EpubProgress {
  /** Documents read so far, and how many there are. */
  done: number
  total: number
}

export interface OpenedEpub {
  document: BookDocument
  /** Every leaf as its own transcription, so the rest of the app is unchanged. */
  transcriptions: PageTranscription[]
  package: EpubPackage
  /** imageId → the bytes to embed, keyed as the PDF writer expects. */
  images: Map<string, Uint8Array>
  /** Pictures found in the markup, in the order they appeared. */
  pictures: { id: string; afterBlock: number; alt: string; bytes: Uint8Array }[]
  /**
   * How much this text can be believed.
   *
   * An EPUB from Standard Ebooks or Gutenberg was typed and proofread by a
   * person. One exported by archive.org is *their OCR of a scan*, with no
   * images attached — and this app has no way to check it, because there are no
   * pixels behind it to check against. Telling the two apart is the difference
   * between a book that needs no reading and three hundred leaves of
   * `J^? ske5>tlcal` that the user finds out about at leaf seven.
   */
  quality: TextAssessment
}

/** Whether a file is worth trying to open as an EPUB at all. */
export function looksLikeEpub(file: { name: string; type?: string }): boolean {
  return /\.epub$/i.test(file.name) || file.type === 'application/epub+zip'
}

async function inflate(bytes: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return bytes
  if (method !== 8) {
    throw new Error(`This EPUB uses a compression this browser cannot read (method ${method}).`)
  }
  // `deflate-raw` because a zip entry carries the deflate stream with no zlib
  // header around it.
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Every entry's bytes, keyed by archive path. */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>()
  for (const entry of readZipDirectory(bytes)) {
    // Directories are entries too, and have nothing in them.
    if (entry.name.endsWith('/')) continue
    const { from, to } = payloadRange(bytes, entry)
    out.set(entry.name, await inflate(bytes.subarray(from, to), entry.method))
  }
  return out
}

const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes)

/** Turn one XML document into the tree `@core/epub` reasons about. */
function toTree(xml: string): EpubNode {
  const parsed = new DOMParser().parseFromString(xml, 'application/xhtml+xml')
  const failed = parsed.getElementsByTagName('parsererror')[0]
  // XHTML is XML, and a strict parse of real-world files does fail. Falling
  // back to the HTML parser recovers a readable tree from a book that would
  // otherwise be refused outright.
  const root = failed
    ? new DOMParser().parseFromString(xml, 'text/html').documentElement
    : parsed.documentElement
  return convert(root)
}

function convert(node: Node): EpubNode {
  if (node.nodeType === Node.TEXT_NODE) return { kind: 'text', text: node.nodeValue ?? '' }
  const el = node as Element
  const attrs: Record<string, string> = {}
  for (const attr of Array.from(el.attributes ?? [])) {
    attrs[attr.name.toLowerCase()] = attr.value
  }
  const children: EpubNode[] = []
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.ELEMENT_NODE) {
      children.push(convert(child))
    }
  }
  return {
    kind: 'element',
    // `localName` drops the namespace prefix, which is what the mapping rules
    // are written against — an EPUB's `<html>` is in the XHTML namespace.
    name: (el.localName || el.nodeName).toLowerCase(),
    attrs,
    children
  } satisfies EpubElement
}

/**
 * The package document's path, from the archive's own pointer to it.
 *
 * `META-INF/container.xml` is the one file at a fixed location in every EPUB;
 * everything else is wherever the producer put it.
 */
function packagePath(files: Map<string, Uint8Array>): string {
  const container = files.get('META-INF/container.xml')
  if (!container) throw new Error('That file has no EPUB container in it.')
  const tree = toTree(decode(container))
  const stack: EpubNode[] = [tree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.kind !== 'element') continue
    if (node.name === 'rootfile' && node.attrs['full-path']) return node.attrs['full-path']
    stack.push(...node.children)
  }
  throw new Error('That EPUB does not say where its package document is.')
}

/**
 * Read an EPUB into the book this app sets.
 *
 * Each spine document becomes one `PageTranscription` — a "page" here is a
 * content document rather than a leaf of paper, which is the honest reading of
 * an EPUB and is what makes every step after this one work unchanged: the proof
 * sheet shows a document at a time, block ids stay `p{n}b{n}`, and assembly,
 * corrections and layout need to know nothing about where the book came from.
 */
export async function openEpub(
  fileData: ArrayBuffer | Blob,
  onProgress?: (p: EpubProgress) => void
): Promise<OpenedEpub> {
  const raw =
    fileData instanceof Blob
      ? new Uint8Array(await fileData.arrayBuffer())
      : new Uint8Array(fileData)
  const files = await unzip(raw)

  const opfPath = packagePath(files)
  const opf = files.get(opfPath)
  if (!opf) throw new Error(`That EPUB names a package document (${opfPath}) it does not contain.`)
  const pkg = parsePackage(toTree(decode(opf)), (href) => resolveInZip(opfPath, href))

  if (pkg.spine.length === 0) {
    throw new Error('That EPUB lists no reading order, so there is no book to lay out.')
  }

  const transcriptions: PageTranscription[] = []
  const images = new Map<string, Uint8Array>()
  const pictures: OpenedEpub['pictures'] = []

  for (const [index, href] of pkg.spine.entries()) {
    onProgress?.({ done: index, total: pkg.spine.length })
    const bytes = files.get(href)
    // A spine entry with nothing behind it is the archive contradicting itself.
    // The leaf is kept as an empty one rather than shifting every later index.
    const content = bytes
      ? blocksFromDocument(toTree(decode(bytes)))
      : { blocks: [] as TranscribedBlock[], images: [] }

    transcriptions.push({
      pageIndex: index,
      role: 'body',
      blocks: content.blocks,
      uncertain: [],
      furniture: {}
    })

    for (const picture of content.images) {
      const path = resolveInZip(href, picture.src)
      const data = files.get(path)
      if (!data) continue
      const id = `epub-${index}-${pictures.length}`
      images.set(id, data)
      pictures.push({ id, afterBlock: picture.afterBlock, alt: picture.alt, bytes: data })
    }
  }
  onProgress?.({ done: pkg.spine.length, total: pkg.spine.length })

  const quality = assessText(transcriptions.flatMap((t) => t.blocks.map((b) => b.text)).join('\n'))

  return {
    document: assembleBook(transcriptions),
    transcriptions,
    package: pkg,
    images,
    pictures,
    quality
  }
}
