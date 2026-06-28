/**
 * The XeLaTeX document builder (SPEC §7/§8).
 *
 * Assembles a complete, standalone XeLaTeX source from a resolved style profile,
 * per-book config, front-matter fields, an auto TOC, and the Pandoc body
 * fragment. It configures:
 *   - `geometry` from trim size + margins + gutter,
 *   - `fontspec` body/heading fonts at the profile body size,
 *   - `fancyhdr` running heads honoring verso/recto modes and page-number pos,
 *   - templated title + copyright pages (gated by front-matter toggles),
 *   - an auto TOC rendered from the discarded-original / rebuilt entries,
 *   - chapter-opener + section-divider ornament hooks (\includegraphics),
 * then includes the body fragment.
 *
 * Pure string builder: no I/O, all interpolated content escaped.
 */
import type { FrontMatterFields, PerBookConfig, StyleProfile, TocEntry } from '@core/model'
import { escapeLatex, escapeLatexValue } from './escape'

export interface LatexDocumentInput {
  profile: StyleProfile
  config: PerBookConfig
  frontMatter: FrontMatterFields
  toc: TocEntry[]
  /** The Pandoc-produced LaTeX body fragment. */
  bodyLatex: string
  /** Resolved on-disk paths (PDF form) for selected ornaments, if any. */
  ornamentPaths?: {
    chapterOpener?: string | null
    sectionDivider?: string | null
    pageNumber?: string | null
  }
}

/** Parsed trim dimensions in inches. */
interface TrimDimensions {
  widthIn: number
  heightIn: number
}

/**
 * Parse a trim token like "6x9" → 6in × 9in. Accepts `x` or `×` separators and
 * optional decimals (e.g. "5.5x8.5"). Falls back to 6×9 on anything unparseable.
 */
export function parseTrimSize(token: string): TrimDimensions {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*$/i.exec(token)
  if (!m) {
    return { widthIn: 6, heightIn: 9 }
  }
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { widthIn: 6, heightIn: 9 }
  }
  return { widthIn: w, heightIn: h }
}

function fmtIn(n: number): string {
  // Trim trailing zeros for clean source, keep up to 3 decimals.
  return `${Number(n.toFixed(3))}in`
}

/** The fancyhdr field expression for one running-head mode. */
function runningHeadField(mode: StyleProfile['runningHeads']['verso']): string {
  switch (mode) {
    case 'none':
      return ''
    case 'bookTitle':
      return '\\thebooktitle'
    case 'author':
      return '\\theauthor'
    case 'chapterTitle':
      return '\\leftmark'
    case 'pageNumber':
      return '\\thepage'
    default:
      return ''
  }
}

function geometryBlock(profile: StyleProfile): string {
  const trim = parseTrimSize(profile.trimSize)
  const m = profile.margins
  const inner = m.inner + profile.gutter
  const opts = [
    `paperwidth=${fmtIn(trim.widthIn)}`,
    `paperheight=${fmtIn(trim.heightIn)}`,
    `top=${fmtIn(m.top)}`,
    `bottom=${fmtIn(m.bottom)}`,
    `inner=${fmtIn(inner)}`,
    `outer=${fmtIn(m.outer)}`
  ]
  return `\\usepackage[${opts.join(',')}]{geometry}`
}

function fontBlock(profile: StyleProfile): string {
  const body = escapeLatexValue(profile.bodyFont)
  const heading = escapeLatexValue(profile.headingFont)
  return [
    '\\usepackage{fontspec}',
    `\\setmainfont{${body}}`,
    `\\newfontfamily\\headingfont{${heading}}`
  ].join('\n')
}

function fancyhdrBlock(profile: StyleProfile): string {
  const lines: string[] = ['\\usepackage{fancyhdr}', '\\pagestyle{fancy}', '\\fancyhf{}']

  const verso = runningHeadField(profile.runningHeads.verso)
  const recto = runningHeadField(profile.runningHeads.recto)
  if (verso) lines.push(`\\fancyhead[LE]{${verso}}`)
  if (recto) lines.push(`\\fancyhead[RO]{${recto}}`)

  // Page-number treatment (SPEC §8).
  switch (profile.pageNumber) {
    case 'none':
      break
    case 'bottomCenter':
      lines.push('\\fancyfoot[C]{\\thepage}')
      break
    case 'bottomOuter':
      lines.push('\\fancyfoot[LE,RO]{\\thepage}')
      break
    case 'topOuter':
      lines.push('\\fancyhead[LE,RO]{\\thepage}')
      break
    default:
      break
  }

  lines.push('\\renewcommand{\\headrulewidth}{0pt}')
  return lines.join('\n')
}

function headingMacros(profile: StyleProfile): string {
  const hs = profile.headingStyle
  const open: string[] = ['\\headingfont']
  if (hs.smallCaps) open.push('\\scshape')
  open.push(
    `\\fontsize{${Number((profile.bodyFontSize * hs.scale).toFixed(2))}pt}{${Number((profile.bodyFontSize * hs.scale * 1.2).toFixed(2))}pt}\\selectfont`
  )
  const align = hs.centered ? '\\centering' : '\\raggedright'
  return [
    '% chapter/heading look from profile.headingStyle',
    `\\newcommand{\\bookheadingstyle}{${open.join('')}${align}}`
  ].join('\n')
}

function ornamentInclude(path: string): string {
  // includegraphics of the PDF form of the ornament.
  return `\\begin{center}\\includegraphics[width=0.3\\textwidth]{${path}}\\end{center}`
}

function titlePage(input: LatexDocumentInput): string {
  const title = escapeLatex(input.config.title)
  const author = escapeLatex(input.config.author)
  return [
    '% --- Title page (profile.frontMatter.titlePage) ---',
    '\\thispagestyle{empty}',
    '\\begin{center}',
    '\\vspace*{2in}',
    `{\\bookheadingstyle ${title}\\par}`,
    '\\vspace{1in}',
    `{\\large ${author}\\par}`,
    '\\end{center}',
    '\\clearpage'
  ].join('\n')
}

function halfTitlePage(input: LatexDocumentInput): string {
  const title = escapeLatex(input.config.title)
  return [
    '% --- Half-title page (profile.frontMatter.halfTitle) ---',
    '\\thispagestyle{empty}',
    '\\begin{center}',
    '\\vspace*{2in}',
    `{\\bookheadingstyle ${title}\\par}`,
    '\\end{center}',
    '\\clearpage'
  ].join('\n')
}

function copyrightPage(input: LatexDocumentInput): string {
  const fm = input.frontMatter
  const lines: string[] = [
    '% --- Copyright / edition page (profile.frontMatter.copyrightPage) ---',
    '\\thispagestyle{empty}',
    '\\vspace*{\\fill}',
    '\\begin{flushleft}',
    '\\footnotesize'
  ]

  const holder = fm.copyrightHolder ?? input.config.author
  if (holder && holder.trim().length > 0) {
    const year = fm.publicationDate ?? input.config.editionDate ?? ''
    const yearPart = year ? `${escapeLatexValue(year)} ` : ''
    lines.push(`Copyright \\textcopyright{} ${yearPart}${escapeLatex(holder)}.\\par`)
  }
  if (fm.editionStatement) {
    lines.push(`${escapeLatex(fm.editionStatement)}\\par`)
  }
  const isbn = fm.isbn ?? input.config.isbn
  if (isbn) {
    lines.push(`ISBN: ${escapeLatexValue(isbn)}\\par`)
  }
  if (fm.publicationDate) {
    lines.push(`${escapeLatexValue(fm.publicationDate)}\\par`)
  }
  if (fm.imprint) {
    lines.push(`${escapeLatex(fm.imprint)}\\par`)
  }
  for (const notice of fm.notices) {
    if (notice && notice.trim().length > 0) {
      lines.push(`${escapeLatex(notice)}\\par`)
    }
  }

  lines.push('\\end{flushleft}', '\\clearpage')
  return lines.join('\n')
}

function tocBlock(toc: TocEntry[]): string {
  const lines: string[] = [
    '% --- Auto-generated TOC with edition page numbers (SPEC §7) ---',
    '\\thispagestyle{empty}',
    '\\begin{center}{\\bookheadingstyle Contents\\par}\\end{center}',
    '\\vspace{1em}',
    '\\begin{description}'
  ]
  for (const entry of toc) {
    const indent = entry.level > 1 ? `\\hspace{${(entry.level - 1) * 1.5}em}` : ''
    const title = escapeLatex(entry.title)
    const page = entry.pageNumber === null ? '' : String(entry.pageNumber)
    lines.push(`\\item[]${indent}${title}\\dotfill ${page}`)
  }
  lines.push('\\end{description}', '\\clearpage')
  return lines.join('\n')
}

/** Build a complete standalone XeLaTeX document. */
export function buildLatexDocument(input: LatexDocumentInput): string {
  const { profile, config, frontMatter } = input
  const orn = input.ornamentPaths ?? {}

  const parts: string[] = []

  // Preamble.
  parts.push('% !TEX program = xelatex')
  parts.push(`\\documentclass[${Number(profile.bodyFontSize.toFixed(2))}pt,oneside]{book}`)
  parts.push(geometryBlock(profile))
  parts.push(fontBlock(profile))
  parts.push('\\usepackage{graphicx}')
  parts.push(fancyhdrBlock(profile))
  parts.push(headingMacros(profile))

  // Stored metadata used by running heads.
  parts.push(`\\newcommand{\\thebooktitle}{${escapeLatex(config.title)}}`)
  parts.push(`\\newcommand{\\theauthor}{${escapeLatex(config.author)}}`)

  // Chapter-opener ornament hook: prepend to every \chapter via \chapterornament.
  if (orn.chapterOpener) {
    parts.push(`\\newcommand{\\chapterornament}{${ornamentInclude(orn.chapterOpener)}}`)
  } else {
    parts.push('\\newcommand{\\chapterornament}{}')
  }
  // Section-divider ornament hook: \sectiondivider for use at section breaks.
  if (orn.sectionDivider) {
    parts.push(`\\newcommand{\\sectiondivider}{${ornamentInclude(orn.sectionDivider)}}`)
  } else {
    parts.push('\\newcommand{\\sectiondivider}{\\begin{center}* * *\\end{center}}')
  }

  void frontMatter // referenced below in front-matter blocks

  parts.push('\\begin{document}')

  // Front matter (gated by profile toggles, SPEC §7).
  parts.push('\\frontmatter')
  if (profile.frontMatter.halfTitle) {
    parts.push(halfTitlePage(input))
  }
  if (profile.frontMatter.titlePage) {
    parts.push(titlePage(input))
  }
  if (profile.frontMatter.copyrightPage) {
    parts.push(copyrightPage(input))
  }
  parts.push(tocBlock(input.toc))

  // Body.
  parts.push('\\mainmatter')
  parts.push('% --- Body (Pandoc fragment) ---')
  parts.push(input.bodyLatex)

  parts.push('\\end{document}')

  return parts.join('\n')
}
