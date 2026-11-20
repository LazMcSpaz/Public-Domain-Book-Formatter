/**
 * The cover interview's answers read back into a cover document, and a cover
 * started from a finished interior.
 *
 * Pure.
 */
import { defaultCover, normalizeLook, type CoverDocument, type FrameStyle } from './document'
import { MIN_PAGES_FOR_SPINE_TEXT, type PaperStock } from './geometry'
import { type GroundPattern } from './patterns'
import { type GroundFigure } from './figures'
import { PAPERS } from './interview'

export function text(answers: Record<string, unknown>, id: string, fallback: string): string {
  const v = answers[id]
  return typeof v === 'string' ? v : fallback
}

export function flag(answers: Record<string, unknown>, id: string, fallback: boolean): boolean {
  const v = answers[id]
  return typeof v === 'boolean' ? v : fallback
}

/**
 * Fold answers back into a cover.
 *
 * Everything unanswered keeps the value it had, so a partially-worked gate
 * never resets the rest of the design — the same property `defaultAnswers`
 * gives the wizard, and the reason a user can leave a screen and come back.
 */
export function coverFromAnswers(
  base: CoverDocument,
  answers: Record<string, unknown>
): CoverDocument {
  const doc: CoverDocument = {
    ...base,
    look: { ...base.look, palette: { ...base.look.palette } },
    content: { ...base.content, art: { ...base.content.art, ops: [...base.content.art.ops] } }
  }

  doc.trimSize = text(answers, 'cover-trim', doc.trimSize)
  const binding = text(answers, 'cover-binding', doc.binding)
  if (binding === 'paperback' || binding === 'hardcover') doc.binding = binding
  const paper = text(answers, 'cover-paper', doc.paper)
  if ((PAPERS as readonly string[]).includes(paper)) doc.paper = paper as PaperStock
  const pages = Number(text(answers, 'cover-pages', String(doc.pageCount)))
  if (Number.isFinite(pages) && pages >= 0) doc.pageCount = Math.round(pages)

  doc.look = normalizeLook({
    ...doc.look,
    arrangement: text(answers, 'cover-arrangement', doc.look.arrangement),
    titleFont: text(answers, 'cover-title-font', doc.look.titleFont),
    titleCase: text(answers, 'cover-title-case', doc.look.titleCase),
    rule: text(answers, 'cover-rule', doc.look.rule),
    subtitleRatio: (() => {
      const asked = text(
        answers,
        'cover-subtitle-size',
        doc.look.subtitleRatio === null ? '' : String(doc.look.subtitleRatio)
      )
      const n = Number(asked)
      return asked.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
    })(),
    frontFrame: text(answers, 'cover-frame', doc.look.frontFrame),
    subtitleSizePt: (() => {
      const asked = text(
        answers,
        'cover-subtitle-points',
        doc.look.subtitleSizePt === null ? '' : String(doc.look.subtitleSizePt)
      )
      const n = Number(asked)
      return asked.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
    })(),
    authorSizePt: (() => {
      const asked = text(
        answers,
        'cover-author-size',
        doc.look.authorSizePt === null ? '' : String(doc.look.authorSizePt)
      )
      const n = Number(asked)
      return asked.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
    })(),
    spineSizePt: (() => {
      const asked = text(
        answers,
        'cover-spine-size',
        doc.look.spineSizePt === null ? '' : String(doc.look.spineSizePt)
      )
      const n = Number(asked)
      return asked.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
    })(),
    blurbSizePt: (() => {
      const asked = text(
        answers,
        'cover-blurb-size',
        doc.look.blurbSizePt === null ? '' : String(doc.look.blurbSizePt)
      )
      const n = Number(asked)
      return asked.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
    })(),
    blurbBorder: text(answers, 'cover-blurb-frame', doc.look.blurbBorder) as FrameStyle,
    authorAtFoot: flag(answers, 'cover-author-foot', doc.look.authorAtFoot),
    groundFigure:
      (text(answers, 'cover-figure', doc.look.groundFigure ?? '') as GroundFigure | '') || null,
    groundPatternOpacity: (() => {
      const said = text(answers, 'cover-pattern-opacity', '')
      // '' is "defer to the pattern", which is not the same as 0 — and
      // `Number('')` is 0, which would print nothing and warn about nothing.
      return said === '' ? null : Number(said)
    })(),
    groundFigureOpacity: Number(
      text(answers, 'cover-figure-opacity', String(doc.look.groundFigureOpacity))
    ),
    groundFigureBack: flag(answers, 'cover-figure-back', doc.look.groundFigureBack),
    groundFigureWrap: flag(answers, 'cover-figure-wrap', doc.look.groundFigureWrap),
    groundFigureToEdge: flag(answers, 'cover-figure-edge', doc.look.groundFigureToEdge),
    markOnFront: flag(answers, 'cover-mark-front', doc.look.markOnFront),
    ornamentId: text(answers, 'cover-ornament', doc.look.ornamentId ?? '') || null,
    groundPattern:
      (text(answers, 'cover-ground-pattern', doc.look.groundPattern ?? '') as GroundPattern | '') ||
      null,
    spineText: flag(answers, 'cover-spine-text', doc.look.spineText),
    palette: {
      ...doc.look.palette,
      ground: text(answers, 'cover-ground', doc.look.palette.ground),
      ink: text(answers, 'cover-ink', doc.look.palette.ink),
      accent: text(answers, 'cover-accent', doc.look.palette.accent),
      figure: text(answers, 'cover-figure-ink', doc.look.palette.figure)
    }
  })

  const works = text(answers, 'cover-works', doc.content.works.join('\n'))
  doc.content = {
    ...doc.content,
    title: text(answers, 'cover-title', doc.content.title),
    works: works
      .split('\n')
      .map((w) => w.trim())
      .filter((w) => w.length > 0),
    subtitle: text(answers, 'cover-subtitle', doc.content.subtitle),
    author: text(answers, 'cover-author', doc.content.author),
    series: text(answers, 'cover-series', doc.content.series),
    edition: text(answers, 'cover-edition', doc.content.edition),
    blurb: text(answers, 'cover-blurb', doc.content.blurb),
    imprint: text(answers, 'cover-imprint', doc.content.imprint)
  }

  return doc
}

/** A cover for a book the app has just set, with everything it already knows. */
export function coverFromInterior(input: {
  trimSize: string
  pageCount: number
  title: string
  author: string
  imprint: string
}): CoverDocument {
  const doc = defaultCover(input.trimSize, input.pageCount)
  doc.content.title = input.title
  doc.content.author = input.author
  doc.content.imprint = input.imprint
  doc.look.spineText = input.pageCount >= MIN_PAGES_FOR_SPINE_TEXT
  return doc
}
