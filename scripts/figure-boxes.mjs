#!/usr/bin/env node
/**
 * Where the figures are on a rendered leaf, in the coordinates `figure cut`
 * takes — measured off the pixels rather than read off a picture by eye.
 *
 * `drive.mjs figures` reads what `detectIllustrations` found during recon, and
 * on a book whose diagrams are *drawn out of type and rules* it finds nothing
 * at all: the ink test wants a dense region and a syntactic tree is mostly
 * white, while `detectRegions` wants a rectangle with no words in it and a tree
 * is made of words. Measured on _Patterns of the Hypnotic Techniques_ Vol. I:
 * **0 candidates over 121 leaves**, against roughly twenty real diagrams.
 *
 * So the figures on such a book are found by looking, and what this does is
 * make the *box* a measurement once a person has looked. It bands the leaf by
 * clear rows and prints each band's tight ink box, so cutting a figure is
 * picking a band rather than guessing four numbers.
 *
 * ## Two things it has to know about this shape of leaf
 *
 * **A full-height vertical rule ruins banding, silently.** This PDF draws a
 * divider between its two printed pages at x=0.499, and that rule puts ink in
 * 1,119 of the leaf's 1,242 rows — so *no* row is clear, the whole leaf comes
 * back as one band, and the answer looks plausible. Measured: the sweep across
 * gaps of 14, 20, 26 and 34 returned the identical single band every time,
 * which is what a constant answer to a varying question looks like. Any column
 * inked on more than `RULE_SHARE` of the rows is excluded before banding, and
 * the ones found are named.
 *
 * **A band must be found inside one printed page.** With two pages on a leaf
 * the other one is always setting something, so the window is per page. Pass
 * `--window` to say which part of the leaf to look at; without it the leaf is
 * split at the widest vertical rule, or read whole when there is none.
 *
 *   node scripts/figure-boxes.mjs screenshots/fig-75.png
 *   node scripts/figure-boxes.mjs screenshots/fig-75.png --gap 20 --window 0.02,0.49
 *
 * The boxes print ready to paste:
 *
 *   node scripts/drive.mjs figure cut 75 0.059,0.269,0.311,0.186 --after p75b3
 */
import { darkMap, bands, boxOf, colInk } from './lib/ink.mjs'

/** A column inked on more than this share of the leaf's rows is a rule. */
const RULE_SHARE = 0.6

/** Clear rows needed to divide two bands. One leading is ~10px at 150 DPI. */
const DEFAULT_GAP = 20

/** A band shorter than this is a stray mark rather than anything to cut. */
const MIN_ROWS = 6

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}

/** The first argument that is neither a flag nor a flag's value. */
const path = (() => {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      i++
      continue
    }
    return argv[i]
  }
  return null
})()
if (!path) {
  console.error('usage: figure-boxes.mjs <render.png> [--gap 20] [--window 0.02,0.49]')
  process.exit(1)
}

const map = darkMap(path)
const gap = Number(flag('gap', DEFAULT_GAP))

/** Every column that is a rule rather than type. */
const cols = colInk(map, 0, map.height)
const rules = []
for (let x = 0; x < map.width; x++) {
  if (cols[x] > map.height * RULE_SHARE) rules.push(x)
}
/** Group neighbouring rule columns into one rule. */
const ruleRuns = []
for (const x of rules) {
  const last = ruleRuns[ruleRuns.length - 1]
  if (last && x === last.to + 1) last.to = x
  else ruleRuns.push({ from: x, to: x })
}

let windows
const asked = flag('window')
if (asked) {
  const [a, b] = asked.split(',').map(Number)
  windows = [[Math.round(a * map.width), Math.round(b * map.width)]]
} else if (ruleRuns.length > 0) {
  // Split at the rules, and step clear of each so its own ink is never in a
  // window. A rule inside the window is the fault this script exists to avoid.
  const edges = [0]
  for (const r of ruleRuns) {
    edges.push(r.from - 2, r.to + 3)
  }
  edges.push(map.width)
  windows = []
  for (let i = 0; i < edges.length; i += 2) {
    if (edges[i + 1] - edges[i] > map.width * 0.1) windows.push([edges[i], edges[i + 1]])
  }
} else {
  windows = [[0, map.width]]
}

console.log(`${path} — ${map.width}×${map.height}`)
if (ruleRuns.length > 0) {
  console.log(
    `vertical rule(s) excluded: ${ruleRuns
      .map(
        (r) => `x=${r.from}${r.to > r.from ? `–${r.to}` : ''} (${(r.from / map.width).toFixed(3)})`
      )
      .join(', ')} — each inks over ${Math.round(RULE_SHARE * 100)}% of the rows, so banding ` +
      `without excluding it returns the whole leaf as one band and looks fine.`
  )
} else {
  console.log('no full-height rule on this leaf.')
}

for (const [wx0, wx1] of windows) {
  console.log(
    `\n  window x ${wx0}–${wx1} (${(wx0 / map.width).toFixed(3)}–${(wx1 / map.width).toFixed(3)})`
  )
  const found = bands(map, gap, MIN_ROWS, wx0, wx1)
  if (found.length === 0) {
    console.log('    no bands — nothing but white in this window.')
    continue
  }
  for (const b of found) {
    const box = boxOf(map, b.from, b.to, 0, wx0, wx1)
    if (!box) continue
    const tall = b.to - b.from
    console.log(
      `    ${String(tall).padStart(4)}px tall   ` +
        `${box.x.toFixed(3)},${box.y.toFixed(3)},${box.w.toFixed(3)},${box.h.toFixed(3)}`
    )
  }
}
console.log(
  '\nA band is a run of rows with clear rows above and below it, not a verdict that\n' +
    'it is a picture. Look at the render and pick the ones that are.'
)
