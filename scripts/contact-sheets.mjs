/**
 * Every leaf of a book, small, many to a sheet — the one check that answers
 * "is there a picture we have missed?"
 *
 * `drive.mjs figures` reads out what the ink detector found while recon had the
 * page in hand, and that is a shortlist rather than a check: measured over *Isis
 * Unveiled* Vol. I it offers 35 candidates and finds one of the three plates the
 * reading knew about. The miss mode is structural — `detectRegions` looks for
 * rectangles with no *words* in them, and a figure with text run around it has
 * words on every side of it. Leaf 193 of that volume is exactly that, and it is
 * invisible to the ink test, invisible to a scan for the OCR junk a plate
 * usually leaves behind, and perfectly obvious to anyone who looks at the leaf.
 *
 * So this renders the lot and tiles them. 628 leaves came to 18 sheets, and the
 * amulet on 193 is unmistakable on its sheet at a twentieth of full size: a
 * shape among even grey columns is what the eye is best at and no ink fraction
 * is any good at.
 *
 * What it is honest about: the reduction. A half-page figure survives it. A
 * two-line diagram or a small inline cut may not, so a clean sweep is a floor
 * and not a census — say so rather than reporting a book plateless.
 *
 * Chromium does the tiling because it is already here and because writing a PNG
 * encoder to do it would be a second renderer for no reason.
 *
 *   node scripts/contact-sheets.mjs <renders-dir> <out-dir> [--per 36] [--cols 6]
 *
 * `renders-dir` is searched recursively for files named `<anything>-<leaf>.png`,
 * which is what the render helpers here already produce.
 */
import { chromium } from 'playwright'
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Playwright's own download is skipped in this image; this is what is here. */
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

function findRenders(dir) {
  const out = new Map()
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        const m = /^.*?-(\d+)\.png$/.exec(e.name)
        // First one wins, so a directory listed earlier is preferred; every
        // render of a leaf is the same leaf, so which one is arbitrary.
        if (m && !out.has(Number(m[1]))) out.set(Number(m[1]), p)
      }
    }
  }
  walk(dir)
  return out
}

const [rendersDir, outDir, ...rest] = process.argv.slice(2)
if (!rendersDir || !outDir) {
  console.error('contact-sheets <renders-dir> <out-dir> [--per 36] [--cols 6]')
  process.exit(2)
}
const arg = (name, fallback) => {
  const i = rest.indexOf(name)
  return i >= 0 ? Number(rest[i + 1]) : fallback
}
const per = arg('--per', 36)
const cols = arg('--cols', 6)

const renders = findRenders(resolve(rendersDir))
const leaves = [...renders.keys()].sort((a, b) => a - b)
if (leaves.length === 0) {
  console.error(`No renders under ${rendersDir} — expected files named <name>-<leaf>.png`)
  process.exit(1)
}
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

const groups = []
for (let i = 0; i < leaves.length; i += per) groups.push(leaves.slice(i, i + per))

const browser = await chromium.launch({
  executablePath: CHROME,
  // The sheet loads its images off disk, which is the whole point of it.
  args: ['--no-sandbox', '--allow-file-access-from-files']
})
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } })
const written = []
for (const [k, group] of groups.entries()) {
  const cells = group
    .map(
      (n) => `<figure><img src="file://${renders.get(n)}"><figcaption>${n}</figcaption></figure>`
    )
    .join('')
  const html =
    `<meta charset="utf-8"><style>` +
    `body{margin:0;background:#fff;font:11px/1.2 monospace}` +
    `.grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;padding:6px}` +
    `figure{margin:0}img{width:100%;display:block;border:1px solid #bbb}` +
    `figcaption{text-align:center;padding:1px 0 3px;color:#333}` +
    `</style><div class="grid">${cells}</div>`
  const name = `sheet-${String(k).padStart(2, '0')}`
  writeFileSync(join(outDir, `${name}.html`), html)
  await page.goto(`file://${resolve(outDir, `${name}.html`)}`)
  // Not `load`: the images are the sheet, and shooting before they paint
  // produces 36 empty boxes and a clean-looking sweep that saw nothing.
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true })
  written.push({ sheet: name, first: group[0], last: group[group.length - 1] })
}
await browser.close()

console.log(
  JSON.stringify(
    {
      leaves: leaves.length,
      firstLeaf: leaves[0],
      lastLeaf: leaves[leaves.length - 1],
      sheets: written,
      next: 'Look at every sheet. A figure is a shape among even grey columns.'
    },
    null,
    1
  )
)
