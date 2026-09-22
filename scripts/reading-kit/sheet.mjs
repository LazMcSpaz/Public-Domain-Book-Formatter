/**
 * A rulings sheet: every query still waiting on the named leaves, each over
 * the crop `drive.mjs querycrops` cut for it, as one JPEG the editor can
 * read on a phone. Built because the editor asked for crops with anything
 * that needs a ruling, and a sheet is one file to send rather than thirty.
 *
 *   node scripts/drive.mjs querycrops <cropdir> 213 214 233
 *   node scripts/reading-kit/sheet.mjs <book.json> <cropdir> <out.jpg> 213 214 233
 *
 * Needs Playwright's Chromium; set CHROME to its executable if it is not
 * where Playwright installed it.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { chromium } from 'playwright'

const [, , bookPath, cropDir, outPath, ...leafArgs] = process.argv
if (!bookPath || !cropDir || !outPath || leafArgs.length === 0) {
  console.error('usage: sheet.mjs <book.json> <cropdir> <out.jpg> <leaf...>')
  process.exit(2)
}
const D = resolve(cropDir)
const book = JSON.parse(readFileSync(bookPath, 'utf8'))
const ruled = new Set((book.run.rulings ?? []).map((r) => `${r.pageIndex}|${r.quote}`))
const want = new Set(leafArgs.map(Number))
const qs = []
for (const p of book.run.transcriptions ?? []) {
  if (!want.has(p.pageIndex)) continue
  for (const q of p.queries ?? []) {
    if (!ruled.has(`${p.pageIndex}|${q.quote}`)) qs.push({ leaf: p.pageIndex, ...q })
  }
}
qs.sort((a, b) => a.leaf - b.leaf)
const byLeaf = {}
for (const f of readdirSync(D).sort()) {
  const l = f.split('-')[1]
  ;(byLeaf[l] ??= []).push(f)
}
const esc = (s) => String(s).replace(/</gu, '&lt;')
let html = '<html><body style="font:15px Georgia;margin:16px;width:1400px">'
let n = 0
for (const q of qs) {
  const f = (byLeaf[q.leaf] || []).shift()
  if (!f) {
    console.error(`leaf ${q.leaf}: no crop for ${JSON.stringify(q.quote).slice(0, 40)}`)
    continue
  }
  n++
  const big = statSync(join(D, f)).size > 500000
  html +=
    `<div style="margin:0 0 22px;padding:12px;border:1px solid #bbb">` +
    `<div style="font-weight:bold;margin-bottom:6px">leaf ${q.leaf} · <span style="font-weight:normal">${esc(q.quote)}</span></div>` +
    `<div style="color:#444;margin-bottom:8px;font-size:13px">${esc(q.why).slice(0, 300)}</div>` +
    `<img src="file://${join(D, f)}" style="${big ? 'width:1360px' : 'max-width:1360px'};display:block;border:1px solid #ddd"></div>`
}
html += '</body></html>'
const htmlPath = outPath.replace(/\.jpe?g$/u, '') + '.html'
writeFileSync(htmlPath, html)
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } })
await p.goto('file://' + resolve(htmlPath))
await p.screenshot({ path: outPath, fullPage: true, type: 'jpeg', quality: 78 })
await b.close()
console.log(
  `on the sheet: ${n} of ${qs.length} waiting on leaves ${[...want].join(', ')} → ${outPath}`
)
