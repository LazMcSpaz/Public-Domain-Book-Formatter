/**
 * Generates a multi-page test book that mimics a scanned public-domain work:
 * title page, copyright page, and body pages with recurring archaic and
 * esoteric vocabulary, running heads, folios, and a footnote.
 *
 * Recurrence matters — the lexicon harvest is frequency-driven, so a realistic
 * fixture needs terms that actually repeat across pages, the way a real book's
 * vocabulary does.
 *
 * Usage: node scripts/make-test-book.mjs [outPath]
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const OUT = process.argv[2] ?? 'public/test-book.pdf'

const doc = await PDFDocument.create()
const serif = await doc.embedFont(StandardFonts.TimesRoman)
const italic = await doc.embedFont(StandardFonts.TimesRomanItalic)

const PAGE = [432, 648] // 6×9in at 72dpi
const RUNNING_HEAD = 'THE ALCHEMIST HIS PRACTISE'

function newPage() {
  return doc.addPage(PAGE)
}

const write = (page, text, y, opts = {}) =>
  page.drawText(text, {
    x: opts.x ?? 72,
    y,
    size: opts.size ?? 11,
    font: opts.font ?? serif
  })

// --- front matter ---------------------------------------------------------
const title = newPage()
write(title, 'THE ALCHEMIST', 470, { size: 22, x: 128 })
write(title, 'HIS PRACTISE', 440, { size: 22, x: 133 })
write(title, 'Wherein is declared the Vertues of', 380, { size: 11, font: italic, x: 108 })
write(title, 'Hearbes, Mineralls, and Chymicall Preparations', 362, {
  size: 11,
  font: italic,
  x: 84
})
write(title, 'By a Student in the Spagyrick Art', 300, { size: 12, x: 116 })
write(title, 'LONDON', 200, { size: 12, x: 178 })
write(title, 'Printed for J. Smith, at the Signe of the Bell', 182, { size: 10, x: 96 })
write(title, 'MDCLXII', 160, { size: 11, x: 186 })

const copyright = newPage()
write(copyright, 'Entered according to Act of Parliament', 380, { size: 10, x: 100 })
write(copyright, 'All rights reserved by the Stationers Company', 362, { size: 10, x: 88 })

// --- body -----------------------------------------------------------------
// Recurring vocabulary — the terms the lexicon harvest should surface.
const paragraphs = [
  [
    'IT hath beene shewed by Paracelsus, that ye',
    'physician who knoweth not the starres can',
    'never rightly compound his medicaments. For',
    'the quintessence of everie thing lyeth hidden,',
    'and must bee drawne forth by calcination.'
  ],
  [
    'The alembick being set upon a gentle fire, the',
    'spirit ascendeth and is gathered in the receiver.',
    'This the ancients called aqua vitae, and helde',
    'it soveraigne against all putrefaction.'
  ],
  [
    'Nowe the chirurgeon, having his simples ready,',
    'shall marke well the humours of his patient,',
    'and by the doctrine of Paracelsus discerne',
    'whether the quintessence be wanting.'
  ],
  [
    'Take of the mineralls such as are perfected by',
    'nature, and let them bee calcined in the',
    'alembick until the spirit ascendeth. So shall',
    'the chirurgeon have his medicaments ready.'
  ],
  [
    'Of the vertues of hearbes much hath beene',
    'written, yet fewe have shewed how the',
    'quintessence is drawne. The soveraigne',
    'remedie lyeth in calcination, saith Paracelsus.'
  ],
  [
    'Let the practitioner marke that putrefaction',
    'goeth before generation, and that the alembick',
    'is the chirurgeon his surest instrument in all',
    'the operations of this spagyrick art.'
  ]
]

/**
 * An engraving of an alembick, drawn as solid shapes.
 *
 * Solid on purpose. Region detection finds rectangles the *text* flows around,
 * and then asks the pixels whether there is actually ink in one — so a figure
 * drawn in hairlines would be found and then correctly rejected as blank paper,
 * and the fixture would be testing the rejection rather than the placement.
 * Real engravings of this period are dense with hatching, so filled shapes are
 * also the more faithful thing to draw.
 *
 * @param page   the page to draw on
 * @param cx     centre of the figure, in PDF points from the left
 * @param bottom the figure's base, in points from the foot of the page
 * @param scale  1 is about 150pt tall
 */
function drawAlembick(page, cx, bottom, scale = 1) {
  const s = (n) => n * scale
  const black = rgb(0, 0, 0)

  // The cucurbit: a round-bottomed vessel.
  page.drawEllipse({ x: cx, y: bottom + s(46), xScale: s(46), yScale: s(40), color: black })
  // Its neck, rising to the head.
  page.drawRectangle({
    x: cx - s(11),
    y: bottom + s(80),
    width: s(22),
    height: s(40),
    color: black
  })
  // The head, and the beak that runs off to the receiver.
  page.drawEllipse({ x: cx, y: bottom + s(126), xScale: s(26), yScale: s(18), color: black })
  // `drawSvgPath` anchors at a point in PDF coordinates (up from the foot of
  // the page) and then runs the path's own y *downward* from it — so the anchor
  // is the head's height, not the page height minus it.
  page.drawSvgPath(
    `M 0 0 C ${s(30)} ${s(4)} ${s(52)} ${s(20)} ${s(64)} ${s(46)} L ${s(58)} ${s(52)} ` +
      `C ${s(46)} ${s(28)} ${s(26)} ${s(14)} 0 ${s(10)} Z`,
    { x: cx + s(20), y: bottom + s(126), color: black }
  )
  // The receiver it drips into.
  page.drawEllipse({ x: cx + s(96), y: bottom + s(24), xScale: s(24), yScale: s(22), color: black })
  // The furnace beneath, and its hatched shadow.
  page.drawRectangle({
    x: cx - s(56),
    y: bottom - s(4),
    width: s(112),
    height: s(12),
    color: black
  })
  for (let i = 0; i < 7; i++) {
    page.drawRectangle({
      x: cx - s(52) + i * s(16),
      y: bottom - s(22),
      width: s(6),
      height: s(16),
      color: black
    })
  }
}

let folio = 1
for (const [i, para] of paragraphs.entries()) {
  const page = newPage()
  write(page, RUNNING_HEAD, 590, { size: 9, font: italic, x: 110 })

  let y = 540
  if (i === 0) {
    write(page, 'CHAPTER IV', y, { size: 14, x: 160 })
    y -= 40
    write(page, 'Of the Chirurgeon his Art', y, { size: 11, font: italic, x: 130 })
    y -= 34
  }
  for (const line of para) {
    write(page, line, y)
    y -= 20
  }

  if (i === 1) {
    write(page, '_______________', 130, { size: 9 })
    write(page, '* See the Basilica Chymica of Croll, lib. ii, cap. vii.', 115, { size: 9 })
  }

  // A figure set into the text, with the caption the original printed under it.
  // Text above and below, so the detector has a rectangle to find between them.
  if (i === 3) {
    drawAlembick(page, 216, 250, 0.85)
    write(page, 'Fig. 1. The alembick and its receiver.', 210, { size: 9, font: italic, x: 118 })
  }

  write(page, String(36 + folio), 72, { size: 10, x: 210 })
  folio++
}

// --- a full-page plate ------------------------------------------------------
// Nothing on the leaf but the picture, which is how plates were bound in. It
// exercises a different path entirely: no words at all, so the detector offers
// the whole page, and the engine gives it a leaf of its own.
const plate = newPage()
drawAlembick(plate, 216, 300, 1.5)
write(plate, 'PLATE I', 200, { size: 11, x: 190 })

const bytes = await doc.save()
writeFileSync(OUT, bytes)
console.log(`wrote ${OUT} — ${doc.getPageCount()} pages, ${bytes.length} bytes`)
