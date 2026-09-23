/**
 * What is on the shelf, and where each file belongs.
 *
 * A shelf accretes: a volume arrives in thirty-eight page chunks, a book is
 * uploaded to be looked at later, and a year on nobody can say what half the
 * files are without opening them. This opens them — pages, bytes, and the
 * first text each carries — and writes `INVENTORY.md` so the answer is a file
 * rather than an afternoon.
 *
 * Every PDF is classified from **what it says**, not what it is called: the
 * names here run from a SHA-256 to a download slug with the vendor's name in
 * it, and neither says what the book is. It also reports whether a file has a
 * text layer at all, which decides its route (`docs/FLOW.md`): a photographed
 * leaf must be read against its pixels, and a file already carrying text
 * skips the reading pass entirely.
 *
 *   node scripts/shelf-inventory.mjs <shelf>            # write INVENTORY.md
 *   node scripts/shelf-inventory.mjs <shelf> --move     # also git mv loose
 *                                                       #   uploads into sources/
 *
 * `--move` touches **only PDFs loose at the shelf root**. `scans/` is left
 * alone because every `book.json` names its scan by that path, and moving one
 * would break the book that points at it. It prints the moves and makes no
 * commit: a rename is cheap to review and expensive to guess at.
 *
 * It does not shrink the repository. Git keeps every version of every blob
 * for ever, so a 19 MB upload moved into a folder is still 19 MB of history.
 * Only a rewrite removes that, and that is the editor's call.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs')

const SHELF = resolve(process.argv[2] ?? '.')
const MOVE = process.argv.includes('--move')

/** Which pile a file belongs to, decided by what its opening leaves say. */
const GROUPS = [
  // Vol. I runs 'THE VEIL OF ISIS' as its head, so the title never appears.
  ['blavatsky-isis-unveiled', /isis unveiled|veil of isis|coo1-ark/iu],
  ['blavatsky-secret-doctrine', /secret doctrine|cosmic evolution|anthropogenesis|stanza [ivx]/iu],
  ['blavatsky-other', /blavatsky|theosophical glossary|key to theosophy|modern panarion/iu],
  ['manly-hall-lectures', /manuscript (lecture|series)|manly p(alme)?r? hall/iu],
  [
    'nlp-erickson',
    /structure of magic|hypnotic technique|milton h\.? erickson|uncommon therapy|lakoff|natural logic/iu
  ],
  [
    'panchadasi-atkinson',
    /clairvoyance|astral world|human aura|thought vibration|panchadasi|atkinson|advanced thought pub/iu
  ],
  ['reference-other', /plausible inference|polya|france in the eighteenth century/iu]
]

const classify = (text, name) => {
  const hay = `${text} ${name}`
  for (const [group, re] of GROUPS) if (re.test(hay)) return group
  return 'unsorted'
}

/** Opening text, page count, and whether the file carries a text layer. */
async function look(path) {
  const bytes = statSync(path).size
  try {
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(path)),
      useSystemFonts: true
    }).promise
    let head = ''
    for (let i = 1; i <= Math.min(4, doc.numPages); i++) {
      const c = await (await doc.getPage(i)).getTextContent()
      head += c.items.map((it) => it.str).join(' ') + ' '
    }
    // Sampled away from the front matter, which a scan often has typed.
    let sampled = 0
    for (const i of [2, Math.ceil(doc.numPages / 2), doc.numPages].filter((n) => n >= 1)) {
      const c = await (await doc.getPage(Math.min(i, doc.numPages))).getTextContent()
      sampled += c.items
        .map((it) => it.str)
        .join('')
        .trim().length
    }
    const pages = doc.numPages
    await doc.destroy()
    return { bytes, pages, head: head.replace(/\s+/gu, ' ').trim(), textChars: sampled }
  } catch (e) {
    return { bytes, pages: null, head: '', textChars: 0, error: e.message }
  }
}

// Which scans a book already claims — those are spoken for and never moved.
const claimed = new Map()
const booksDir = `${SHELF}/books`
if (existsSync(booksDir)) {
  for (const slug of readdirSync(booksDir)) {
    let book
    try {
      book = JSON.parse(readFileSync(`${booksDir}/${slug}/book.json`, 'utf8'))
    } catch {
      continue
    }
    for (const holder of [book.run ?? {}, book]) {
      const p = (holder.scan ?? {}).path
      if (p) claimed.set(basename(p), slug)
    }
  }
}

const rows = []
const seen = []
const places = [
  [SHELF, 'root'],
  [`${SHELF}/scans`, 'scans']
]
// Every pile under sources/, so a file stays in the inventory after --move.
if (existsSync(`${SHELF}/sources`)) {
  for (const g of readdirSync(`${SHELF}/sources`)) {
    places.push([`${SHELF}/sources/${g}`, `sources/${g}`])
  }
}
for (const [dir, where] of places) {
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.pdf'))) {
    seen.push({ f, where, path: `${dir}/${f}` })
  }
}
for (const { f, where, path } of seen) {
  const info = await look(path)
  rows.push({
    file: f,
    where,
    ...info,
    book: claimed.get(f) ?? '',
    group: classify(info.head, f)
  })
  process.stderr.write('.')
}
process.stderr.write('\n')

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`
const esc = (s) => String(s).replace(/\|/gu, '\\|')
const byGroup = new Map()
for (const r of rows) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r])

let md = `# What is on this shelf

Generated by \`node scripts/shelf-inventory.mjs <shelf>\` in the formatter
repository. Every PDF here was opened and classified by what its opening
leaves say, not by its name. Re-run it after adding anything.

- **Has text** says the file carries a text layer on the leaves sampled. A
  file with none is a photograph and must be read against its pixels; one
  with text still needs asking *whose* text it is, since somebody's OCR is
  made of words shaped exactly like right ones (see \`docs/FLOW.md\`).
- **Book** names the \`books/<slug>\` that claims the file as its scan. A blank
  means nothing points at it.

`
for (const group of [...byGroup.keys()].sort()) {
  const list = byGroup.get(group).sort((a, b) => b.bytes - a.bytes)
  const total = list.reduce((s, r) => s + r.bytes, 0)
  md += `## ${group} — ${list.length} file(s), ${mb(total)}\n\n`
  md += `| File | Where | Pages | Size | Has text | Book | Opens with |\n`
  md += `| --- | --- | ---: | ---: | :-: | --- | --- |\n`
  for (const r of list) {
    md += `| \`${esc(r.file.length > 44 ? r.file.slice(0, 41) + '…' : r.file)}\` | ${r.where} | ${r.pages ?? '?'} | ${mb(r.bytes)} | ${r.textChars > 200 ? 'yes' : 'no'} | ${esc(r.book)} | ${esc(r.head.slice(0, 70)) || (r.error ? `ERROR ${esc(r.error.slice(0, 40))}` : '—')} |\n`
  }
  md += '\n'
}
writeFileSync(`${SHELF}/INVENTORY.md`, md)
console.log(`INVENTORY.md written: ${rows.length} PDFs, ${[...byGroup.keys()].length} groups`)
for (const g of [...byGroup.keys()].sort()) {
  const l = byGroup.get(g)
  console.log(
    `  ${g.padEnd(28)} ${String(l.length).padStart(3)} files  ${mb(l.reduce((s, r) => s + r.bytes, 0))}`
  )
}

const loose = rows.filter((r) => r.where === 'root')
if (loose.length === 0) process.exit(0)
console.log(`\n${loose.length} loose upload(s) at the shelf root:`)
for (const r of loose) console.log(`  sources/${r.group}/  <-  ${r.file.slice(0, 60)}`)
if (!MOVE) {
  console.log('\n--move performs these renames (git mv, no commit).')
  process.exit(0)
}
for (const r of loose) {
  const dest = `sources/${r.group}`
  execFileSync('mkdir', ['-p', `${SHELF}/${dest}`])
  try {
    execFileSync('git', ['-C', SHELF, 'mv', '--', r.file, `${dest}/${r.file}`])
  } catch {
    execFileSync('git', ['-C', SHELF, 'add', '--', `${dest}/${r.file}`])
  }
}
console.log(`\nmoved ${loose.length} file(s) into sources/. Nothing committed.`)
