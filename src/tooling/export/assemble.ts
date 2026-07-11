/**
 * Export orchestrator (SPEC §3 → §10).
 *
 * The end-to-end glue that turns a saved project + a style profile into a
 * validated, print-ready KDP interior PDF:
 *
 *   1. write the Markdown intermediate to the build dir
 *   2. pandoc: Markdown → LaTeX *body fragment*
 *   3. resolve the reusable style, build the TOC, and convert each chosen
 *      ornament SVG → vector PDF into the build dir
 *   4. assemble the full LaTeX document (preamble + front matter + body)
 *   5. xelatex: typeset → collect quality warnings + the final page count
 *   6. derive image effective-DPI inputs from accepted illustration regions
 *   7. run the honest KDP validation checks
 *   8. return the ExportResult
 *
 * Every external tool runs through the injectable `CommandRunner` seam, so the
 * whole pipeline is unit-testable with NO TeX / pandoc / rsvg-convert installed.
 */
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type { ExportResult, ProjectFile, StyleProfile } from '@core/model'
import { buildToc, assembleBody, confirmedHeadings, type BodyInsert } from '@core/structure'
import { resolveStyle } from '@core/style'
import {
  buildLatexDocument,
  validateKdp,
  textWidthIn,
  figureWidthIn,
  figureLatex,
  pageTextEndOffsets
} from '@core/typeset'
import { BUILTIN_ORNAMENTS, resolveOrnamentPaths } from '@core/ornament'
import { runCommand, type CommandResult, type CommandRunner } from '../process'
import { markdownToLatex } from '../wrappers/pandoc'
import { typeset, parseLogWarnings } from '../wrappers/xelatex'
import { svgToPdf } from '../wrappers/svg2pdf'
import { cropPageRegion } from '../wrappers/pdf-extract'

export interface AssembleOptions {
  project: ProjectFile
  /** Project root on disk (resolves relative asset/ornament paths). */
  projectPath: string
  profile: StyleProfile
  /** Scratch directory for body.md / *.tex / converted ornaments / the PDF. */
  buildDir: string
  run?: CommandRunner
}

/**
 * Parse the final interior page count from a XeLaTeX log.
 *
 * XeLaTeX prints `Output written on book.pdf (123 pages, 456789 bytes).` at the
 * end of a successful run. Match the page count regardless of the PDF basename.
 * Returns 0 when no such line is present (e.g. the run failed before output).
 */
export function parsePageCount(log: string): number {
  const match = log.match(/Output written on [^(]*\((\d+)\s+pages?/i)
  if (!match) return 0
  const n = Number.parseInt(match[1]!, 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Collect effective-DPI inputs from accepted illustration regions, in the shape
 * `validateKdp` expects. Where the source page DPI is known we report it (the
 * region is reproduced at source resolution); otherwise the entry carries a null
 * effective DPI so `validateKdp` flags it as unknown rather than silently
 * passing. Only human-accepted regions are placed in the export (SPEC §6).
 */
function collectImageInputs(project: ProjectFile): { effectiveDpi: number | null }[] {
  const inputs: { effectiveDpi: number | null }[] = []
  for (const page of project.pages) {
    for (const region of page.regions) {
      if (region.accepted !== true) continue
      inputs.push({ effectiveDpi: page.dpi })
    }
  }
  return inputs
}

/**
 * Crop every accepted image region out of the source PDF (at the region's
 * capture DPI, so no upscaling) and return figure inserts positioned after each
 * region's page in the text. Entirely best-effort: if the source PDF is missing
 * or a crop fails, that image is skipped and the export proceeds text-only — an
 * illustration must never break the whole book. The emitted figures are also
 * `\IfFileExists`-guarded so a crop that didn't land is skipped at typeset time.
 */
async function placeImages(
  project: ProjectFile,
  projectPath: string,
  buildDir: string,
  profile: StyleProfile,
  run: CommandRunner
): Promise<BodyInsert[]> {
  const pdfRef = project.source?.pdfPath
  if (!pdfRef) return []
  const pdfPath = path.isAbsolute(pdfRef) ? pdfRef : path.join(projectPath, pdfRef)
  try {
    await fs.access(pdfPath)
  } catch {
    return [] // source PDF not reachable — export text-only
  }

  const maxWidthIn = textWidthIn(profile)
  const ends = pageTextEndOffsets(project.coordinateMap)
  const fallback = project.markdown.length
  const inserts: BodyInsert[] = []
  let n = 0

  for (const page of project.pages) {
    for (const region of page.regions) {
      if (region.accepted !== true) continue
      const b = region.bbox
      const x = Math.min(b.x0, b.x1)
      const y = Math.min(b.y0, b.y1)
      const w = Math.abs(b.x1 - b.x0)
      const h = Math.abs(b.y1 - b.y0)
      if (w < 1 || h < 1) continue

      const name = `img-${n++}`
      const outPrefix = path.join(buildDir, name)
      const dpi = page.dpi ?? 300
      try {
        await cropPageRegion(pdfPath, outPrefix, { page: page.index + 1, dpi, x, y, w, h }, run)
      } catch {
        continue // this crop failed; skip just this image
      }
      const widthIn = figureWidthIn(w, dpi, maxWidthIn)
      inserts.push({
        offset: ends.get(page.index) ?? fallback,
        block: figureLatex(`${name}.png`, widthIn)
      })
    }
  }
  return inserts
}

/**
 * Assemble and export the project to a validated KDP PDF.
 */
export async function assembleAndExport(opts: AssembleOptions): Promise<ExportResult> {
  const { project, projectPath, profile, buildDir } = opts
  const run = opts.run ?? runCommand

  await fs.mkdir(buildDir, { recursive: true })

  const resolvedStyle = resolveStyle(profile, project.config)

  // (0) Crop accepted image regions from the source scan into the build dir and
  // build the figure inserts. Best-effort: any failure leaves the export
  // text-only rather than breaking it (see placeImages).
  const imageInserts = await placeImages(project, projectPath, buildDir, resolvedStyle, run)

  // (1) Markdown intermediate → build dir. Inject the confirmed structure
  // (headings/quotes/verse) plus the image figures as Markdown/LaTeX so Pandoc
  // produces real chapters/TOC/running heads and placed illustrations; this is
  // an export-only copy — the stored project markdown/map are untouched.
  const bodyMdPath = path.join(buildDir, 'body.md')
  const exportMarkdown = assembleBody(project.markdown, project.tags, imageInserts)
  await fs.writeFile(bodyMdPath, exportMarkdown, 'utf8')

  // (2) pandoc: Markdown → LaTeX *body fragment* (standalone:false), written to
  // body.tex, with level-1 headings mapped to \chapter. The wrapper also returns
  // its stdout; prefer reading the file back (the canonical fragment) and fall
  // back to stdout when no file landed.
  const bodyTexPath = path.join(buildDir, 'body.tex')
  const pandocStdout = await markdownToLatex(
    exportMarkdown,
    {
      inputPath: bodyMdPath,
      outputPath: bodyTexPath,
      standalone: false,
      topLevelDivisionChapter: true
    },
    run
  )
  let bodyLatex: string
  try {
    bodyLatex = await fs.readFile(bodyTexPath, 'utf8')
  } catch {
    bodyLatex = pandocStdout
  }

  // (3) build TOC, convert chosen ornaments SVG → vector PDF.
  // TOC is driven by the confirmed headings (the same ones injected into the
  // body), so an empty/unstructured book gets no Contents page. Actual page
  // numbers come from the native \tableofcontents after multi-pass typesetting.
  const toc = buildToc(confirmedHeadings(project.tags), project.markdown)

  // Convert only the ornaments this profile actually uses, in choice order.
  const chosenIds = [
    profile.ornaments.chapterOpener,
    profile.ornaments.sectionDivider,
    profile.ornaments.pageNumber
  ]
  const convertedSvgs = new Set<string>()
  for (const id of chosenIds) {
    if (!id) continue
    const ornament = BUILTIN_ORNAMENTS.find((o) => o.id === id)
    if (!ornament) continue
    if (convertedSvgs.has(ornament.file)) continue
    convertedSvgs.add(ornament.file)
    const svgPath = path.join(projectPath, 'resources', 'ornaments', ornament.file)
    const outPdf = path.join(buildDir, path.basename(ornament.file).replace(/\.svg$/i, '') + '.pdf')
    await svgToPdf(svgPath, outPdf, run)
  }
  const ornamentPaths = resolveOrnamentPaths(profile.ornaments, BUILTIN_ORNAMENTS, buildDir)

  // (4) assemble the full LaTeX document → book.tex.
  const bookTex = buildLatexDocument({
    profile: resolvedStyle,
    config: project.config,
    frontMatter: project.frontMatter,
    toc,
    bodyLatex,
    ornamentPaths: {
      chapterOpener: ornamentPaths.chapterOpener,
      sectionDivider: ornamentPaths.sectionDivider,
      pageNumber: ornamentPaths.pageNumber
    }
  })
  const bookTexPath = path.join(buildDir, 'book.tex')
  await fs.writeFile(bookTexPath, bookTex, 'utf8')

  // (5) xelatex: typeset → warnings + final page count.
  // Wrap the runner so we keep the raw xelatex output (the wrapper only returns
  // pdfPath + parsed warnings). The page count is parsed from that output, or
  // from the on-disk `book.log` when present (richer than the streamed output).
  let xelatexOutput = ''
  const capturingRun: CommandRunner = async (cmd, args, runOpts) => {
    const result: CommandResult = await run(cmd, args, runOpts)
    if (cmd === 'xelatex') {
      xelatexOutput = `${result.stdout}\n${result.stderr}`
    }
    return result
  }
  // Three passes: (1) writes .aux/.toc, (2) resolves TOC + running heads,
  // (3) settles any page shifts the TOC's own length introduced.
  const typesetResult = await typeset('book.tex', buildDir, { passes: 3 }, capturingRun)

  let logText = ''
  try {
    logText = await fs.readFile(path.join(buildDir, 'book.log'), 'utf8')
  } catch {
    logText = ''
  }
  const logForParsing = logText || xelatexOutput
  const warnings = logForParsing ? parseLogWarnings(logForParsing) : typesetResult.warnings
  const pageCount = parsePageCount(logForParsing)

  // (6) image effective-DPI inputs from accepted regions.
  const images = collectImageInputs(project)

  // (7) honest KDP validation.
  const validation = validateKdp({
    profile,
    pageCount,
    images,
    warnings,
    fontsEmbedded: true
  })

  // (8) result.
  return {
    pdfPath: typesetResult.pdfPath,
    pageCount,
    validation
  }
}
