/**
 * The pixels a ClearScan file kept: every image drawn on the named leaves,
 * written out as PNG with its size and where it sits.
 *
 * ClearScan throws a page's photograph away, but a region it could not turn
 * into text it keeps as the scanner's own bitmap: a display title
 * (The Secret Doctrine, leaf 0), a diagram (Diagram I, leaf 198, 1297×703),
 * and printed rules. Those are real pixels, unlike a render of the leaf, so
 * a figure can be set from them. Greek and Hebrew were converted to (garbled)
 * text rather than kept, so this does not answer those.
 *
 *   npm install --no-save mupdf
 *   node scripts/reading-kit/sd/images.mjs <file.pdf> <out-dir> <leaf> [leaf ...]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const [, , pdf, out, ...leaves] = process.argv
if (!pdf || !out || leaves.length === 0) {
  console.error('usage: images.mjs <file.pdf> <out-dir> <leaf> [leaf ...]')
  process.exit(2)
}
const mupdf = await import('mupdf')
mkdirSync(out, { recursive: true })
const doc = mupdf.Document.openDocument(readFileSync(pdf), 'application/pdf')
for (const leaf of leaves.map(Number)) {
  const page = doc.loadPage(leaf)
  let k = 0
  const write = (image, ctm) => {
    const pm = image.toPixmap()
    const name = `${out}/leaf-${leaf}-${k}.png`
    writeFileSync(name, pm.asPNG())
    const at = ctm.map((x) => Math.round(x)).join(',')
    console.log(`${leaf} ${k++} ${pm.getWidth()}x${pm.getHeight()} at ${at} → ${name}`)
  }
  page.run(new mupdf.Device({ fillImage: write, fillImageMask: write }), mupdf.Matrix.identity)
}
