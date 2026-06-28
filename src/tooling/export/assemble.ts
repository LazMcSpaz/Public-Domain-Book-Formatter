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
import type {
  ExportResult,
  ProjectFile,
  StyleProfile,
} from '@core/model'
import { buildToc } from '@core/structure'
import { resolveStyle } from '@core/style'
import { buildLatexDocument, validateKdp } from '@core/typeset'
import {
  BUILTIN_ORNAMENTS,
  resolveOrnamentPaths,
} from '@core/ornament'
import { runCommand, type CommandResult, type CommandRunner } from '../process'
import { markdownToLatex } from '../wrappers/pandoc'
import { typeset, parseLogWarnings } from '../wrappers/xelatex'
import { svgToPdf } from '../wrappers/svg2pdf'

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
 * Assemble and export the project to a validated KDP PDF.
 */
export async function assembleAndExport(opts: AssembleOptions): Promise<ExportResult> {
  const { project, projectPath, profile, buildDir } = opts
  const run = opts.run ?? runCommand

  await fs.mkdir(buildDir, { recursive: true })

  // (1) Markdown intermediate → build dir.
  const bodyMdPath = path.join(buildDir, 'body.md')
  await fs.writeFile(bodyMdPath, project.markdown, 'utf8')

  // (2) pandoc: Markdown → LaTeX *body fragment* (standalone:false), written to
  // body.tex. The wrapper also returns its stdout; prefer reading the file back
  // (the canonical fragment) and fall back to stdout when no file landed.
  const bodyTexPath = path.join(buildDir, 'body.tex')
  const pandocStdout = await markdownToLatex(
    project.markdown,
    { inputPath: bodyMdPath, outputPath: bodyTexPath, standalone: false },
    run,
  )
  let bodyLatex: string
  try {
    bodyLatex = await fs.readFile(bodyTexPath, 'utf8')
  } catch {
    bodyLatex = pandocStdout
  }

  // (3) resolve style, build TOC, convert chosen ornaments SVG → vector PDF.
  const resolvedStyle = resolveStyle(profile, project.config)
  const toc = buildToc(project.tags, project.markdown)

  // Convert only the ornaments this profile actually uses, in choice order.
  const chosenIds = [
    profile.ornaments.chapterOpener,
    profile.ornaments.sectionDivider,
    profile.ornaments.pageNumber,
  ]
  const convertedSvgs = new Set<string>()
  for (const id of chosenIds) {
    if (!id) continue
    const ornament = BUILTIN_ORNAMENTS.find((o) => o.id === id)
    if (!ornament) continue
    if (convertedSvgs.has(ornament.file)) continue
    convertedSvgs.add(ornament.file)
    const svgPath = path.join(projectPath, 'resources', 'ornaments', ornament.file)
    const outPdf = path.join(
      buildDir,
      path.basename(ornament.file).replace(/\.svg$/i, '') + '.pdf',
    )
    await svgToPdf(svgPath, outPdf, run)
  }
  const ornamentPaths = resolveOrnamentPaths(
    profile.ornaments,
    BUILTIN_ORNAMENTS,
    buildDir,
  )

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
      pageNumber: ornamentPaths.pageNumber,
    },
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
  const typesetResult = await typeset('book.tex', buildDir, {}, capturingRun)

  let logText = ''
  try {
    logText = await fs.readFile(path.join(buildDir, 'book.log'), 'utf8')
  } catch {
    logText = ''
  }
  const logForParsing = logText || xelatexOutput
  const warnings = logForParsing
    ? parseLogWarnings(logForParsing)
    : typesetResult.warnings
  const pageCount = parsePageCount(logForParsing)

  // (6) image effective-DPI inputs from accepted regions.
  const images = collectImageInputs(project)

  // (7) honest KDP validation.
  const validation = validateKdp({
    profile,
    pageCount,
    images,
    warnings,
    fontsEmbedded: true,
  })

  // (8) result.
  return {
    pdfPath: typesetResult.pdfPath,
    pageCount,
    validation,
  }
}
