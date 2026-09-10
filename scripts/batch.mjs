/**
 * Split a drafted chapter into the batches a reading session hands to subagents.
 *
 * The reading is done by subagents (PROCESS-reading.md, Stage 5) and preparing
 * one used to be a page of throwaway shell in every session — which is how the
 * two things that actually decide the bill got forgotten. Both are measured:
 *
 * **Tell the reader to open its renders in blocks of at most eight, then write
 * once.** Over one chapter of *Isis Unveiled*, the same six leaves cost 29,216
 * tokens a leaf read one at a time and 22,519 read all at once, and the
 * expensive one found nothing the cheap one missed. Every turn re-sends the
 * accumulated context, so cost per leaf tracks *tool calls per leaf* almost
 * exactly and batch size barely matters beside it.
 *
 * **The render-loading turn times out, intermittently, and it is not a size
 * threshold.** On one chapter four batches died at exactly that line — three of
 * them opening fourteen images and one opening *seven* — while other batches of
 * six, seven, ten, twelve, thirteen and fourteen came through. Size raises the
 * risk and does not decide it, so there is no safe number to pick.
 *
 * What that means in practice: **keep the batch at the cheap size and expect to
 * relaunch one now and then.** Nothing is lost when it happens — the agent dies
 * before writing anything, so the output path does not exist and every other
 * batch is untouched. Splitting the load into two smaller blocks is worth
 * telling a reader to try on a retry; it is not worth paying for up front.
 *
 * **Give the reader a lean draft.** `structural` and the settled `hyphens` are
 * the parent's record, not the reader's material: the hyphens have already been
 * applied to the text, the unsettled ones belong in the brief by name, and two
 * `structural` lines repeat verbatim on every leaf. Taking both out puts the
 * draft at 80% of its size, and it is in context for every turn. Chapter III of
 * Isis read at **12,983 tokens a leaf** against Chapter I's ~26,000.
 *
 * What goes in a brief beyond that is what the deterministic rules **could not**
 * settle — the hyphens the volume attests both ways or neither, and the folios
 * its own numbering disputes — because those are the only places a reader with
 * the render is worth more than a lookup.
 *
 * ## Usage
 *
 *   node scripts/drive.mjs draft ch4.json 157 158 ... 182
 *   for n in $(seq 157 182); do node scripts/drive.mjs leaf $n ch4-$n 150; done
 *   node scripts/batch.mjs ch4.json out/ch4 --per 13 --renders out/ch4/leaves \
 *     --prefix ch4 --seam out/ch3-tail.txt
 *
 * Then give each `<letter>-brief.md` to one subagent, and check what comes back
 * before landing it:
 *
 *   node scripts/batch.mjs --check out/ch4/A-done.json out/ch4/A-draft.json
 *   node scripts/drive.mjs transcribe <scan.pdf> out/ch4/A-done.json
 *
 * `--check` is the half `transcribe` cannot do. `parsePageTranscription`
 * refuses a field it does not know and `verifyPage` compares the leaf against
 * OCR, but by then the notation has been parsed into word indices — so an
 * unclosed `<i>`, which `parseInlineMarkup` reads as "italic to the end of the
 * block" and reports nowhere, is invisible from that side. This runs over the
 * raw JSON, where the tags still exist.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}

/**
 * What came back from a reader, checked against what it was given.
 *
 * Deterministic and cheap, and it runs before anything is stored. Four things:
 *
 * - **Every leaf came back.** A batch quietly short of a leaf lands without
 *   complaint and the book has a hole in it.
 * - **Balanced inline markup.** `parseInlineMarkup` treats an unclosed `<i>` as
 *   marking the rest of the block — the least surprising reading of a typo, and
 *   silent. Here the tags still exist as text, so it can be counted.
 * - **Word drift against the draft.** The reader is correcting, not
 *   transcribing, so a leaf that moved more than a few per cent either dropped
 *   something or wrote something. `verifyPage` measures against OCR, which is a
 *   different and rougher comparison.
 * - **A footnote filed under one mark and opening with another.** The same rule
 *   `verifyPage` applies, asked early enough to stop the batch.
 */
function checkBatch(donePath, draftPath) {
  const done = JSON.parse(readFileSync(resolve(REPO, donePath), 'utf8'))
  const draft = draftPath
    ? new Map(
        JSON.parse(readFileSync(resolve(REPO, draftPath), 'utf8')).map((p) => [p.pageIndex, p])
      )
    : null

  const PAGE = new Set(['pageIndex', 'role', 'furniture', 'blocks', 'uncertain', 'queries'])
  const BLOCK = new Set(['kind', 'text', 'marker', 'cells'])
  const KINDS = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'verse',
    'footnote',
    'caption',
    'table'
  ])
  const problems = []
  const notes = []

  if (draft) {
    const back = new Set(done.map((p) => p.pageIndex))
    const absent = [...draft.keys()].filter((n) => !back.has(n))
    if (absent.length > 0) problems.push(`leaves missing from the reply: ${absent.join(', ')}`)
  }

  const words = (t) => t.split(/\s+/u).filter(Boolean).length
  for (const page of done) {
    const n = page.pageIndex
    for (const key of Object.keys(page)) {
      if (!PAGE.has(key)) problems.push(`leaf ${n}: unknown field \`${key}\``)
    }
    for (const [i, block] of page.blocks.entries()) {
      for (const key of Object.keys(block)) {
        if (!BLOCK.has(key)) problems.push(`leaf ${n} block ${i}: unknown field \`${key}\``)
      }
      if (!KINDS.has(block.kind)) problems.push(`leaf ${n} block ${i}: kind \`${block.kind}\``)
      for (const tag of ['i', 'b']) {
        const open = (block.text.match(new RegExp(`<${tag}>`, 'gu')) ?? []).length
        const close = (block.text.match(new RegExp(`</${tag}>`, 'gu')) ?? []).length
        if (open !== close) {
          problems.push(
            `leaf ${n} block ${i}: ${open} <${tag}> against ${close} </${tag}> — an unclosed ` +
              'tag marks the rest of the block and nothing downstream reports it'
          )
        }
      }
      if (/&(lt|gt|amp);/u.test(block.text)) {
        problems.push(`leaf ${n} block ${i}: HTML-escaped markup in the text`)
      }
      if (block.kind === 'footnote') {
        // Symbols only, never a digit. A note that opens `1 Kings, i. 1-4`
        // is citing a book of the Bible, not carrying the marker `1` — see
        // `printedMarker`, which learned the same lesson from leaf 275.
        const printed = /^\s*([*\u2020\u2021\u00a7\u00b6\u2016])/u.exec(block.text)
        if (block.marker && printed && printed[1] !== block.marker.trim()) {
          problems.push(
            `leaf ${n} block ${i}: filed under "${block.marker}" but opens "${printed[1]}"`
          )
        } else if (!block.marker) {
          // Not a problem, and it was one for an afternoon. **A note continued
          // from the leaf before prints no marker**, because the page does not
          // repeat it — so a markerless note at the head of a leaf's foot is
          // ordinary and blocking the batch on it is wrong. `verifyPage`
          // reports it low, which is the right weight; this only says it out
          // loud so the one case that *is* a mistake — a reader who left the
          // mark in the text and forgot the field — is visible.
          notes.push(
            `leaf ${n} block ${i}: footnote with no marker (a note continued from the leaf ` +
              `before prints none): ${JSON.stringify(block.text.slice(0, 50))}`
          )
        }
      }
    }
    if (draft?.has(n)) {
      const was = words(
        draft
          .get(n)
          .blocks.map((b) => b.text)
          .join(' ')
      )
      const now = words(page.blocks.map((b) => b.text).join(' '))
      const drift = was === 0 ? 0 : (now - was) / was
      const loud = Math.abs(drift) > 0.05
      console.log(
        `  leaf ${n}: ${was}w -> ${now}w (${(drift * 100).toFixed(1)}%) ` +
          `blocks ${draft.get(n).blocks.length}->${page.blocks.length} ` +
          `notes ${page.blocks.filter((b) => b.kind === 'footnote').length} ` +
          `q ${(page.queries ?? []).length}${loud ? '   <<< drift' : ''}`
      )
      if (loud) {
        problems.push(
          `leaf ${n}: ${(drift * 100).toFixed(1)}% word drift against the draft — a reader ` +
            'correcting a page does not move it that far'
        )
      }
    }
  }

  if (notes.length > 0) {
    console.log(`\n${notes.length} thing(s) worth an eye, none of them blocking:`)
    for (const note of notes) console.log(`  ${note}`)
  }
  if (problems.length === 0) {
    console.log(`\n${done.length} leaf/leaves, nothing to stop it. Land it.`)
    return 0
  }
  console.log(`\n${problems.length} problem(s):`)
  for (const p of problems) console.log(`  ${p}`)
  console.log('\nNothing was landed.')
  return 1
}

if (argv[0] === '--check') {
  const [donePath, draftPath] = argv.slice(1).filter((a) => !a.startsWith('--'))
  if (!donePath) {
    console.error('batch --check <done.json> [draft.json]')
    process.exit(2)
  }
  process.exit(checkBatch(donePath, draftPath ?? null))
}

const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
const [draftPath, outDir] = positional
if (!draftPath || !outDir) {
  console.error(
    'batch <draft.json> <out-dir> [--per 13] [--renders <dir>] [--prefix ch4] [--seam <file>]'
  )
  process.exit(2)
}

const per = Number(flag('per', '13'))
const rendersDir = flag('renders', join(outDir, 'leaves'))
const prefix = flag('prefix', 'leaf')
const seamPath = flag('seam')

const draft = JSON.parse(readFileSync(resolve(REPO, draftPath), 'utf8'))
if (!Array.isArray(draft) || draft.length === 0) {
  console.error(`${draftPath} is not a drafted chapter.`)
  process.exit(2)
}

/**
 * The two `structural` lines that say the same thing on every leaf.
 *
 * Both are in `BRIEF-reading.md` instead, said once. A line that appears on
 * every leaf of a batch is a line nobody reads, and it is in context for every
 * turn the reader takes.
 */
const BOILERPLATE = ['The role, and every block kind', 'line-break hyphen']

/** A reader handed a missing render will read the draft alone and invent. */
const missing = draft
  .map((leaf) => join(resolve(REPO, rendersDir), `${prefix}-${leaf.pageIndex}.png`))
  .filter((p) => !existsSync(p))
if (missing.length > 0) {
  console.error(
    `${missing.length} render(s) are not there, starting with ${missing[0]}.\n` +
      'Nothing was written: a reader handed a missing render reads the draft alone, ' +
      'which is the one thing this whole process exists to prevent.'
  )
  process.exit(1)
}

mkdirSync(resolve(REPO, outDir), { recursive: true })

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const batches = []
for (let i = 0; i < draft.length; i += per) batches.push(draft.slice(i, i + per))

const textOf = (leaf) => leaf.blocks.map((b) => b.text).join(' ')
const seamFromFile = seamPath ? readFileSync(resolve(REPO, seamPath), 'utf8').trim() : null

batches.forEach((leaves, n) => {
  const letter = LETTERS[n] ?? `B${n}`
  const first = leaves[0].pageIndex
  const last = leaves[leaves.length - 1].pageIndex

  const unsettled = leaves.flatMap((leaf) =>
    (leaf.hyphens ?? [])
      .filter((h) => h.decision === 'unsettled')
      .map((h) => `- leaf ${leaf.pageIndex}: \`${h.as}\``)
  )
  const folios = leaves.flatMap((leaf) =>
    (leaf.structural ?? [])
      .filter((s) => s.includes("volume's numbering predicts"))
      .map((s) => `- leaf ${leaf.pageIndex}: ${s}`)
  )

  // The lean copy. The full draft stays on disk as the parent's record.
  const lean = leaves.map((leaf) => {
    const rest = { ...leaf }
    delete rest.hyphens
    rest.structural = (leaf.structural ?? []).filter((s) => !BOILERPLATE.some((b) => s.includes(b)))
    return rest
  })
  writeFileSync(resolve(REPO, outDir, `${letter}-draft.json`), `${JSON.stringify(lean, null, 1)}\n`)

  // The seam: the previous batch's last leaf, or whatever was handed in for the
  // first. The *draft* of it, and the brief says so — a batch running in
  // parallel has not been checked yet, and a reader told otherwise would trust
  // a reading nobody has looked at.
  const previous = n === 0 ? null : batches[n - 1][batches[n - 1].length - 1]
  const seam = previous ? textOf(previous).slice(-450) : (seamFromFile ?? '').slice(-450)
  const seamSource = previous
    ? `the *draft* of leaf ${previous.pageIndex}, which another reader is checking in parallel`
    : 'the corrected text of the leaf before this batch'

  writeFileSync(
    resolve(REPO, outDir, `${letter}-brief.md`),
    `# Batch ${letter}: leaves ${first}–${last}

Read \`${resolve(REPO, 'docs/BRIEF-reading.md')}\` first. It is the whole method
and it is short.

## Your leaves

${leaves.map((l) => l.pageIndex).join(', ')} — ${leaves.length} of them.

- **The draft**: \`${resolve(REPO, outDir, `${letter}-draft.json`)}\`
- **The renders**: \`${resolve(REPO, rendersDir)}/${prefix}-<leaf>.png\`, one per leaf, 150 DPI
- **Write your result to**: \`${resolve(REPO, outDir, `${letter}-done.json`)}\`

## How to work

**Open your renders in one block**, before you write anything, then read them
all against their drafts and write the whole batch in one file write. This is
measured, not a preference: interleaving reading and writing leaf by leaf costs
about 30% more for the same leaves and finds nothing extra, because every turn
re-sends the whole accumulated context.

**If that request times out, open them in two smaller groups instead.** It
happens now and then and it is not your fault — four batches of one chapter died
at exactly that step, three opening fourteen images and one opening seven, while
batches of every size between six and fourteen came through. Nothing is lost
when it happens.

## The seam
${
  seam
    ? `
Your first leaf continues from this, which is ${seamSource}. Do not
re-transcribe it; use it only to judge whether your first block continues a
paragraph or opens one.

> …${seam}
`
    : `
Nothing was handed in for the seam, so judge your first block on its own: a
paragraph that opens mid-sentence is continuing one, and the leaf before it is
somebody else's.
`
}
## Folios the volume disputes
${
  folios.length > 0
    ? `
On these the folio the draft read disagrees with the volume's own numbering, and
it was **reported rather than changed** — a misread number and a book that
misnumbers its own leaf look the same from inside a draft, and a reprint does
not renumber its original. Read the number off the render and put the right one
in \`furniture.folio\`.

${folios.join('\n')}
`
    : `
None on your leaves: every folio agrees with the volume's own numbering.
`
}
## Hyphens the book could not settle
${
  unsettled.length > 0
    ? `
Still written \`foo- bar\` because neither the joined form nor the hyphenated one
appears anywhere else in the volume. Look at each on the render; several will be
OCR damage rather than a real word.

${unsettled.join('\n')}
`
    : `
None on your leaves: the volume settled every one of them.
`
}`
  )

  console.log(
    `${letter}: leaves ${first}–${last} (${leaves.length}), ` +
      `${unsettled.length} unsettled hyphen(s), ${folios.length} disputed folio(s)`
  )
})

console.log(
  `\n${batches.length} batch(es) in ${outDir}. Give each brief to one subagent; ` +
    'land each result with `drive.mjs transcribe`.'
)
