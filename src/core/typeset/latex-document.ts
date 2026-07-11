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
  // Two-sided imposition: `twoside` makes `inner`/`outer` mirror across the
  // spread (the inner/spine margin lands on the right of verso pages and the
  // left of recto pages), and `bindingoffset` adds the gutter to whichever side
  // is against the binding — so the text block stays optically centred once the
  // book is bound. This is the alternating-gutter behaviour print interiors need
  // (KDP §"Set up your manuscript"); a one-sided layout can't do it.
  const opts = [
    `paperwidth=${fmtIn(trim.widthIn)}`,
    `paperheight=${fmtIn(trim.heightIn)}`,
    `top=${fmtIn(m.top)}`,
    `bottom=${fmtIn(m.bottom)}`,
    `inner=${fmtIn(m.inner)}`,
    `outer=${fmtIn(m.outer)}`,
    `bindingoffset=${fmtIn(profile.gutter)}`,
    'twoside'
  ]
  return `\\usepackage[${opts.join(',')}]{geometry}`
}

/**
 * Print-quality typesetting defaults (SPEC §7/§10). Suppresses widows/orphans
 * and stray broken pages, and uses a ragged bottom so pages aren't vertically
 * stretched to force equal depth — the usual choice for a text reprint where a
 * one-line height difference reads better than stretched leading.
 */
function printQualityBlock(): string {
  return [
    '% --- Print-quality defaults ---',
    '\\clubpenalty=10000',
    '\\widowpenalty=10000',
    '\\displaywidowpenalty=10000',
    '\\brokenpenalty=10000',
    '\\raggedbottom'
  ].join('\n')
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

  // Clean the auto marks so chapter/section running heads read as the plain
  // title, not book class's uppercased "CHAPTER 1. TITLE".
  lines.push('\\renewcommand{\\chaptermark}[1]{\\markboth{#1}{}}')
  lines.push('\\renewcommand{\\sectionmark}[1]{\\markright{#1}}')

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

/**
 * Table of contents. We emit LaTeX's native `\tableofcontents`, whose page
 * numbers are the *real* typeset ones (resolved on the second XeLaTeX pass from
 * the injected `\chapter` structure) — not the estimates the old hand-rolled
 * list carried. Only emitted when the document actually has detected structure;
 * an unstructured reprint gets no empty Contents page.
 */
function tocBlock(toc: TocEntry[]): string {
  if (toc.length === 0) return ''
  return [
    '% --- Auto TOC with real typeset page numbers (SPEC §7) ---',
    '\\cleardoublepage',
    '\\tableofcontents',
    '\\cleardoublepage'
  ].join('\n')
}

/** Build a complete standalone XeLaTeX document. */
export function buildLatexDocument(input: LatexDocumentInput): string {
  const { profile, config, frontMatter } = input
  const orn = input.ornamentPaths ?? {}

  const parts: string[] = []

  // Preamble. `twoside` gives mirrored margins, recto chapter openings, and
  // verso/recto-aware running heads — the basis of a real print interior.
  parts.push('% !TEX program = xelatex')
  parts.push(`\\documentclass[${Number(profile.bodyFontSize.toFixed(2))}pt,twoside]{book}`)
  parts.push(geometryBlock(profile))
  parts.push(fontBlock(profile))
  parts.push('\\usepackage{graphicx}')
  parts.push(fancyhdrBlock(profile))
  parts.push(printQualityBlock())
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
