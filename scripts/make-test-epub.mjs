/**
 * A small EPUB to drive the flow against.
 *
 * Written by hand rather than fetched, so the harness has no network in it and
 * the fixture exercises the things that actually go wrong: a spine whose order
 * differs from the manifest's, a creator who is not the author, italics, a
 * table, a quotation and an image.
 */
import { crc32, deflateRawSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/test-book.epub')

/** A 1×1 PNG, so the image path is exercised without a real picture. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const page = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body>${body}</body></html>`

const files = [
  { name: 'mimetype', body: Buffer.from('application/epub+zip'), store: true },
  {
    name: 'META-INF/container.xml',
    body: Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  },
  {
    name: 'OEBPS/content.opf',
    body: Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="uid">urn:uuid:test</dc:identifier>
    <dc:title>The Alchemist His Practise</dc:title>
    <dc:creator opf:role="trl">A. Translator</dc:creator>
    <dc:creator opf:role="aut">A Student in the Spagyrick Art</dc:creator>
    <dc:date>2019-04-01</dc:date>
    <dc:publisher>Scratch Ebooks</dc:publisher>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="plate" href="images/plate.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="cover" linear="no"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`)
  },
  {
    name: 'OEBPS/text/cover.xhtml',
    body: Buffer.from(page('Cover', '<p>This cover is outside the reading order.</p>'))
  },
  {
    name: 'OEBPS/text/chapter-1.xhtml',
    body: Buffer.from(
      page(
        'Chapter I',
        `<h1>Of the Air</h1>
<p>The alembick being set upon a gentle fire, the spirit ascendeth and is
gathered in the receiver. This the ancients called <i>aqua vitae</i>, and helde
it soveraigne against all putrefaction.</p>
<blockquote><p>Nature is not to be hastened.</p><p>So saith Paracelsus.</p></blockquote>
<p>A second paragraph, that the book may have some length to it and the line
breaker something to do with a measure it has not chosen yet.</p>
<img src="../images/plate.png" alt="The alembick and its receiver"/>`
      )
    )
  },
  {
    name: 'OEBPS/text/chapter-2.xhtml',
    body: Buffer.from(
      page(
        'Chapter II',
        `<h1>Of the Trade in Spirits</h1>
<p>The vertues of hearbes have much beene written of, yet fewe have shewed how
the quintessence is drawne forth by calcination.</p>
<table>
  <tr><th>Year</th><th>Barrels</th><th>Port</th></tr>
  <tr><td>1665</td><td>1,204</td><td>Bristol</td></tr>
  <tr><td>1666</td><td>987</td><td>Hull</td></tr>
</table>
<ul><li>First of the three</li><li>Second of the three</li></ul>`
      )
    )
  },
  { name: 'OEBPS/images/plate.png', body: PNG, store: true }
]

const parts = []
const directory = []
let offset = 0
for (const file of files) {
  const name = Buffer.from(file.name, 'utf8')
  const raw = file.body
  const body = file.store ? raw : deflateRawSync(raw)
  const method = file.store ? 0 : 8

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(crc32(raw), 14)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(name.length, 26)
  parts.push(local, name, body)

  const entry = Buffer.alloc(46)
  entry.writeUInt32LE(0x02014b50, 0)
  entry.writeUInt16LE(20, 4)
  entry.writeUInt16LE(20, 6)
  entry.writeUInt16LE(method, 10)
  entry.writeUInt32LE(crc32(raw), 16)
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

writeFileSync(OUT, Buffer.concat([...parts, central, end]))
console.log(`wrote ${OUT} (${files.length} entries)`)
