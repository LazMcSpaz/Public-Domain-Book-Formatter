/**
 * One reading brief per batch of leaves.
 *
 * What a reader gets: the leaf image, the draft off our OCR, the second
 * engine's reading of the same leaf, and the places the two disagree. What it
 * must never get is a hypothesis about what the text ought to say — the job
 * is "here is an image and here is a text, where do they differ".
 *
 *   node scripts/reading-kit/brief.mjs <kit> <ruled.json> <from> <to> [size=5]
 *
 * `<kit>` is the working directory (see README.md): `second.json` and
 * `witness.json` are read from it, the 400 DPI renders from `<kit>/shots/`
 * (`hi-NNN.png`, as `drive.mjs leaf N hi-N 400` names them), and the briefs
 * are written to `<kit>/briefs/`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , kit, draftPath, from, to, size = '5'] = process.argv
if (!kit || !draftPath || !from || !to) {
  console.error('usage: brief.mjs <kit> <ruled.json> <from> <to> [size]')
  process.exit(2)
}
const K = resolve(kit)
const pages = JSON.parse(readFileSync(draftPath, 'utf8'))
const second = JSON.parse(readFileSync(`${K}/second.json`, 'utf8'))
const witness = JSON.parse(readFileSync(`${K}/witness.json`, 'utf8'))
const byLeaf = new Map(witness.leaves.map((L) => [L.leaf, L]))
const pad = (n) => String(n).padStart(3, '0')

mkdirSync(`${K}/briefs`, { recursive: true })
const step = Number(size)
const batches = []
let missing = 0
for (let start = Number(from); start <= Number(to); start += step) {
  const end = Math.min(start + step - 1, Number(to))
  const leaves = pages.filter((p) => p.pageIndex >= start && p.pageIndex <= end)
  if (leaves.length === 0) continue
  const brief = leaves.map((p) => {
    const L = byLeaf.get(p.pageIndex)
    const rows = (L?.disagreements ?? [])
      .filter((g) => g.kind === 'substantive')
      .map((g) => ({ ours: g.first, other: g.second }))
    const image = `${K}/shots/hi-${pad(p.pageIndex)}.png`
    if (!existsSync(image)) missing += 1
    return {
      leaf: p.pageIndex,
      image,
      blocks: p.blocks.map((b, i) => ({ i, kind: b.kind, text: b.text })),
      secondReader: second[String(p.pageIndex)] ?? '',
      disagreements: rows
    }
  })
  const name = `${pad(start)}-${pad(end)}`
  writeFileSync(`${K}/briefs/${name}.json`, JSON.stringify(brief, null, 1) + '\n')
  batches.push({
    name,
    leaves: brief.length,
    rows: brief.reduce((s, b) => s + b.disagreements.length, 0)
  })
}
for (const b of batches) console.log(`  ${b.name}  ${b.leaves} leaves, ${b.rows} disagreements`)
if (missing) {
  console.error(
    `${missing} leaf image(s) missing under ${K}/shots — render them before dispatching`
  )
  process.exit(1)
}
