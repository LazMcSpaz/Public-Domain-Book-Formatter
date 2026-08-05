/**
 * Emit the LaTeX body from an assembled book document.
 *
 * This replaces Pandoc entirely. Pandoc existed to convert a general Markdown
 * document into LaTeX, but the vision pass hands us *typed structure* — we know
 * a block is verse rather than guessing it from indentation — so a general
 * converter would only lose information and add a dependency. Emitting directly
 * also means footnotes can be reattached to their reference marks, which a
 * Markdown round-trip cannot express.
 *
 * Pure: string in, string out.
 */
import { footnoteMarkerPattern } from '@core/assemble'
import type { BookBlock, BookDocument, Footnote } from '@core/assemble'
import { escapeLatex } from './escape'

export interface EmitOptions {
  /**
   * Drop footnotes whose marker was never found in the body. They can't be
   * placed automatically, and a note dumped in the wrong spot is worse than one
   * the review gate told the user about. Default true.
   */
  omitOrphanFootnotes?: boolean
  /**
   * Open each chapter's first paragraph with a large initial. Must match
   * `StyleProfile.dropCap`, which is what loads the `lettrine` package —
   * emitting the command without the package would fail the TeX run.
   */
  dropCap?: boolean
}

/**
 * Replace each footnote's in-text marker with a real `\footnote{…}`.
 *
 * Only the *first* occurrence of a marker is replaced: the printed marker
 * appears once as a reference, and a bare digit like "1" would otherwise match
 * unrelated numerals later in the paragraph.
 *
 * Marker location is shared with orphan detection (`footnoteMarkerPattern`) —
 * if the two disagreed, a note could be reported as unplaceable and then placed
 * anyway, or the reverse.
 */
export function attachFootnotes(
  text: string,
  footnotes: readonly Footnote[]
): { text: string; used: Set<string> } {
  let out = text
  const used = new Set<string>()

  for (const note of footnotes) {
    const pattern = footnoteMarkerPattern(note.originalMarker)
    if (!pattern || !pattern.test(out)) continue
    out = out.replace(pattern, `\\footnote{${escapeLatex(note.text)}}`)
    used.add(note.id)
  }

  return { text: out, used }
}

/**
 * Open a paragraph with a large initial.
 *
 * `\lettrine{T}{he}` sets the T as the drop cap and the rest of the first word
 * in small caps beside it — the convention this reproduces. Applied only when
 * the paragraph genuinely starts with a letter: text beginning with a quotation
 * mark, a numeral, or a LaTeX command has no clean initial to lift, and a
 * mangled one looks far worse than none.
 */
export function applyDropCap(text: string): string {
  const match = /^(\p{Lu}|\p{Ll})(\p{L}*)/u.exec(text)
  if (!match) return text
  const initial = match[1]!
  const restOfWord = match[2] ?? ''
  return `\\lettrine{${initial}}{${restOfWord}}${text.slice(match[0].length)}`
}

const HEADING_COMMANDS = ['chapter', 'section', 'subsection', 'subsubsection', 'paragraph']

function headingCommand(level: number): string {
  return HEADING_COMMANDS[Math.min(HEADING_COMMANDS.length - 1, Math.max(1, level) - 1)]!
}

/** Emit one block. Footnotes are already attached to the text by the caller. */
function emitBlock(block: BookBlock, escapedText: string): string {
  switch (block.kind) {
    case 'heading':
      return `\\${headingCommand(block.level ?? 1)}{${escapedText}}`

    case 'blockquote':
      return ['\\begin{quote}', escapedText, '\\end{quote}'].join('\n')

    case 'epigraph':
      // Set narrower and italic — an epigraph is an aside, not body prose.
      return ['\\begin{quote}', `\\itshape ${escapedText}`, '\\end{quote}'].join('\n')

    case 'verse':
      // `verse` preserves the poet's line breaks; `\\` ends each line but the last.
      return [
        '\\begin{verse}',
        escapedText
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .join(' \\\\\n'),
        '\\end{verse}'
      ].join('\n')

    case 'caption':
      return ['\\begin{center}', `\\small\\itshape ${escapedText}`, '\\end{center}'].join('\n')

    case 'list-item':
      // Consecutive items are wrapped into one list by `groupLists`.
      return `\\item ${escapedText}`

    case 'footnote':
      // Reached only if a note wasn't lifted out during assembly; setting it as
      // body text is better than dropping the author's words.
      return escapedText

    case 'paragraph':
    default:
      return escapedText
  }
}

/** Wrap runs of consecutive `\item` lines in a single itemize environment. */
function groupLists(pieces: { kind: string; latex: string }[]): string[] {
  const out: string[] = []
  let listBuffer: string[] = []

  const flush = (): void => {
    if (listBuffer.length === 0) return
    out.push(['\\begin{itemize}', ...listBuffer, '\\end{itemize}'].join('\n'))
    listBuffer = []
  }

  for (const piece of pieces) {
    if (piece.kind === 'list-item') listBuffer.push(piece.latex)
    else {
      flush()
      out.push(piece.latex)
    }
  }
  flush()
  return out
}

/**
 * Emit the complete LaTeX body fragment for a book document — the input
 * `buildLatexDocument` expects as `bodyLatex`.
 */
export function emitBody(doc: BookDocument, options: EmitOptions = {}): string {
  const omitOrphans = options.omitOrphanFootnotes ?? true

  const placeable = doc.footnotes.filter((f) => !omitOrphans || !f.orphaned)
  const remaining = new Map(placeable.map((f) => [f.id, f]))

  // A drop cap belongs on the paragraph that *opens* a chapter, so the emitter
  // has to remember whether the last block was a chapter heading.
  const wantDropCap = options.dropCap ?? false
  let afterChapterHeading = false

  const pieces = doc.blocks.map((block) => {
    // Escape first, then splice in footnote commands, so the note's own text is
    // escaped but the \footnote command itself survives.
    const escaped = escapeLatex(block.text)
    const notesForBlock = [...remaining.values()]
    const { text, used } = attachFootnotes(escaped, notesForBlock)
    for (const id of used) remaining.delete(id)

    const opensChapter = wantDropCap && afterChapterHeading && block.kind === 'paragraph'
    afterChapterHeading = block.kind === 'heading' && (block.level ?? 1) === 1

    return {
      kind: block.kind,
      latex: emitBlock(block, opensChapter ? applyDropCap(text) : text)
    }
  })

  const body = groupLists(pieces)

  // Notes whose marker never turned up anywhere still belong to the author.
  // Append them at the end rather than losing them silently.
  const stranded = [...remaining.values()]
  if (stranded.length > 0) {
    body.push('\\bigskip')
    body.push('\\noindent\\textit{Notes:}')
    body.push(
      stranded
        .map((n) => `\\noindent ${escapeLatex(n.originalMarker)} ${escapeLatex(n.text)}`)
        .join('\n\n')
    )
  }

  return body.join('\n\n')
}

/** Emit front-of-book asides (dedication, epigraph) as their own fragment. */
export function emitAsides(doc: BookDocument): string {
  if (doc.asides.length === 0) return ''
  return doc.asides
    .map((block) => {
      const escaped = escapeLatex(block.text)
      return ['\\begin{center}', `\\itshape ${escaped}`, '\\end{center}'].join('\n')
    })
    .join('\n\n')
}

/** TOC entries derived from the document's chapters. */
export function tocFromDocument(doc: BookDocument): { title: string; level: number }[] {
  return doc.chapters.map((c) => ({ title: c.title, level: c.level }))
}
