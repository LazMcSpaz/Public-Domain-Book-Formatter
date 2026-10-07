/**
 * Build a front cover from a spec file, headlessly.
 *
 * The cover studio is where a cover is *designed*; this is for the other
 * occasion — a cover whose design is already settled, wanted as a picture, from
 * a session rather than from a screen. It is the driver's shape rather than the
 * studio's: a JSON spec in, a PNG out, no clicking.
 *
 * It composes through the app's own modules in a real browser, so it is not a
 * second implementation of anything: `renderFrontCover` writes the same PDF the
 * studio's download button hands over and crops the front panel out of it.
 * Nothing here draws.
 *
 *   npm run dev
 *   node scripts/cover-front.mjs spec.json out.png
 *
 * `--sheet` writes the whole flat cover instead of the front panel — the same
 * bytes, uncropped — for the one question a front cannot answer: whether the
 * back and the fold are right.
 *
 * The spec is a partial cover document — `trimSize`, `pageCount`, `paper`,
 * `look`, `content` — merged over the shipped defaults and normalised by
 * `normalizeLook`, so an old or hand-written spec cannot half-apply. Two fields
 * are the script's own: `device`, a file name under `public/devices`, which is
 * read here and handed over as the look's press mark; and `widthPx`, how wide
 * the picture should come out. A third, `pageCountMeasured`, says the page
 * count was taken off a typeset interior rather than guessed, which is the one
 * thing the spine check cannot find out for itself: set it only when the
 * number came from the exported book.
 */
import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

/** Vite serves source under `/@fs` by absolute path; `/src/...` is the app's own tree. */
const REPO = process.cwd()

const args = process.argv.slice(2)
const sheet = args.includes('--sheet')
const [specPath, outPath] = args.filter((a) => a !== '--sheet')
if (!specPath || !outPath) {
  console.error('usage: node scripts/cover-front.mjs <spec.json> <out.png> [--sheet]')
  process.exit(2)
}

const URL_BASE = process.env.APP_URL ?? 'http://localhost:5173'
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const spec = JSON.parse(await readFile(resolve(specPath), 'utf8'))

/**
 * A device from `public/devices`, as the look's press mark.
 *
 * The proportions come from the SVG's own viewBox rather than being assumed:
 * the composer sizes the mark from them, so a wrong ratio is a squashed seal.
 */
let mark = null
if (spec.device) {
  const file = resolve('public/devices', basename(spec.device))
  const svg = await readFile(file, 'utf8')
  const box = /viewBox="([\d.\s-]+)"/.exec(svg)
  if (!box) throw new Error(`${file} has no viewBox, so its proportions are unknown.`)
  const [, , w, h] = box[1].trim().split(/\s+/).map(Number)
  mark = {
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    widthPx: w,
    heightPx: h,
    fileName: basename(file)
  }
}

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(`${URL_BASE}/#cover`, { waitUntil: 'networkidle' })

const result = await page.evaluate(
  async ({ spec, mark, repo, sheet }) => {
    const core = await import(`/@fs${repo}/src/core/cover/index.ts`)
    const platform = await import(`/@fs${repo}/src/platform/browser/cover-preview.ts`)

    const doc = core.defaultCover(spec.trimSize ?? '6x9', spec.pageCount ?? 0)
    if (spec.paper) doc.paper = spec.paper
    doc.look = core.normalizeLook({
      ...doc.look,
      ...(spec.look ?? {}),
      ...(mark ? { pressMark: mark } : {})
    })
    doc.content = { ...doc.content, ...(spec.content ?? {}) }

    // The sheet comes back as an object URL and a PNG both; the front comes
    // back as bytes, because an icon is made to be stored. Fetching the URL is
    // how the sheet's pixels are got at from here.
    const front = sheet
      ? await (async () => {
          const preview = await platform.renderCoverPreview(doc, {
            scale: (spec.widthPx ?? 1000) / (72 * 12),
            // Only when the spec says the count came off a typeset interior.
            // Left out, the spine check reports `pending` on every cover this
            // script draws, which is a check nobody can learn anything from.
            pageCountMeasured: spec.pageCountMeasured === true
          })
          const blob = await (await fetch(preview.url)).blob()
          const bytes = new Uint8Array(await blob.arrayBuffer())
          platform.releaseCoverPreview(preview)
          return { ...preview, bytes, dpi: preview.widthPx / 12 }
        })()
      : await platform.renderFrontCover(doc, { widthPx: spec.widthPx ?? 1000 })
    let binary = ''
    for (const byte of front.bytes) binary += String.fromCharCode(byte)
    return {
      png: btoa(binary),
      widthPx: front.widthPx,
      heightPx: front.heightPx,
      dpi: front.dpi,
      warnings: front.composed.warnings,
      substitutions: front.substitutions,
      checks: front.validation.checks
        .filter((c) => c.level !== 'ok')
        .map((c) => `${c.level}: ${c.label} — ${c.detail}`)
    }
  },
  { spec, mark, repo: REPO, sheet }
)

await writeFile(resolve(outPath), Buffer.from(result.png, 'base64'))
await browser.close()

console.log(
  `${outPath}: ${result.widthPx} × ${result.heightPx} px, ${Math.round(result.dpi)} DPI across the printed front.`
)
for (const w of result.warnings) console.log(`  warning: ${w}`)
for (const [asked, used] of result.substitutions) console.log(`  substituted: ${asked} → ${used}`)
for (const c of result.checks) console.log(`  ${c}`)

if (errors.length > 0) {
  console.error(`\n${errors.length} console error(s):\n${errors.join('\n')}`)
  process.exit(1)
}
