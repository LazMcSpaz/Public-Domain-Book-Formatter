/**
 * Build a cover from a spec file, headlessly: a JSON spec in, a PNG out.
 *
 * The cover studio (`#cover`) is where a cover is *designed*; this is for a
 * cover whose design is settled, wanted from a session rather than a screen.
 * It composes through the app's own modules in a real browser, so it is not a
 * second implementation of anything: `renderFrontCover` writes the same PDF
 * the studio's download button hands over and crops the front panel out of it.
 *
 *   npm run dev
 *   node scripts/cover-front.mjs <spec.json> <out.png> [--sheet] [--pdf <out.pdf>]
 *                                [--textures <folder>]
 *
 * `--sheet` writes the whole flat cover instead of the front panel. `--pdf`
 * writes the cover file itself beside the picture (it needs `--sheet`, since a
 * cover file is the whole sheet); the PNG is a raster of that exact PDF.
 *
 * The spec is a partial cover document (`trimSize`, `pageCount`, `paper`,
 * `binding`, `look`, `content`) merged over the defaults and normalised by
 * `normalizeLook`, so an old or hand-written spec cannot half-apply. The
 * script's own fields:
 *
 * - `device`: the emblem on the board, a file under `public/devices` (or
 *   `public/<folder>/<file>` when the name has a folder in it);
 * - `mark`: the printer's mark at the foot of the spine, the same way;
 * - `widthPx`: how wide the picture comes out;
 * - `pageCountMeasured`: true only when the page count came off the exported
 *   interior, which the spine check cannot find out for itself;
 * - `texture`: a book's own picture as the ground (`@core/cover` `texture.ts`
 *   says every field). Its `file` is found in `--textures <folder>`, or beside
 *   the spec when that is not given. The picture stays with the book: it is
 *   served to the page for this run only and never copied into the tools.
 *
 * A spec naming a built-in `groundFigure` or `groundPattern` the composer
 * does not have stops here with a message, rather than drawing a cover
 * without it.
 *
 * Chromium: `CHROMIUM_PATH` when set, otherwise Playwright's own
 * (`lib/chromium.mjs`). The dev server: `APP_URL`, default port 5173.
 */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { chromiumPath } from './lib/chromium.mjs'
import { readJson } from './lib/json-file.mjs'

const REPO = resolve(import.meta.dirname, '..')
// Vite serves source under `/@fs` by absolute path; on Windows that path needs
// a leading slash and forward slashes.
const PAGE_REPO = process.platform === 'win32' ? '/' + REPO.replace(/\\/g, '/') : REPO

const USAGE =
  'usage: node scripts/cover-front.mjs <spec.json> <out.png> [--sheet] [--pdf <out.pdf>] [--textures <folder>]'

/** The arguments, or a message saying what is wrong with them. */
function readArgs(args) {
  const valued = new Set(['--pdf', '--textures'])
  const flags = { sheet: false, pdf: null, textures: null }
  const positional = []
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--sheet') flags.sheet = true
    else if (valued.has(a)) {
      const value = args[i + 1]
      if (!value || value.startsWith('--')) return { error: `${a} wants a path after it` }
      flags[a.slice(2)] = value
      i += 1
    } else positional.push(a)
  }
  const [specPath, outPath] = positional
  if (!specPath || !outPath) return { error: USAGE }
  // A cover file carries the whole flat sheet, never the cropped front panel.
  if (flags.pdf && !flags.sheet)
    return { error: '--pdf is the whole flat cover, so it needs --sheet' }
  return { specPath, outPath, ...flags }
}

const parsed = readArgs(process.argv.slice(2))
if (parsed.error) {
  console.error(parsed.error)
  process.exit(2)
}
const { specPath, outPath, sheet, pdf: pdfPath } = parsed

const URL_BASE = process.env.APP_URL ?? 'http://localhost:5173'
const spec = await readJson(resolve(specPath))

/**
 * A device or mark from `public/`, as the look's press mark. The proportions
 * come from the SVG's own viewBox: the composer sizes the mark from them, so a
 * wrong ratio is a squashed seal.
 */
async function loadMark(name) {
  if (!name) return null
  const rel = name.includes('/') ? name : `devices/${basename(name)}`
  const file = resolve(REPO, 'public', rel)
  const svg = await readFile(file, 'utf8')
  const box = /viewBox="([\d.\s-]+)"/.exec(svg)
  if (!box) throw new Error(`${file} has no viewBox, so its proportions are unknown.`)
  const [, , w, h] = box[1].trim().split(/\s+/).map(Number)
  return {
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    widthPx: w,
    heightPx: h,
    fileName: basename(file)
  }
}

const TEXTURE_TYPES = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}
const TEXTURE_ROUTE = '/__cover-texture__/'

/**
 * The texture file a spec names, read from the folder the command was given.
 * Served to the page by a route for this run, rather than sent through the
 * debug protocol as base64, which a picture this size can kill the tab with.
 */
async function loadTexture() {
  const name = spec.texture?.file
  if (spec.texture === undefined) return null
  if (typeof name !== 'string' || !name.trim())
    return { error: 'texture.file must name the picture file.' }
  const folder = resolve(parsed.textures ?? dirname(resolve(specPath)))
  const file = resolve(folder, name)
  const type = TEXTURE_TYPES[extname(file).toLowerCase()]
  if (!type) return { error: `texture.file must be a png, jpg, webp or svg file: ${name}` }
  if (!existsSync(file)) {
    return { error: `texture file not found: ${file} (give its folder with --textures <folder>)` }
  }
  return {
    bytes: await readFile(file),
    type,
    url: `${TEXTURE_ROUTE}${encodeURIComponent(basename(file))}`,
    fileName: basename(file)
  }
}

const texture = await loadTexture()
if (texture?.error) {
  console.error(texture.error)
  process.exit(2)
}

// `device` is the emblem on the board; `mark` is the printer's own, at the
// foot of the spine. A spec naming only `device` behaves as it always did.
const frontMark = await loadMark(spec.device)
const mark = (await loadMark(spec.mark)) ?? frontMark

const executablePath = chromiumPath()
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox']
})
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
if (texture) {
  await page.route(`**${TEXTURE_ROUTE}*`, (route) =>
    route.fulfill({ status: 200, contentType: texture.type, body: texture.bytes })
  )
}

await page.goto(`${URL_BASE}/#cover`, { waitUntil: 'networkidle' })

const result = await page.evaluate(
  async ({ spec, mark, frontMark, repo, sheet, wantPdf, texture }) => {
    const core = await import(`/@fs${repo}/src/core/cover/index.ts`)
    const platform = await import(`/@fs${repo}/src/platform/browser/cover-preview.ts`)

    const named = spec.look?.groundFigure
    if (named && !core.GROUND_FIGURES.includes(named)) {
      return {
        error:
          `The spec names the ground figure "${named}", which the composer does not have. ` +
          `Built in: ${core.GROUND_FIGURES.join(', ')}. A book's own picture is given as a ` +
          '"texture" block naming its file instead.'
      }
    }

    const pattern = spec.look?.groundPattern
    if (pattern && !core.GROUND_PATTERNS.includes(pattern)) {
      return {
        error:
          `The spec names the ground pattern "${pattern}", which the composer does not have. ` +
          `Built in: ${core.GROUND_PATTERNS.join(', ')}. A book's own text as a ground is made ` +
          'with scripts/textground.mjs and given as a "texture" block (placement "wrap").'
      }
    }

    let doc = core.defaultCover(spec.trimSize ?? '6x9', spec.pageCount ?? 0)
    if (spec.paper) doc.paper = spec.paper
    // Paperback or hardcover: the same design on two objects, two runs.
    if (spec.binding) doc.binding = spec.binding
    doc.look = core.normalizeLook({
      ...doc.look,
      ...(spec.look ?? {}),
      ...(mark ? { pressMark: mark } : {}),
      ...(spec.mark && frontMark ? { frontMark } : {})
    })
    doc.content = { ...doc.content, ...(spec.content ?? {}), groundTexture: null }

    if (texture) {
      const read = core.readTextureSpec(spec.texture)
      if (!read.spec) return { error: read.problems.join('\n') }
      const img = new Image()
      img.src = texture.url
      await img.decode()
      doc = core.applyTexture(doc, read.spec, {
        src: texture.url,
        fileName: texture.fileName,
        widthPx: img.naturalWidth,
        heightPx: img.naturalHeight
      })
    }

    // The sheet comes back as an object URL and a PNG both; the front comes
    // back as bytes. Fetching the URL is how the sheet's pixels are got at.
    const front = sheet
      ? await (async () => {
          const preview = await platform.renderCoverPreview(doc, {
            scale: (spec.widthPx ?? 1000) / (72 * 12),
            pageCountMeasured: spec.pageCountMeasured === true
          })
          const blob = await (await fetch(preview.url)).blob()
          const bytes = new Uint8Array(await blob.arrayBuffer())
          platform.releaseCoverPreview(preview)
          return { ...preview, bytes, dpi: preview.widthPx / 12 }
        })()
      : await platform.renderFrontCover(doc, {
          widthPx: spec.widthPx ?? 1000,
          pageCountMeasured: spec.pageCountMeasured === true
        })
    const base64 = (bytes) => {
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary)
    }
    const box = front.composed.items.find(
      (i) => i.kind === 'image' && i.id === core.GROUND_FIGURE_ID
    )
    return {
      png: base64(front.bytes),
      pdf: wantPdf && front.pdf ? base64(front.pdf.bytes) : null,
      widthPx: front.widthPx,
      heightPx: front.heightPx,
      dpi: front.dpi,
      figureBoxIn: box ? [box.widthPt / 72, box.heightPt / 72] : null,
      warnings: front.composed.warnings,
      substitutions: front.substitutions,
      checks: front.validation.checks
        .filter((c) => c.level !== 'ok')
        .map((c) => `${c.level}: ${c.label} — ${c.detail}`)
    }
  },
  {
    spec,
    mark,
    frontMark,
    repo: PAGE_REPO,
    sheet,
    wantPdf: pdfPath !== null,
    texture: texture ? { url: texture.url, fileName: texture.fileName } : null
  }
)
await browser.close()

if (result.error) {
  console.error(result.error)
  process.exit(2)
}
await writeFile(resolve(outPath), Buffer.from(result.png, 'base64'))
if (pdfPath) {
  if (!result.pdf) {
    console.error('the composer returned no PDF for this cover')
    process.exit(1)
  }
  await writeFile(resolve(pdfPath), Buffer.from(result.pdf, 'base64'))
}

console.log(
  `${outPath}: ${result.widthPx} × ${result.heightPx} px, ${Math.round(result.dpi)} DPI across the printed front.`
)
if (result.figureBoxIn) {
  const [w, h] = result.figureBoxIn
  console.log(`  ground figure box: ${w.toFixed(4)} × ${h.toFixed(4)} in`)
}
for (const w of result.warnings) console.log(`  warning: ${w}`)
for (const [asked, used] of result.substitutions) console.log(`  substituted: ${asked} → ${used}`)
for (const c of result.checks) console.log(`  ${c}`)

if (errors.length > 0) {
  console.error(`\n${errors.length} console error(s):\n${errors.join('\n')}`)
  process.exit(1)
}
