/**
 * A born-digital PDF: typeset, never photographed.
 *
 * The other half of the pair. `test-book.pdf` is a stand-in for a scan — a
 * sheet of paper under every leaf — and this one is what a public-domain work
 * reprinted digitally actually looks like: real characters, real encodings, no
 * pictures at all. The app should notice the difference structurally and read
 * the text instead of spending ten minutes OCR-ing a picture of it.
 *
 * Usage: node scripts/make-test-digital.mjs [outPath]
 */
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const OUT = process.argv[2] ?? 'public/test-digital.pdf'
const doc = await PDFDocument.create()
const serif = await doc.embedFont(StandardFonts.TimesRoman)
const PAGE = [432, 648]

const PROSE = [
  'The chirurgeon, having his simples ready, shall marke well the humours of',
  'his patient, and by the doctrine of Paracelsus discerne whether the',
  'quintessence be wanting. The alembick being set upon a gentle fire, the',
  'spirit ascendeth and is gathered in the receiver; this the ancients called',
  'aqua vitae, and helde it soveraigne against all putrefaction.',
  '',
  'Of the vertues of hearbes much hath beene written, yet fewe have shewed',
  'how the quintessence is drawne forth by calcination. Take of the mineralls',
  'such as are perfected by nature, and let them bee calcined in the alembick',
  'until the spirit ascendeth. So shall the chirurgeon have his medicaments',
  'ready against the season of sicknesse, and the quintessence preserved.'
]

for (let i = 0; i < 6; i++) {
  const page = doc.addPage(PAGE)
  if (i === 0) {
    page.drawText('THE CHIRURGEON HIS PRACTISE', { x: 96, y: 470, size: 18, font: serif })
    page.drawText('A Digitally Typeset Edition', { x: 132, y: 440, size: 11, font: serif })
    page.drawText('London, 1662', { x: 168, y: 120, size: 10, font: serif })
    continue
  }
  page.drawText('THE CHIRURGEON HIS PRACTISE', { x: 108, y: 600, size: 8, font: serif })
  let y = 560
  for (const line of PROSE) {
    if (line) page.drawText(line, { x: 72, y, size: 11, font: serif })
    y -= 18
  }
  y -= 10
  for (const line of PROSE) {
    if (line) page.drawText(line, { x: 72, y, size: 11, font: serif })
    y -= 18
  }
  page.drawText(String(36 + i), { x: 210, y: 54, size: 9, font: serif })
}

writeFileSync(OUT, await doc.save())
console.log(`wrote ${OUT} — ${doc.getPageCount()} pages, typeset with no images`)
