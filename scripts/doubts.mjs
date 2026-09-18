/**
 * Cut every doubtful word in a batch at 600 DPI, before the batch is landed.
 *
 * A reader is given one 150-DPI render per leaf, which is the right size for a
 * page and the wrong size for a letter. On _Isis Unveiled_ Vol. I the readers
 * recorded 149 spans as "cannot be told at this resolution", and when the 94 of
 * them that carried a rival reading were finally cut at 600 to 1200 DPI, **a
 * third were wrong**. Every one had said exactly what to do next and nobody had
 * done it until the end.
 *
 * So this does it per batch. It takes what a reader hands back, finds each
 * `uncertain` entry that names a rival reading, locates the words on the leaf
 * against the OCR word boxes the recon cache already holds, renders a tight
 * crop at 600 DPI (1200 for a word or two), and writes an index a person reads
 * in one sitting — leaf, the reading, the rival, the crop — so the decision is
 * made while the batch is still in hand and the correction goes into the
 * batch file rather than into an edit months later.
 *
 * Two things learned making the first version of this by hand, kept here:
 *
 * - **A Greek or Hebrew span cannot be found by its own letters**, because OCR
 *   reads it as Latin junk. It is found by the English either side of it, and
 *   the crop is what lies between. That placed 89 of 94; the rest were done by
 *   hand off the token list, which this prints for anything it cannot place.
 * - **The render's DPI is not the scan's.** These leaves are about 1436 × 2315
 *   pixels; past roughly 600 DPI a render is interpolating and shows nothing a
 *   600 one does not. 1200 is asked for only so a two-letter word fills the
 *   frame.
 *
 *   node scripts/doubts.mjs <done.json> <out-dir>
 *
 * Needs `drive.mjs serve` up with the book current. Writes
 * `<out-dir>/doubts.md` and `<out-dir>/d<n>.png`; re-running skips crops
 * already on disk, so a browser that dies mid-way costs one crop.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..')
const [donePath, outDir] = process.argv.slice(2)
if (!donePath || !outDir) {
  console.error('doubts <done.json> <out-dir>')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const PAGE_W = 1559 // the leaf at 300 DPI, which is what the OCR boxes are in
const PAGE_H = 2467
const TAG = /<[^>]+>/g
const norm = (s) =>
  s
    .normalize('NFD')
    .replace(TAG, '')
    .toLowerCase()
    .replace(/[^a-z0-9Ͱ-Ͽ֐-׿]/g, '')
const latin = (s) => norm(s).replace(/[^a-z0-9]/g, '').length

const done = JSON.parse(readFileSync(donePath, 'utf8'))
const doubts = []
for (const leaf of done) {
  for (const u of leaf.uncertain ?? []) {
    if (!u.alternatives?.length) continue
    // The English either side, off the leaf's own blocks, for a span OCR will
    // have read as junk.
    let before = [],
      after = []
    const clean = u.text.replace(TAG, '')
    for (const b of leaf.blocks ?? []) {
      const t = (b.text ?? '').replace(TAG, '')
      const k = t.indexOf(clean)
      if (k < 0) continue
      before = t.slice(0, k).split(/\s+/).filter(Boolean).slice(-3)
      after = t
        .slice(k + clean.length)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
      break
    }
    doubts.push({
      leaf: leaf.pageIndex,
      text: u.text,
      alts: u.alternatives,
      reason: u.reason,
      before,
      after
    })
  }
}
if (doubts.length === 0) {
  writeFileSync(join(outDir, 'doubts.md'), '# Doubts\n\nNone named a rival reading.\n')
  console.log('no doubts with a rival reading')
  process.exit(0)
}

// OCR boxes for the leaves, from the recon cache.
const leaves = [...new Set(doubts.map((d) => d.leaf))]
const wordsOut = execFileSync('node', ['scripts/drive.mjs', 'words', ...leaves.map(String)], {
  cwd: ROOT,
  maxBuffer: 1 << 28
}).toString()
const words = JSON.parse(wordsOut).words ?? {}

/** Longest common subsequence ratio, the way difflib's SequenceMatcher scores. */
function ratio(a, b) {
  if (!a.length || !b.length) return 0
  const m = a.length,
    n = b.length
  let prev = new Uint16Array(n + 1)
  for (let i = 1; i <= m; i++) {
    const cur = new Uint16Array(n + 1)
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    prev = cur
  }
  return (2 * prev[n]) / (m + n)
}

const lines = [
  '# Doubts\n',
  `${doubts.length} spans name a rival reading. Read each crop and correct the batch file before landing it.\n`
]
let n = 0
for (const d of doubts) {
  const toks = words[String(d.leaf)]
  const id = `d${n++}`
  const row = (crop, note) =>
    lines.push(
      `## ${id} — leaf ${d.leaf}\n\n` +
        `- reads: \`${d.text}\`\n- rival: \`${d.alts.join('` / `')}\`\n- why: ${d.reason}\n` +
        (crop ? `\n![${id}](${crop})\n` : `\n_${note}_\n`)
    )
  if (!toks) {
    row(null, 'no OCR for this leaf in the cache')
    continue
  }
  const ntoks = toks.map((t) => norm(t.text))
  // Lean on the neighbours when the span itself has few Latin letters.
  const ownWords = d.text.replace(TAG, '').split(/\s+/).filter(Boolean).length
  const useCtx = latin(d.text) < 4
  const target =
    (useCtx ? d.before.map(norm).join('') : '') +
    norm(d.text) +
    (useCtx ? d.after.map(norm).join('') : '')
  const nWords = ownWords + (useCtx ? d.before.length + d.after.length : 0)
  let best = { r: 0, j0: -1, j1: -1 }
  for (let w = Math.max(1, nWords - 2); w <= nWords + 2; w++) {
    for (let j = 0; j + w <= toks.length; j++) {
      const cand = ntoks.slice(j, j + w).join('')
      if (!cand) continue
      const r = ratio(target, cand)
      if (r > best.r) best = { r, j0: j, j1: j + w }
    }
  }
  if (best.r < 0.55) {
    row(
      null,
      `could not be placed (best alignment ${best.r.toFixed(2)}); tokens: ` +
        toks
          .map((t, i) => `${i}:${t.text}`)
          .join(' ')
          .slice(0, 600)
    )
    continue
  }
  const box = toks.slice(best.j0, best.j1)
  const x0 = Math.min(...box.map((t) => t.x0)),
    x1 = Math.max(...box.map((t) => t.x1))
  const y0 = Math.min(...box.map((t) => t.y0)),
    y1 = Math.max(...box.map((t) => t.y1))
  const h = y1 - y0
  const px0 = Math.max(0, x0 - 40),
    px1 = Math.min(PAGE_W, x1 + 40)
  const py0 = Math.max(0, y0 - h * 0.5),
    py1 = Math.min(PAGE_H, y1 + h * 0.5)
  const dpi = px1 - px0 < 450 ? 1200 : 600
  const crop = `${(px0 / PAGE_W).toFixed(4)},${(py0 / PAGE_H).toFixed(4)},${((px1 - px0) / PAGE_W).toFixed(4)},${((py1 - py0) / PAGE_H).toFixed(4)}`
  const png = join(outDir, `${id}.png`)
  if (!existsSync(png)) {
    try {
      execFileSync('node', ['scripts/drive.mjs', 'leaf', String(d.leaf), id, String(dpi), crop], {
        cwd: ROOT,
        stdio: 'ignore',
        timeout: 300000
      })
      renameSync(join(ROOT, 'screenshots', `${id}.png`), png)
    } catch {
      row(null, `render failed at ${dpi} DPI for crop ${crop}; re-run to retry`)
      continue
    }
  }
  row(`${id}.png`, null)
}
writeFileSync(join(outDir, 'doubts.md'), lines.join('\n') + '\n')
console.log(`${doubts.length} doubts, index at ${join(outDir, 'doubts.md')}`)
