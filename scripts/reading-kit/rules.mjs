/**
 * The five classes the editor confirmed against crops, applied to a draft.
 *
 * Four of them need no edit at all: they are places where OUR reading is
 * already right and the second reader is wrong, so the rule's whole job is to
 * take the row off the list a person is asked to look at. Only the language
 * tag changes the text.
 *
 *   (S%.) (S4.) -> (Sk.)   Paddle right. Crop: the page prints `(Sk.)`.
 *   Google watermark       Not 1892 matter; ours never read it.
 *   Paddle's `nm` for `m`  Ours right. Crop: the page prints `name`.
 *   Paddle's `o` for `0`   Ours right. The editor ruled it: "it's 60".
 *
 * Every change is reported, and nothing here is applied to a place the crops
 * did not cover.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , inPath, outPath] = process.argv
const pages = JSON.parse(readFileSync(inPath, 'utf8'))

const TAG = /\(\s*S\s*[%4]\s*\.\s*\)/gu
let tagFixed = 0
const changes = []
for (const page of pages) {
  for (const block of page.blocks ?? []) {
    const before = block.text
    const after = before.replace(TAG, '(Sk.)')
    if (after !== before) {
      const n = (before.match(TAG) ?? []).length
      tagFixed += n
      changes.push({ leaf: page.pageIndex, n, sample: before.slice(0, 60) })
      block.text = after
    }
  }
}
writeFileSync(outPath, JSON.stringify(pages, null, 1) + '\n')
console.log(`(Sk.) tag restored in ${tagFixed} places across ${changes.length} blocks`)
for (const c of changes.slice(0, 8))
  console.log(`   leaf ${String(c.leaf).padStart(3)}  ${c.n}x  ${c.sample}…`)
