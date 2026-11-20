/**
 * The front cover's type block, below the device and the series line: the
 * title (or an omnibus's titles), the rule, the edition statement, the
 * subtitle, the author and the imprint at the foot. Split out of
 * `compose-front.ts`, which lays the picture, the frame and the band first.
 *
 * Pure: items out.
 */
import type { TextMeasurer } from '@core/layout'
import type { OrnamentArt } from '@core/ornament'
import { worksLabel, type CoverDocument } from './document'
import { pt, type CoverGeometry, type Rect } from './geometry'
import {
  AUTHOR_MIN_PT,
  AUTHOR_RATIO,
  EDITION_DROP,
  EDITION_LABEL_SHARE,
  IMPRINT_PT,
  LEADING,
  SUBTITLE_MAX_SHARE,
  SUBTITLE_RATIO
} from './compose-constants'
import { drawRule } from './compose-frame'
import { type CoverItem } from './compose-items'
import {
  applyCase,
  centeredLines,
  face,
  fitText,
  fitTitlesTogether,
  stackedLines,
  wrapText
} from './compose-text'

import type { FontRef } from '@core/layout'
import type { Hex } from './document'

/** Everything the front has settled by the time the type block is set. */
export interface FrontType {
  items: CoverItem[]
  warnings: string[]
  geometry: CoverGeometry
  doc: CoverDocument
  arrangement: CoverDocument['look']['arrangement']
  ornament: OrnamentArt | null
  measurer: TextMeasurer
  safe: Rect
  panel: Rect
  typeBox: { widthPt: number; heightPt: number }
  titleFont: FontRef
  authorFont: FontRef
  smallCaps: boolean
  titleText: string
  overArt: boolean
  inkColor: Hex
}

/** Set the type block from `top` down. */
export function layFrontType(ctx: FrontType, top: number): void {
  const { items, warnings, geometry, doc, arrangement, ornament, measurer } = ctx
  const { safe, panel, typeBox, titleFont, authorFont, smallCaps, titleText } = ctx
  const { overArt, inkColor } = ctx
  const { look, content } = doc
  const palette = look.palette
  let y = top
  /**
   * The edition statement, set under the rule. Returns where the next thing
   * goes, so a cover without one is laid out exactly as it was before.
   */
  const setEdition = (after: number): number => {
    if (!content.edition.trim()) return after
    const editionFont = face(look.bodyFont, 'regular', measurer.hasSmallCaps(look.bodyFont))
    // The banked subtitle size governs this line too, because on a cover that
    // has no subtitle this *is* the subtitle slot: *The Human Aura* names its
    // volumes here and *The Theosophical Glossary* says "Illustrated" here,
    // and a collection whose subtitles agree at 16 pt while these two set at
    // 15 has a difference a reader can see and nobody chose. Without one it
    // keeps the share of the measure it had, which is what a single book that
    // has banked nothing should get.
    //
    // Where a subtitle *is* set, this line is a third-rank label rather than
    // the subtitle, and must not set level with it: "ANNOTATED AND
    // ILLUSTRATED" over "The Legend of Hiram Abiff" at one size reads as two
    // subtitles arguing. `EDITION_LABEL_SHARE` of the subtitle keeps it a
    // label — small enough not to intrude on a title, large enough that KDP
    // can find the words it requires an edition of a public-domain text to
    // carry.
    const banked = look.subtitleSizePt ?? Math.max(9, Math.min(16, typeBox.widthPt * 0.035))
    const size = content.subtitle.trim() ? Math.max(8, banked * EDITION_LABEL_SHARE) : banked
    // Dropped a little below the rule rather than set directly under it. The
    // rule belongs to the title, so a line tight beneath it reads as part of
    // the title's own block; a few points of air makes it a second thing the
    // board says.
    const from = after + size * EDITION_DROP
    // A newline stacks it, the way one in a title does. A statement naming a
    // series and the volumes in it is two thoughts, and set on one line under
    // a rule it reads as a caption; stacked, it reads as a label. The break is
    // the editor's where they type it, and `stackedLines` still wraps each
    // segment, so a stacked line too long for the measure breaks rather than
    // running off the board.
    const next = centeredLines(
      items,
      stackedLines(content.edition.toUpperCase(), typeBox.widthPt, editionFont, size, measurer),
      geometry.front,
      from,
      editionFont,
      size,
      overArt ? palette.overArt : palette.accent,
      measurer
    )
    return next + size * 0.9
  }

  /** The author, set below whatever came before it. */
  const setAuthor = (relativeTo: number, titleSizePt: number): void => {
    if (!content.author.trim()) return
    // A banked size wins over the share, so a collection's names agree along
    // a shelf instead of each tracking its own fitted title. The floor still
    // applies either way: it is what stops a name being a caption.
    // Bounded above by the title, which a share could never break and a
    // pinned size can. Measured on this shelf: with the author pinned at 26
    // for the collection, the two covers whose titles were crushed by a
    // device printed an 18 pt title under a 26 pt name. Nobody reads that as
    // a design. The floor wins where the two meet, because a name nobody can
    // read is the worse fault and the real answer there is a larger title.
    const asked = Math.max(AUTHOR_MIN_PT, look.authorSizePt ?? titleSizePt * AUTHOR_RATIO)
    const size = Math.max(AUTHOR_MIN_PT, Math.min(asked, titleSizePt))
    if (size < asked) {
      warnings.push(
        `The author's name was set at ${size.toFixed(1)} pt rather than the ` +
          `${asked.toFixed(1)} pt asked for, so it does not print larger than the title.`
      )
    }
    const lines = wrapText(content.author, typeBox.widthPt, authorFont, size, measurer)
    // On a typographic cover the author sits low, with the empty middle of the
    // panel doing the work a picture would otherwise do — and any cover may ask
    // for the same, which is what a ground with a subject under the rule needs.
    const authorTop =
      arrangement === 'typographic' || look.authorAtFoot
        ? pt(safe.y + safe.height * 0.74)
        : relativeTo
    centeredLines(items, lines, geometry.front, authorTop, authorFont, size, inkColor, measurer)
  }

  const works = content.works.map((w) => w.trim()).filter((w) => w.length > 0)

  if (works.length >= 2) {
    // --- an omnibus: every work at the same size ---------------------------
    //
    // Two treatises bound together are two treatises. Setting the longer title
    // smaller so it fits would say the shorter one matters more, and putting
    // the second in the subtitle would say it outright.
    const accentInk = overArt ? palette.overArt : palette.accent
    const labelFont = face(look.bodyFont, 'regular', measurer.hasSmallCaps(look.bodyFont))
    const labelSize = Math.max(9, Math.min(14, typeBox.widthPt * 0.03))
    // Announced only if the press wants it announced. Two titles with a rule
    // under them and an italic conjunction between already read as two works;
    // a label above them is a second, quieter way of saying the same thing,
    // and stacked under a series line it is one small-capital line too many.
    if (look.announceWorks) {
      y = centeredLines(
        items,
        [worksLabel(works.length)],
        geometry.front,
        y,
        labelFont,
        labelSize,
        accentInk,
        measurer
      )
      y += labelSize * 0.8
    }

    // No rule above the titles. The pair is closed underneath and open at the
    // top, so the series line above it reads as belonging to the cover rather
    // than being boxed in with the titles.
    const ruleWidth = safe.width * 0.62
    y += labelSize * 0.5

    const cased = works.map((w) =>
      smallCaps ? w : applyCase(w, look.titleCase === 'small-caps' ? 'upper' : look.titleCase)
    )
    // An omnibus honours a pinned size exactly as a single title does. It did
    // not, and said nothing: `titleSizePt` is documented as setting the title's
    // size, so a collection that pinned one got a fitted size on the volume
    // that happened to hold two works and no report that the field had been
    // ignored. Pinning is also the only way to give display type more air
    // inside a frame without moving `FRAME_CLEARANCE_IN`, which is shared and
    // would re-size every cover already approved.
    const fitted =
      look.titleSizePt !== null
        ? {
            sizePt: look.titleSizePt,
            lines: cased.map((w) =>
              stackedLines(w, typeBox.widthPt, titleFont, look.titleSizePt!, measurer)
            )
          }
        : fitTitlesTogether(
            cased,
            { widthPt: typeBox.widthPt, heightPt: typeBox.heightPt * 0.56 },
            2,
            titleFont,
            measurer
          )

    const conjunctionFont = face(look.bodyFont, 'italic')
    const conjunctionSize = Math.max(10, fitted.sizePt * 0.4)
    fitted.lines.forEach((lines, index) => {
      if (index > 0) {
        y += conjunctionSize * 0.45
        y = centeredLines(
          items,
          ['and'],
          geometry.front,
          y,
          conjunctionFont,
          conjunctionSize,
          inkColor,
          measurer
        )
        y += conjunctionSize * 0.45
      }
      y = centeredLines(
        items,
        lines,
        geometry.front,
        y,
        titleFont,
        fitted.sizePt,
        inkColor,
        measurer
      )
    })

    y += labelSize * 1.1
    y = drawRule(
      items,
      look.rule === 'none' ? 'none' : 'single',
      geometry.front,
      y,
      ruleWidth,
      accentInk,
      null
    )
    y += fitted.sizePt * 0.5
    y = setEdition(y)
    setAuthor(y, fitted.sizePt)
  } else if (titleText.trim()) {
    const reserved = typeBox.heightPt * (content.subtitle.trim() ? 0.55 : 0.72)
    const fitted =
      look.titleSizePt !== null
        ? {
            sizePt: look.titleSizePt,
            lines: stackedLines(titleText, typeBox.widthPt, titleFont, look.titleSizePt, measurer)
          }
        : fitText(
            titleText,
            { widthPt: typeBox.widthPt, heightPt: reserved },
            3,
            titleFont,
            measurer
          )
    if (fitted.lines.length * fitted.sizePt * LEADING > reserved) {
      warnings.push('The title is taller than the space the arrangement gives it.')
    }
    y = centeredLines(
      items,
      fitted.lines,
      geometry.front,
      y,
      titleFont,
      fitted.sizePt,
      inkColor,
      measurer
    )
    y += fitted.sizePt * 0.35

    // --- rule ------------------------------------------------------------
    y = drawRule(
      items,
      look.rule,
      geometry.front,
      y,
      safe.width * 0.5,
      overArt ? palette.overArt : palette.accent,
      ornament
    )
    y += fitted.sizePt * 0.35

    // --- edition statement, under the rule ---------------------------------
    //
    // Under the rule rather than above the title, which is where the series
    // line goes: a series names something the book belongs to and an edition
    // statement names this printing, so they are read in different places and
    // must not share a slot. Small capitals in the accent, the same treatment
    // the series line gets, because the two are the same kind of line.
    y = setEdition(y)

    if (content.subtitle.trim()) {
      // The editor's size where one is set: on a reprinted multi-volume work
      // the subtitle names the volume and is read as hard as the title is.
      // A banked size in points wins over the share, for the reason
      // `CoverLook.subtitleSizePt` gives: a share of a fitted title makes two
      // books in one collection disagree about how big a subtitle is.
      // Bounded by the title for the same reason the author is, and lower: a
      // subtitle is a subordinate line, and set level with the title it reads
      // as two titles. The ceiling binds only a *pinned* size. A share that
      // asks for more is the editor saying the subtitle names the volume,
      // which is the case the share was built for.
      const wanted = look.subtitleSizePt ?? fitted.sizePt * (look.subtitleRatio ?? SUBTITLE_RATIO)
      const ceiling =
        look.subtitleSizePt === null ? Number.POSITIVE_INFINITY : fitted.sizePt * SUBTITLE_MAX_SHARE
      const size = Math.max(10, Math.min(wanted, ceiling))
      if (size < wanted) {
        warnings.push(
          `The subtitle was set at ${size.toFixed(1)} pt rather than the ` +
            `${wanted.toFixed(1)} pt asked for, so it stays under the title.`
        )
      }
      // A newline stacks it, exactly as one in the title or the edition
      // statement does. A subtitle naming two things — the legend and what
      // this edition adds to it — is two thoughts, and run together on one
      // line it reads as a caption. `stackedLines` still wraps each segment,
      // so a stacked line too long for the measure breaks rather than running
      // off the board.
      const lines = stackedLines(
        content.subtitle,
        typeBox.widthPt,
        face(look.bodyFont, 'italic'),
        size,
        measurer
      )
      y = centeredLines(
        items,
        lines,
        geometry.front,
        y,
        face(look.bodyFont, 'italic'),
        size,
        inkColor,
        measurer
      )
      y += size * 0.6
    }

    setAuthor(y, fitted.sizePt)
  }

  // --- imprint at the foot ------------------------------------------------
  if (look.imprintOnFront && content.imprint.trim()) {
    const size = IMPRINT_PT
    const font = face(look.bodyFont, 'regular', measurer.hasSmallCaps(look.bodyFont))
    const metrics = measurer.metrics(font, size)
    const width = measurer.widthOf(content.imprint, font, size)
    items.push({
      kind: 'text',
      text: content.imprint,
      font,
      sizePt: size,
      xPt: pt(panel.x + panel.width / 2) - width / 2,
      yPt: pt(safe.y + safe.height) - metrics.descent,
      color: overArt ? palette.overArt : palette.ink,
      widthPt: width,
      ascentPt: metrics.ascent,
      descentPt: metrics.descent
    })
  }
}
