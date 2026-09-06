#!/usr/bin/env node
/**
 * Find the horizontal rules a scan's text layer threw away — em dashes.
 *
 * Written for *Unseen Forces*, where the digitiser's OCR encodes not one em
 * dash in the whole book: the layer renders `Cherubim—the` as `Cherubim the`
 * and `Man-bull—all` as `Man-bull-all`, so a reading drafted from that layer
 * loses every one of them, sometimes changing the sense. Nothing in the text
 * can find them, because in the layer they are a space or a hyphen and both are
 * legitimate characters. Only the pixels know.
 *
 *   node scripts/find-dashes.mjs <scan.pdf> <leaf> [leaf...] [--scale 4] [--min 0.55]
 *
 * A dash is a run of ink much wider than any stroke in the face, sitting at
 * mid-height with paper above and below it. `--min` is that width as a fraction
 * of the **font size**, which makes the test independent of the render scale
 * and of the book.
 *
 * The separation is wide and was measured rather than assumed. On this book's
 * text face, at leaf 10: hyphens run 0.56 em, the widest letter stroke (an `f`
 * crossbar, an `e` bar, an `m` serif) 0.75 em, and em dashes 0.99 and 1.21 em.
 * A default of 0.85 sits in empty space between the two groups.
 *
 * The paper-above-and-below test is what separates a dash from an underline or
 * a letter's own crossbar, and it probes a fifth of an em away rather than a
 * fixed three pixels — at three it lands inside a thick dash's own ink and
 * throws the dash away, which is how the first run found one of leaf 10's two
 * and reported the leaf as nearly clean.
 *
 * It reports each find with the layer's text for that line, which is what lets
 * a dash be put back in the right place in a transcription.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const argv = process.argv.slice(2)
const opt = (n, d) => {
  const at = argv.indexOf(n)
  if (at < 0) return d
  const v = argv[at + 1]
  argv.splice(at, 2)
  return v
}
const scale = Number(opt('--scale', '4'))
const minEm = Number(opt('--min', '0.9'))
// The upper bound is loose on purpose. An em dash is one em by definition and
// most of this book's measure 1.05-1.15, but nine confirmed ones run to 1.56,
// and a bound tight enough to exclude the three false positives in that tail
// would have excluded those nine as well.
//
// So this tool PROPOSES and the pixels accept: its output is a candidate list,
// and each candidate is confirmed against a crop before anything is written to
// a transcription. That is the same rule the rest of this project runs on, and
// it is a better use of a threshold than tuning one until it is right about
// every mark in a book it has seen once.
const maxEm = Number(opt('--max', '2'))
const asJson = argv.includes('--json') && argv.splice(argv.indexOf('--json'), 1)
const loose = argv.includes('--loose') && argv.splice(argv.indexOf('--loose'), 1)
const [scan, ...leaves] = argv
if (!scan || !leaves.length) {
  console.error('usage: node scripts/find-dashes.mjs <scan.pdf> <leaf> [leaf...]')
  process.exit(2)
}

const require = createRequire(import.meta.url)
const pdfSrc =
  readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'), 'utf8') +
  '\nwindow.pdfjsLib = { getDocument, GlobalWorkerOptions };'
const workerSrc = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8')
const b64 = readFileSync(scan).toString('base64')

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--allow-file-access-from-files']
})
const page = await browser.newPage()
await page.setContent('<!doctype html><body style="margin:0"><canvas id=c></canvas></body>')
await page.addScriptTag({ content: pdfSrc, type: 'module' })
await page.waitForFunction(() => !!window.pdfjsLib)

const found = await page.evaluate(
  async ({ workerSrc, b64, leaves, scale, minEm, maxEm, loose }) => {
    const pdfjs = window.pdfjsLib
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
      new Blob([workerSrc], { type: 'text/javascript' })
    )
    const doc = await pdfjs.getDocument({
      data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      useSystemFonts: false
    }).promise
    // The em, once, for the whole book.
    //
    // It began as each line's own first item, which is an OCR estimate and
    // wanders — 8.5 to 10.2 on one leaf here — so the same dash measured 1.04
    // em on one line and 0.79 on another and the second fell under the
    // threshold. A page median fixed that and broke something else: on a leaf
    // with a display heading and few body lines the median follows the heading,
    // and a real dash there dropped out entirely.
    //
    // A book has one body size. Pooling every line in the job and taking the
    // median finds it, costs one cheap pass of getTextContent (the rendering is
    // what is expensive), and cannot be pulled about by one page's furniture.
    const pool = []
    for (const leaf of leaves) {
      if (leaf < 0 || leaf >= doc.numPages) continue
      const tc = await (await doc.getPage(leaf + 1)).getTextContent()
      for (const it of tc.items)
        if ('str' in it && it.str.trim()) pool.push(Math.abs(it.transform[0]) || 10)
    }
    pool.sort((a, b) => a - b)
    const bookEm = (pool[Math.floor(pool.length / 2)] || 10) * scale

    const out = []
    for (const leaf of leaves) {
      if (leaf < 0 || leaf >= doc.numPages) continue
      const pg = await doc.getPage(leaf + 1)
      const viewport = pg.getViewport({ scale })
      const c = document.getElementById('c')
      c.width = Math.ceil(viewport.width)
      c.height = Math.ceil(viewport.height)
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      await pg.render({ canvasContext: ctx, viewport }).promise
      const px = ctx.getImageData(0, 0, c.width, c.height).data
      const W = c.width
      const dark = (x, y) => px[(y * W + x) * 4] < 128

      // The layer's lines, to name the place and to give the x-height.
      const items = (await pg.getTextContent()).items.filter((i) => 'str' in i)
      const pageH = pg.getViewport({ scale: 1 }).height
      const lines = []
      let cur = null
      for (const it of items) {
        const y = it.transform[5]
        if (!cur || Math.abs(y - cur.y) > 2) {
          // The layer reports height 0 for every item in this scan, which made
          // the first version's threshold 0 and matched every pixel on the
          // page. The font size is in the transform's horizontal scale and is
          // always there, so that is what the ratio is taken against.
          cur = { y, size: Math.abs(it.transform[0]) || 10, text: '', runs: [] }
          lines.push(cur)
        }
        cur.text += it.str
        // Kept with their x span so a dash can be told what words it sits
        // between. Finding the dash is only half the job: putting it back in a
        // transcription needs to know where, and the layer is what knows.
        cur.runs.push({
          str: it.str,
          x0: it.transform[4] * scale,
          x1: (it.transform[4] + (it.width ?? 0)) * scale
        })
      }
      for (const l of lines) {
        const em = bookEm
        const min = Math.max(8, Math.round(em * minEm))
        const top = Math.round((pageH - l.y - l.size) * scale)
        const bot = Math.round((pageH - l.y) * scale)
        if (top < 1 || bot >= c.height - 1) continue
        const hits = []
        for (let y = top; y <= bot; y++) {
          let run = 0
          for (let x = 1; x < W; x++) {
            if (dark(x, y)) run++
            else {
              if (run >= min) {
                const x0 = x - run
                // A dash is THIN. That is the discriminator, and it took
                // three wrong ones to get to it.
                //
                // The first test asked for paper a fixed fraction of an em
                // above and below; that distance landed inside the ink of a
                // dash that printed thick, and lost it. Measuring the mark's
                // own extent and probing just past it lost eighteen more, all
                // confirmed dashes. Making the probe adaptive inverted the test
                // altogether — a letter is tall, so its probe reaches past the
                // glyph and every crossbar came back clear.
                //
                // What separates them is not clearance at any distance but how
                // much ink stands over the run's own columns. A dash is a few
                // pixels of it. An `f` bar or a `t` bar has a stem through it,
                // an underline has a word above it. Sampled across the run
                // rather than at one column, because one column can fall in the
                // gap between two letters and read thin anywhere.
                let thick = 0
                for (let s = 1; s <= 5; s++) {
                  const col = x0 + Math.round((run * s) / 6)
                  let up = y
                  let down = y
                  while (up > 1 && dark(col, up - 1)) up--
                  while (down < c.height - 2 && dark(col, down + 1)) down++
                  thick = Math.max(thick, down - up + 1)
                }
                // A dash sits at mid x-height; an underline sits BELOW the
                // baseline. Without this the tool is unusable on a typescript,
                // where the underlining is heavy: manuscript 27 returned 84
                // rules on nine leaves and nearly every one was a rule under a
                // word. Thinness alone cannot tell them apart, because an
                // underline is thin and is separated from its word by paper, so
                // walking up from it stops at once.
                const overBaseline = y <= bot - em * 0.12
                const clear =
                  thick <= Math.max(4, em * 0.22) && overBaseline && (loose || run <= em * maxEm)
                if (clear || loose)
                  hits.push({ x0, w: run, y, thick, ratio: +(run / em).toFixed(2) })
              }
              run = 0
            }
          }
        }
        // One dash inks several rows, and the run is a pixel or two wider on
        // some of them. Keyed on the left edge alone it came back twice on a
        // line where those edges differed by more than the tolerance, so hits
        // are merged when their spans OVERLAP and the widest is kept — the
        // widest row being the one that measures the mark rather than a
        // partly-inked edge of it.
        // Rows are clustered by overlap and the cluster reports its MEDIAN
        // row. Not the widest: on the rows where a dash's ink meets the letter
        // beside it the run measures half again as long, and taking the widest
        // moved ten dashes out of the dash band and into the group this tool
        // calls something else. Not the narrowest either, which is a partly
        // inked edge. The median row is the one that measures the mark.
        const clusters = []
        for (const h of hits.sort((a, b) => a.x0 - b.x0)) {
          const into = clusters.find((c) => c.some((k) => h.x0 < k.x0 + k.w && k.x0 < h.x0 + h.w))
          if (into) into.push(h)
          else clusters.push([h])
        }
        const kept = clusters.map((c) => {
          const byW = [...c].sort((a, b) => a.w - b.w)
          return byW[Math.floor(byW.length / 2)]
        })
        const li = lines.indexOf(l)
        for (const k of kept) {
          // The words either side.
          //
          // Finding the dash is half the job; putting it back in a
          // transcription needs to know where it goes. The layer knows, but not
          // conveniently: its items are runs of arbitrary length — a whole
          // line, a single word, or a lone space exactly where a dash was — so
          // there is no item boundary to read the answer off.
          //
          // So the line is treated as one string with a position for every
          // character: each run's characters are spread across its own x span,
          // and a dash's centre falls either inside a run or in the gap between
          // two. That is one mechanism instead of a case for each shape, and
          // the cases were what kept producing confident wrong answers —
          // neighbours taken from the lines above and below when a dash sat at
          // the end of a run.
          //
          // The index is then snapped to the nearest space or hyphen, because
          // the digitiser writes an em dash as a wide space or as a hyphen and
          // never as a dash. Which of the two it wrote is reported, since it
          // says what the transcription inherited.
          const cx = k.x0 + k.w / 2
          const text = l.runs.map((r) => r.str).join('')
          let idx = null
          let acc = 0
          for (const r of l.runs) {
            if (cx < r.x0) {
              idx = acc
              break
            }
            if (cx <= r.x1) {
              const f = (cx - r.x0) / Math.max(1, r.x1 - r.x0)
              idx = acc + Math.round(f * r.str.length)
              break
            }
            acc += r.str.length
          }
          if (idx === null) idx = acc
          // A hyphen beats a space when both are in reach. The layer writes a
          // dash either way, but a space is ambiguous with an ordinary word
          // space where a hyphen carrying an em of ink is not — and the
          // proportional estimate is good to a character or two, not better, so
          // on `God-or Brahma` it snapped to the space after the token and
          // named the wrong gap. The dash was real; the place was not, and a
          // dash put back in the wrong place is worse than one left out.
          const near = (want) => {
            for (let d = 0; d <= 8; d++)
              for (const i of [idx - d, idx + d])
                if (i >= 0 && i < text.length && text[i] === want) return i
            return -1
          }
          const at = near('-') >= 0 ? near('-') : near(' ')
          const sep = at >= 0 ? text[at] : ' '
          const cut = at >= 0 ? at : idx
          const lastWord = (t) => t.trim().split(/\s+/).filter(Boolean).pop() || ''
          const firstWord = (t) => t.trim().split(/\s+/).filter(Boolean)[0] || ''
          let before = lastWord(text.slice(0, cut))
          let after = firstWord(text.slice(at >= 0 ? at + 1 : cut))
          if (!before) before = lastWord(li > 0 ? lines[li - 1].text : '')
          if (!after) after = firstWord(li + 1 < lines.length ? lines[li + 1].text : '')
          out.push({ leaf, ...k, line: l.text.trim(), before, after, sep })
        }
      }
    }
    return out
  },
  { workerSrc, b64, leaves: leaves.map(Number), scale, minEm, maxEm, loose: !!loose }
)
await browser.close()
if (asJson) console.log(JSON.stringify(found, null, 1))
else {
  for (const f of found)
    console.log(
      `leaf ${f.leaf}  ${f.w}px (${f.ratio} em)  ` +
        `${f.before} ][${f.sep === '-' ? '-' : ' '}][ ${f.after}   ${f.line}`
    )
  console.log(`-- ${found.length} rule(s) in ${leaves.length} leaf/leaves`)
}
