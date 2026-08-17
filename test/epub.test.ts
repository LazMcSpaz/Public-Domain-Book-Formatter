import { describe, it, expect } from 'vitest'
import {
  blocksFromDocument,
  element,
  parsePackage,
  readZipDirectory,
  resolveInZip,
  text,
  textOf,
  type EpubNode
} from '@core/epub'
import { deflateRawSync } from 'node:zlib'

/**
 * A zip built by hand, so the reader is tested against bytes rather than
 * against another implementation of the same guesses.
 */
function zip(files: { name: string; body: string; store?: boolean }[]): Uint8Array {
  const parts: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const raw = Buffer.from(file.body, 'utf8')
    const body = file.store ? raw : deflateRawSync(raw)
    const method = file.store ? 0 : 8

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, body)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    directory.push(entry, name)

    offset += local.length + name.length + body.length
  }

  const central = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...parts, central, end]))
}

describe('reading a zip’s own directory', () => {
  it('finds every entry, stored or deflated', () => {
    const bytes = zip([
      { name: 'mimetype', body: 'application/epub+zip', store: true },
      { name: 'OEBPS/one.xhtml', body: '<p>hello</p>'.repeat(50) }
    ])
    const entries = readZipDirectory(bytes)
    expect(entries.map((e) => e.name)).toEqual(['mimetype', 'OEBPS/one.xhtml'])
    expect(entries[0]!.method).toBe(0)
    expect(entries[1]!.method).toBe(8)
    // Deflate has to have actually done something, or the fixture proves nothing.
    expect(entries[1]!.compressedSize).toBeLessThan(entries[1]!.uncompressedSize)
  })

  it('says plainly when the file is not an archive at all', () => {
    expect(() => readZipDirectory(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a zip/i)
  })

  it('says plainly when the directory is short of what it promised', () => {
    const bytes = zip([{ name: 'a', body: 'x' }])
    // Claim two entries where one was written.
    new DataView(bytes.buffer).setUint16(bytes.length - 22 + 10, 2, true)
    expect(() => readZipDirectory(bytes)).toThrow(/damaged/i)
  })
})

describe('resolving a path inside an archive', () => {
  it('reads an href relative to the document that named it', () => {
    expect(resolveInZip('OEBPS/content.opf', 'text/chapter-1.xhtml')).toBe(
      'OEBPS/text/chapter-1.xhtml'
    )
    expect(resolveInZip('OEBPS/text/ch1.xhtml', '../images/plate.jpg')).toBe(
      'OEBPS/images/plate.jpg'
    )
    expect(resolveInZip('OEBPS/text/ch1.xhtml', './same.xhtml')).toBe('OEBPS/text/same.xhtml')
  })

  it('treats a leading slash as the root of the archive', () => {
    expect(resolveInZip('OEBPS/text/ch1.xhtml', '/OEBPS/cover.jpg')).toBe('OEBPS/cover.jpg')
  })
})

// ---------------------------------------------------------------------------

const doc = (...children: EpubNode[]): EpubNode => element('body', {}, children)

describe('what an EPUB’s markup becomes', () => {
  it('maps the elements a book is actually made of', () => {
    const { blocks } = blocksFromDocument(
      doc(
        element('h1', {}, [text('Of the Air')]),
        element('p', {}, [text('The alembick being set.')]),
        element('blockquote', {}, [element('p', {}, [text('A quoted line.')])]),
        element('ul', {}, [element('li', {}, [text('First')]), element('li', {}, [text('Second')])])
      )
    )
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ['heading', 'Of the Air'],
      ['paragraph', 'The alembick being set.'],
      ['blockquote', 'A quoted line.'],
      ['list-item', 'First'],
      ['list-item', 'Second']
    ])
    expect(blocks[0]!.level).toBe(1)
  })

  it('keeps the italics, as the word indices everything else already uses', () => {
    // Not a second implementation: the inline content is serialised back to the
    // `<i>` notation `parseInlineMarkup` reads off the vision pass, so a scan
    // and an EPUB produce the same thing.
    const { blocks } = blocksFromDocument(
      doc(
        element('p', {}, [
          text('a priest called '),
          element('i', {}, [text('hpho-bo')]),
          text(' in the original')
        ])
      )
    )
    expect(blocks[0]!.text).toBe('a priest called hpho-bo in the original')
    expect(blocks[0]!.emphasis).toEqual([3])
  })

  it('reads <em> and <cite> as the same emphasis', () => {
    const { blocks } = blocksFromDocument(
      doc(
        element('p', {}, [
          element('em', {}, [text('one')]),
          text(' '),
          element('cite', {}, [text('two')])
        ])
      )
    )
    expect(blocks[0]!.emphasis).toEqual([0, 1])
  })

  it('takes a table as its cells, with the flattened text derived from them', () => {
    const { blocks } = blocksFromDocument(
      doc(
        element('table', {}, [
          element('tr', {}, [element('th', {}, [text('Year')]), element('th', {}, [text('Port')])]),
          element('tr', {}, [
            element('td', {}, [text('1665')]),
            element('td', {}, [text('Bristol')])
          ])
        ])
      )
    )
    expect(blocks[0]!.kind).toBe('table')
    expect(blocks[0]!.cells).toEqual([
      ['Year', 'Port'],
      ['1665', 'Bristol']
    ])
    expect(blocks[0]!.headerRow).toBe(true)
    expect(blocks[0]!.text).toBe('Year | Port\n1665 | Bristol')
  })

  it('keeps the paragraphs inside a quotation apart', () => {
    // Flattening would run a whole quoted passage together and lose every
    // break the author put in it.
    const { blocks } = blocksFromDocument(
      doc(
        element('blockquote', {}, [
          element('p', {}, [text('First half.')]),
          element('p', {}, [text('Second half.')])
        ])
      )
    )
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ['blockquote', 'First half.'],
      ['blockquote', 'Second half.']
    ])
  })

  it('drops the machinery, never the words', () => {
    const { blocks } = blocksFromDocument(
      doc(
        element('style', {}, [text('p { color: red }')]),
        element('script', {}, [text('alert(1)')]),
        element('div', {}, [element('p', {}, [text('Still here.')])])
      )
    )
    expect(blocks.map((b) => b.text)).toEqual(['Still here.'])
  })

  it('collapses whitespace the way a browser does', () => {
    const { blocks } = blocksFromDocument(doc(element('p', {}, [text('\n  two   words \n')])))
    expect(blocks[0]!.text).toBe('two words')
  })

  it('turns a line break inside a paragraph into a space', () => {
    // The book reflows to a measure it has not chosen yet, so a hard break is
    // damage rather than a correction.
    const { blocks } = blocksFromDocument(
      doc(element('p', {}, [text('one'), element('br'), text('two')]))
    )
    expect(blocks[0]!.text).toBe('one two')
  })

  it('notes each picture and the block it followed', () => {
    const { blocks, images } = blocksFromDocument(
      doc(
        element('p', {}, [text('Before.')]),
        element('img', { src: '../images/plate.jpg', alt: 'The alembick' })
      ),
      10
    )
    expect(blocks).toHaveLength(1)
    expect(images).toEqual([{ src: '../images/plate.jpg', alt: 'The alembick', afterBlock: 10 }])
  })

  it('writes no block for an element that says nothing', () => {
    const { blocks } = blocksFromDocument(doc(element('p'), element('p', {}, [text('  ')])))
    expect(blocks).toEqual([])
  })
})

// ---------------------------------------------------------------------------

describe('what an EPUB says about itself', () => {
  const pkg = (...extra: EpubNode[]): EpubNode =>
    element('package', {}, [
      element('metadata', {}, [
        element('dc:title', {}, [text('The Alchemist His Practise')]),
        element('dc:creator', { 'opf:role': 'trl' }, [text('A. Translator')]),
        element('dc:creator', { 'opf:role': 'aut' }, [text('A Student in the Spagyrick Art')]),
        element('dc:date', {}, [text('2019-04-01')]),
        element('dc:publisher', {}, [text('Standard Ebooks')]),
        element('dc:language', {}, [text('en-GB')]),
        ...extra
      ]),
      element('manifest', {}, [
        element('item', {
          id: 'c1',
          href: 'text/ch1.xhtml',
          'media-type': 'application/xhtml+xml'
        }),
        element('item', {
          id: 'c2',
          href: 'text/ch2.xhtml',
          'media-type': 'application/xhtml+xml'
        }),
        element('item', {
          id: 'cov',
          href: 'text/cover.xhtml',
          'media-type': 'application/xhtml+xml'
        })
      ]),
      element('spine', {}, [
        element('itemref', { idref: 'cov', linear: 'no' }),
        element('itemref', { idref: 'c2' }),
        element('itemref', { idref: 'c1' })
      ])
    ])

  const read = () => parsePackage(pkg(), (href) => resolveInZip('OEBPS/content.opf', href))

  it('takes the reading order from the spine, not from the archive', () => {
    // Chapter two is listed first on purpose: an order guessed from the
    // manifest, or alphabetically, gives a book with shuffled chapters.
    expect(read().spine).toEqual(['OEBPS/text/ch2.xhtml', 'OEBPS/text/ch1.xhtml'])
  })

  it('leaves out matter marked as outside the reading order', () => {
    expect(read().spine).not.toContain('OEBPS/text/cover.xhtml')
  })

  it('credits the author rather than the first person listed', () => {
    // EPUBs list translators and illustrators as creators too. Taking the
    // first is how a reprint ends up credited to its 1913 translator.
    expect(read().author).toBe('A Student in the Spagyrick Art')
  })

  it('falls back to an unmarked creator when nobody is marked as the author', () => {
    const plain = element('package', {}, [
      element('metadata', {}, [element('dc:creator', {}, [text('Anonymous')])]),
      element('spine', {})
    ])
    expect(parsePackage(plain, (h) => h).author).toBe('Anonymous')
  })

  it('reduces the date to a year, which is the only part worth offering', () => {
    // And it is the *ebook's* year, not the book's — which is why it arrives
    // at the export gate as something to confirm rather than as a fact.
    expect(read().year).toBe('2019')
  })

  it('reads the title and publisher off the package', () => {
    expect(read().title).toBe('The Alchemist His Practise')
    expect(read().publisher).toBe('Standard Ebooks')
    expect(read().language).toBe('en-GB')
  })

  it('says nothing rather than guessing when a field is absent', () => {
    const bare = element('package', {}, [element('metadata', {}), element('spine', {})])
    const out = parsePackage(bare, (h) => h)
    expect([out.title, out.author, out.year, out.publisher]).toEqual([null, null, null, null])
    expect(out.spine).toEqual([])
  })
})

describe('the tree helpers', () => {
  it('reads all the text under a node, collapsed', () => {
    expect(textOf(element('p', {}, [text('a  b'), element('i', {}, [text(' c ')])]))).toBe('a b c')
  })
})
