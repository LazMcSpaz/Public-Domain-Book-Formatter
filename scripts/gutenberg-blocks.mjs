/**
 * The Gutenberg transcription, split at the page turns it marks itself.
 *
 * Not a reading — a *second witness*, already proofread by a person against a
 * scan of this setting, and carrying two things the flat text lost: where each
 * paragraph begins, and the exact word at which each leaf ends. The page
 * anchors sit inline in the markup, so the split is where the compositor put it
 * rather than where a heuristic guesses.
 *
 * Nothing here decides anything. What it produces is compared against our own
 * OCR of our own pixels, and the disagreements are the list to look at.
 */
import { readFileSync, writeFileSync } from 'node:fs'

// `node scripts/gutenberg-blocks.mjs <in.html> <out.json>`
const [, , inPath = 'gutenberg.html', outPath = 'gutenberg-blocks.json'] = process.argv
const html = readFileSync(inPath, 'utf8')

const entities = (t) =>
  t
    .replace(/&mdash;|â€”|�/gu, '—')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&rsquo;/gu, '’')
    .replace(/&lsquo;/gu, '‘')
    .replace(/&ldquo;/gu, '“')
    .replace(/&rdquo;/gu, '”')

// Blocks in document order, each tagged with its kind. Headings matter: a
// chapter opening is a different block from a paragraph, and the structure gate
// is the one place this app cannot recover from the text alone.
const blockRe = /<(p|h2|h3|h4|li|pre)\b[^>]*>([\s\S]*?)<\/\1>/gu
const PAGE = /<span class="pagenum">[\s\S]*?name="page(\d+)"[\s\S]*?<\/span>/gu

const leaves = new Map() // leaf -> [{kind, text}]
let folio = 1
/**
 * The transcriber's own wrapper, which is not the book.
 *
 * A Project Gutenberg file opens and closes with its licence and its header,
 * and those blocks sit inside the same markup as the text. Swept up, they land
 * on the first and last leaves — and a book for sale would print the licence
 * under the author's name. The consistency check is what caught it, on
 * `including including`, which is the shape of a `<pre>` block folded into a
 * paragraph.
 *
 * Matched on what the block says rather than on where it sits, because "last
 * block of the last leaf" is true of the real last paragraph too.
 */
const WRAPPER =
  /(project gutenberg|gutenberg-tm|www\.gutenberg|pglaf\.org|start of th(is|e) project|end of th(is|e) project)/iu

const push = (kind, text, flags = {}, level = 1) => {
  const clean = entities(text)
    .replace(/<[^>]+>/gu, (m) => (/^<\/?i>$/iu.test(m) ? m.toLowerCase() : ''))
    .replace(/\s+/gu, ' ')
    .trim()
  if (!clean) return
  if (WRAPPER.test(clean)) return
  const leaf = folio - 1
  if (!leaves.has(leaf)) leaves.set(leaf, [])
  leaves.get(leaf).push({ kind, text: clean, ...(kind === 'heading' ? { level } : {}), ...flags })
}

for (const m of html.matchAll(blockRe)) {
  //  matters: the table of healing colours on leaf 67 is set as an
  // indented list under two group heads, and a transcription that flattened it
  // into a paragraph would print a table as prose.
  const kind =
    m[1] === 'p' ? 'paragraph' : m[1] === 'li' ? 'list-item' : m[1] === 'pre' ? 'verse' : 'heading'
  const inner = m[2]
  // A chapter opens with its number over its title — two headings, which
  // `deriveChapters` collapses into one chapter. A head *inside* a chapter is
  // a level below that, and marking it so is what keeps `KEY TO THE ASTRAL
  // COLORS`, `TABLE OF HEALING COLORS` and `THE GREAT AURIC CIRCLE` out of the
  // contents as chapters of their own — which is where they were.
  //
  // `THE END.` is set like a chapter title and heads nothing at all, so it
  // goes with them: display type is not a section.
  const level =
    m[1] === 'h4' || /^THE END\.?$/iu.test(inner.replace(/<[^>]+>/gu, '').trim()) ? 2 : 1
  // A paragraph may straddle a page turn. Split it there, and file each part
  // under the leaf it was actually printed on — which is the whole reason to
  // use the markup rather than the flat text.
  // Collected first, then flagged. Marking a part `continuesNext` as it is
  // emitted was wrong at the one boundary that matters: a paragraph ending
  // exactly at a leaf turn has a page anchor after its last word and nothing
  // following it, and got told it continued onto a leaf that begins a new
  // paragraph. Assembly would then have run two paragraphs into one.
  const parts = []
  let last = 0
  for (const p of inner.matchAll(PAGE)) {
    parts.push({ text: inner.slice(last, p.index), folio })
    folio = Number(p[1])
    last = p.index + p[0].length
  }
  parts.push({ text: inner.slice(last), folio })
  const real = parts.filter((p) => p.text.trim())
  real.forEach((part, i) => {
    folio = part.folio
    push(
      kind,
      part.text,
      {
        ...(i > 0 ? { continuesPrevious: true } : {}),
        ...(i < real.length - 1 ? { continuesNext: true } : {})
      },
      level
    )
  })
  folio = parts[parts.length - 1].folio
}

const out = {}
for (const [leaf, blocks] of [...leaves].sort((a, b) => a[0] - b[0])) out[leaf] = blocks
writeFileSync(outPath, JSON.stringify(out, null, 1))

const text = {}
for (const [leaf, blocks] of Object.entries(out)) text[leaf] = blocks.map((b) => b.text).join(' ')
writeFileSync(outPath.replace(/\.json$/u, '-text.json'), JSON.stringify(text))

console.log('leaves', Object.keys(out).length)
console.log(
  'blocks',
  Object.values(out).reduce((n, b) => n + b.length, 0)
)
console.log(
  'headings',
  Object.values(out)
    .flat()
    .filter((b) => b.kind === 'heading').length
)
console.log('wrote', outPath)
