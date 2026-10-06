/**
 * A shelf book as an EPUB, for reading fast rather than for print.
 *
 *   npx vite-node --config vitest.config.ts scripts/epub-of.ts <book-dir> <out-dir>
 *   (cd <out-dir> && zip -X0 ../book.epub mimetype && zip -Xr9D ../book.epub META-INF OEBPS)
 *
 * The PDF is the edition, and it is for a desk: a 7×10 page of eleven-point
 * Caslon is a slow thing to scan on a phone. This is the same text, reflowing
 * to whatever screen it is opened on, with a chapter per file so a reader's
 * contents list jumps, and every footnote a tap away (`epub:type="noteref"`,
 * which Apple Books and most readers show as a pop-up).
 *
 * The same text, not a copy of it: assembly and the edit list are pure core
 * (as `body-of.ts` uses them), and footnotes are claimed by `prepareFootnotes`,
 * the function the layout engine uses, so a note is under the same mark here
 * as on the printed page. Pictures are the shelf's own `images/*.png`, set
 * after the block they are anchored to — a run-around is a print idea, and a
 * reflowing column has no margin to run beside.
 *
 * It writes an unpacked EPUB directory, which the zip line above packs. No
 * zip library is carried for a job `zip` does, with `mimetype` stored first
 * and uncompressed as the format requires.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { headingsWithoutMarks, prepareFootnotes } from '@core/layout/footnotes'
import { synopsisWithPages } from '@core/layout/contents-pages'
import { parseInlineMarkup, type InlinePart } from '@core/transcribe/markup'

const [dir, out] = process.argv.slice(-2)
if (!dir || !out || dir === out) throw new Error('epub-of.ts <book-dir> <out-dir>')

const file = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf8'))
const doc = applyEdits(assembleBook(file.run.transcriptions), file.run.edits ?? [])
const answers = (file.answers?.export ?? {}) as Record<string, string>
const title = answers.title || doc.chapters[0]?.title || 'Untitled'
const author = answers.author || ''
const year = answers.originalYear || ''

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Text with its emphasis and note references, as XHTML. */
function inline(
  text: string,
  emphasis: readonly number[] = [],
  strong: readonly number[] = [],
  refs: ReadonlyMap<number, string[]> = new Map(),
  wordParts: readonly InlinePart[] = []
): string {
  const it = new Set(emphasis)
  const bold = new Set(strong)
  const parts = text.split(/(\s+)/u)
  let word = -1
  let open = ''
  let html = ''
  const close = (): void => {
    if (open === 'bi') html += '</b></i>'
    else if (open === 'i') html += '</i>'
    else if (open === 'b') html += '</b>'
    open = ''
  }
  for (const part of parts) {
    if (part === '') continue
    if (/^\s+$/u.test(part)) {
      html += ' '
      continue
    }
    word += 1
    // A word set partly in a face is written a stretch at a time, cut where
    // its parts begin and end; any other word is one stretch.
    const mine = wordParts.filter((p) => p.word === word)
    const cuts = [...new Set([0, part.length, ...mine.flatMap((p) => [p.from, p.to])])]
      .filter((c) => c >= 0 && c <= part.length)
      .sort((a, b) => a - b)
    for (let k = 1; k < cuts.length; k++) {
      const from = cuts[k - 1]!
      const to = cuts[k]!
      const covers = (style: InlinePart['style']): boolean =>
        mine.some((p) => p.style === style && p.from <= from && p.to >= to)
      const want =
        (it.has(word) || covers('italic') ? 'i' : '') +
        (bold.has(word) || covers('strong') ? 'b' : '')
      const face = want === 'ib' ? 'bi' : want
      if (face !== open) {
        // A space already written belongs outside the run being closed.
        const trailing = html.endsWith(' ')
        if (trailing) html = html.slice(0, -1)
        close()
        if (trailing) html += ' '
        if (face === 'bi') html += '<i><b>'
        else if (face) html += `<${face}>`
        open = face
      }
      html += esc(part.slice(from, to))
    }
    for (const ref of refs.get(word) ?? []) html += ref
  }
  close()
  return html
}

const prepared = prepareFootnotes(doc.blocks, doc.footnotes, doc.bareMarks ?? [])
const cleanHeads = headingsWithoutMarks(doc.blocks, prepared)
const noteNumber = new Map<string, number>()
let n = 0
for (const id of prepared.notes.keys()) noteNumber.set(id, ++n)

// Pictures, by the block they follow.
const imagePath = new Map<string, string>(
  (file.images ?? []).map((i: { id: string; path: string }) => [i.id, i.path])
)
const figuresAfter = new Map<string, { id: string; caption: string | null }[]>()
for (const ill of doc.illustrations) {
  const at = ill.anchorAfterBlockId
  if (!at || !imagePath.has(ill.id)) continue
  figuresAfter.set(at, [...(figuresAfter.get(at) ?? []), { id: ill.id, caption: ill.caption }])
}

// One file per chapter, cut where a chapter begins.
const starts = new Set(doc.chapters.map((c) => c.id))
interface Chapter {
  file: string
  title: string
  /** What the original contents page said is in it, where it said anything. */
  synopsis: string | null
  level: number
  body: string[]
  notes: string[]
}
const chapters: Chapter[] = []
const heads = new Map(doc.chapters.map((c) => [c.id, c]))
let current: Chapter | null = null
const figuresUsed: string[] = []

doc.blocks.forEach((block, i) => {
  if (block.kind === 'footnote') return
  if (!current || starts.has(block.id)) {
    const head = heads.get(block.id)
    const name = head ? (cleanHeads.get(head.title.trim()) ?? head.title) : 'Opening'
    current = {
      file: `c${String(chapters.length + 1).padStart(3, '0')}.xhtml`,
      // A chapter the body only numbers is named as the original contents
      // named it, as the printed contents does.
      title: head?.contentsTitle ? `${name} ${head.contentsTitle}` : name,
      // Without the original's page references: an EPUB has no pages for
      // them to name, and the 1923 numbers would name the wrong ones.
      synopsis:
        head?.synopsis === undefined
          ? null
          : synopsisWithPages(head.synopsis, head.synopsisSource?.references ?? [], null),
      level: head?.level ?? 1,
      body: [],
      notes: []
    }
    chapters.push(current)
  }
  const chapter = current
  const prep = prepared.blocks[i]!
  const refs = new Map<number, string[]>()
  for (const ref of prep.references) {
    const num = noteNumber.get(ref.noteId)
    const note = prepared.notes.get(ref.noteId)
    if (!num || !note) continue
    const link = `<a epub:type="noteref" href="#n${num}" id="r${num}" class="ref">${num}</a>`
    refs.set(ref.wordIndex, [...(refs.get(ref.wordIndex) ?? []), link])
    chapter.notes.push(
      `<aside epub:type="footnote" id="n${num}" class="note"><p><a href="#r${num}">${num}.</a> ${inline(note.text, note.emphasis, note.strong, new Map(), note.parts)}</p></aside>`
    )
  }
  const html = inline(prep.text, block.emphasis, block.strong, refs, block.parts)
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(6, Math.max(2, (block.level ?? 1) + 1))
      chapter.body.push(`<h${level}>${html}</h${level}>`)
      break
    }
    case 'blockquote':
    case 'epigraph':
      chapter.body.push(`<blockquote><p>${html}</p></blockquote>`)
      break
    case 'verse':
      chapter.body.push(`<p class="verse">${html}</p>`)
      break
    case 'caption':
      chapter.body.push(`<p class="caption">${html}</p>`)
      break
    case 'list-item':
      chapter.body.push(`<p class="item">${html}</p>`)
      break
    case 'table': {
      const rows = (block.cells ?? []).map(
        (row, r) =>
          '<tr>' +
          row
            .map((cell) => {
              const tag = r === 0 && block.headerRow ? 'th' : 'td'
              return `<${tag}>${esc(cell.replace(/<\/?[ib]>/g, ''))}</${tag}>`
            })
            .join('') +
          '</tr>'
      )
      chapter.body.push(rows.length ? `<table>${rows.join('')}</table>` : `<p>${html}</p>`)
      break
    }
    default:
      chapter.body.push(`<p>${html}</p>`)
  }
  for (const fig of figuresAfter.get(block.id) ?? []) {
    const src = imagePath.get(fig.id)!
    figuresUsed.push(src)
    // A caption of several paragraphs is the figure's key, set as notes are;
    // the engine reads it the same way (`captionKey`).
    const paras = (fig.caption ?? '')
      .split(/\n+/u)
      .map((p) => p.trim())
      .filter(Boolean)
    const cap = paras.length
      ? `<figcaption${paras.length > 1 ? ' class="key"' : ''}>${paras
          .map((p) => {
            const m = parseInlineMarkup(p)
            return paras.length > 1
              ? `<p>${inline(m.text, m.emphasis, m.strong, new Map(), m.parts)}</p>`
              : inline(m.text, m.emphasis, m.strong, new Map(), m.parts)
          })
          .join('')}</figcaption>`
      : ''
    const alt = parseInlineMarkup(paras[0] ?? 'Figure').text
    chapter.body.push(`<figure><img src="../${src}" alt="${esc(alt)}"/>${cap}</figure>`)
  }
})

const page = (heading: string, inner: string): string => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${esc(heading)}</title><link rel="stylesheet" href="style.css"/></head>
<body>
${inner}
</body>
</html>
`

mkdirSync(join(out, 'META-INF'), { recursive: true })
mkdirSync(join(out, 'OEBPS', 'images'), { recursive: true })
writeFileSync(join(out, 'mimetype'), 'application/epub+zip')
writeFileSync(
  join(out, 'META-INF', 'container.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`
)
writeFileSync(
  join(out, 'OEBPS', 'style.css'),
  `body { margin: 0 4%; line-height: 1.5; }
p { margin: 0; text-indent: 1.3em; }
h2 + p, h3 + p, h4 + p, blockquote + p, figure + p { text-indent: 0; }
h1, h2, h3, h4 { text-align: center; line-height: 1.25; margin: 1.6em 0 0.8em; }
h2 { font-size: 1.35em; } h3 { font-size: 1.15em; } h4 { font-size: 1em; }
blockquote { margin: 0.7em 1.5em; font-size: 0.95em; }
blockquote p { text-indent: 0; }
p.verse, p.item { text-indent: 0; margin-left: 1.5em; }
p.caption, figcaption { text-align: center; font-size: 0.9em; text-indent: 0; }
figcaption.key { text-align: left; font-size: 0.85em; }
figcaption.key p { text-indent: 0; margin: 0.2em 0; }
figure { margin: 1em 0; text-align: center; } figure img { max-width: 100%; }
a.ref { font-size: 0.7em; vertical-align: super; line-height: 0; text-decoration: none; }
section.notes { margin-top: 2em; border-top: 1px solid #999; font-size: 0.85em; }
aside.note p { text-indent: 0; margin: 0.4em 0; }
table { border-collapse: collapse; margin: 0.8em auto; font-size: 0.9em; }
td, th { padding: 0.1em 0.5em; vertical-align: top; }
.title { text-align: center; margin-top: 20%; }
.title p { text-indent: 0; margin: 0.6em 0; }
p.entry { text-indent: 0; margin-top: 1em; text-align: center; font-variant: small-caps; }
p.synopsis { text-indent: 0; font-size: 0.85em; text-align: left; }
`
)

const titleFile = page(
  title,
  `<section class="title" epub:type="titlepage"><h1>${esc(title)}</h1>` +
    (answers.seriesLine ? `<p>${esc(answers.seriesLine)}</p>` : '') +
    (author ? `<p>by ${esc(author)}</p>` : '') +
    (year ? `<p>${esc(year)}</p>` : '') +
    (answers.imprint ? `<p><i>${esc(answers.imprint)}</i></p>` : '') +
    '</section>'
)
writeFileSync(join(out, 'OEBPS', 'title.xhtml'), titleFile)

for (const ch of chapters) {
  const notes = ch.notes.length ? `<section class="notes">${ch.notes.join('\n')}</section>` : ''
  writeFileSync(join(out, 'OEBPS', ch.file), page(ch.title, ch.body.join('\n') + '\n' + notes))
}

const nav = page(
  'Contents',
  `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>` +
    chapters.map((c) => `<li><a href="${c.file}">${esc(c.title)}</a></li>`).join('') +
    '</ol></nav>'
)
writeFileSync(join(out, 'OEBPS', 'nav.xhtml'), nav)

// The original's analytical contents, where the book had one: each chapter
// with the topics its contents page listed, linked, and none of the original's
// page numbers, which describe another edition.
const described = chapters.some((c) => c.synopsis)
if (described) {
  writeFileSync(
    join(out, 'OEBPS', 'contents.xhtml'),
    page(
      'Contents',
      '<h1>Contents</h1>' +
        chapters
          // A chapter below the top level is listed when its contents
          // described it: The Mahatma Letters describes every letter, and a
          // letter is a level-2 chapter under its section.
          .filter((c) => c.level === 1 || c.synopsis)
          .map(
            (c) =>
              `<p class="entry"><a href="${c.file}">${esc(c.title)}</a></p>` +
              (c.synopsis ? `<p class="synopsis">${esc(c.synopsis)}</p>` : '')
          )
          .join('\n')
    )
  )
}

const pictures = [...new Set(figuresUsed)]
for (const src of pictures) copyFileSync(join(dir, src), join(out, 'OEBPS', src))

const id = `urn:libri-vetus:${String(file.run.key ?? title).replace(/[^\w.-]+/g, '-')}`
const manifest = [
  `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
  `<item id="css" href="style.css" media-type="text/css"/>`,
  `<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`,
  ...(described
    ? [`<item id="contents" href="contents.xhtml" media-type="application/xhtml+xml"/>`]
    : []),
  ...chapters.map(
    (c, i) => `<item id="c${i}" href="${c.file}" media-type="application/xhtml+xml"/>`
  ),
  ...pictures.map((p, i) => `<item id="img${i}" href="${p}" media-type="image/png"/>`)
]
const spine = ['title', ...(described ? ['contents'] : ['nav']), ...chapters.map((_, i) => `c${i}`)]
  .map((ref) => `<itemref idref="${ref}"/>`)
  .join('')
writeFileSync(
  join(out, 'OEBPS', 'content.opf'),
  `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${esc(id)}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
${author ? `<dc:creator>${esc(author)}</dc:creator>` : ''}
<dc:language>en</dc:language>
${answers.imprint ? `<dc:publisher>${esc(answers.imprint)}</dc:publisher>` : ''}
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine>${spine}</spine>
</package>
`
)

console.log(
  JSON.stringify(
    {
      chapters: chapters.length,
      notes: prepared.notes.size,
      orphans: prepared.orphans.length,
      pictures: pictures.length,
      picturesInBook: doc.illustrations.length
    },
    null,
    2
  )
)
