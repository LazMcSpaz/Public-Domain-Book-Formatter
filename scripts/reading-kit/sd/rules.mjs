/**
 * The conversion's own damage on The Secret Doctrine, taken off a draft before
 * any reader sees it. Every class here is ClearScan's rather than the 1888
 * compositor's, and each is settled by something other than a guess:
 *
 *   the TUP stamp          "Theosophical University Press Online Edition" is
 *                          the file's, on every leaf; not 1888 matter.
 *   words split by spaces  `con ditioned`, `f or i t i s`: joined only where
 *                          the second reading of the same leaf (Tesseract over
 *                          ClearScan's render, `<kit>/second.json`) sets the
 *                          joined word and does not set the pieces apart.
 *   a space before , or .  no setting of any period puts one there.
 *   straight quotes        the layer flattens every mark to `"` and `'`; the
 *                          render and the 1888 page curl them.
 *   note marks at a note's head   `•` is `*`, a lone `t` or `+` is `†` — the
 *                          glyph the layer substitutes, read at the one place
 *                          where the mark cannot be a word.
 *
 * Spacing before ; : ! ? and inside quotation marks is closed up too, and that
 * one is a choice rather than a fact: neither reading can say what the 1888
 * compositor set there. It is written up for the editor in the book's ledger.
 *
 *   node scripts/reading-kit/sd/rules.mjs <kit> <draft.json> <ruled.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , kit, inPath, outPath] = process.argv
const pages = JSON.parse(readFileSync(inPath, 'utf8'))
const second = JSON.parse(readFileSync(`${kit}/second.json`, 'utf8'))
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const counts = { stamp: 0, joins: 0, points: 0, quotes: 0, marks: 0 }
const joined = []

const STAMP = /\s*Theosophical\s+University\s+Press\s+Online\s+Edition\s*/giu

/** A line-end hyphen in the second reading is its line break, not a word boundary. */
const healed = (t) => t.replace(/(\p{L})- (\p{Ll})/gu, '$1$2')
function wordsOf(text) {
  return healed(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
}
/** How often the whole volume's second reading sets each word. */
const volume = new Map()
for (const t of Object.values(second))
  for (const w of wordsOf(t)) volume.set(w, (volume.get(w) ?? 0) + 1)
const isWord = (w) => (w.length === 1 ? /^[aio]$/u.test(w) : (volume.get(w) ?? 0) >= 3)

function witnessWords(leaf) {
  return healed(second[String(leaf)] ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
}

/** Join tokens the witness sets whole and never sets apart. */
function joinSplits(text, words, wordSet) {
  const seq = ' ' + words.join(' ') + ' '
  const toks = text.split(' ')
  const out = []
  for (let i = 0; i < toks.length;) {
    let took = 1
    for (let k = Math.min(7, toks.length - i); k >= 2; k--) {
      const run = toks.slice(i, i + k)
      // Punctuation may open the first piece and close the last, never sit inside.
      if (run.slice(0, -1).some((t) => /[^\p{L}\p{N}]$/u.test(t))) continue
      if (run.slice(1).some((t) => /^[^\p{L}\p{N}]/u.test(t))) continue
      if (run.some((t) => norm(t) === '')) continue
      const whole = run.map(norm).join('')
      if (whole.length < 2 || !wordSet.has(whole)) continue
      if (seq.includes(' ' + run.map(norm).join(' ') + ' ')) continue
      // Real words either side and a join the volume never sets elsewhere is
      // the second reading running words together (`wellsupas`), not ours
      // splitting one.
      if (run.every((t) => isWord(norm(t))) && (volume.get(whole) ?? 0) < 2) continue
      // `I am`, `a part`: a one-letter word beside real words is a phrase.
      if (run.every((t) => isWord(norm(t))) && run.some((t) => norm(t).length === 1)) continue
      out.push(run.join(''))
      joined.push(run.join(' '))
      counts.joins++
      took = k
      break
    }
    if (took === 1) out.push(toks[i])
    i += took
  }
  return out.join(' ')
}

/**
 * Curl the layer's straight quotes. A mark hard against a word on one side and
 * clear on the other says which way it faces; one with space on both sides
 * (`Cause , " the`) takes the direction the block's open marks leave it.
 */
function curl(text) {
  const out = [...text]
  const open = { '"': false, "'": false }
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    if (c !== '"' && c !== "'") continue
    const before = out[i - 1] ?? ' '
    const after = out[i + 1] ?? ' '
    const wordBefore = /[\p{L}\p{N}.,;:!?)\]]/u.test(before)
    const wordAfter = /[\p{L}\p{N}(]/u.test(after)
    let closing
    if (c === "'" && /\p{L}/u.test(before) && /\p{L}/u.test(after)) closing = true
    else if (wordBefore && !wordAfter) closing = true
    else if (!wordBefore && wordAfter) closing = false
    else closing = open[c]
    if (c === '"' || !(closing && /\p{L}/u.test(before) && /\p{L}/u.test(after))) open[c] = !closing
    out[i] = c === '"' ? (closing ? '”' : '“') : closing ? '’' : '‘'
    counts.quotes++
  }
  return out.join('')
}

function points(text) {
  let n = 0
  const t = text
    .replace(/(?<=[\p{L}\p{N})\]”’.*†]) +(?=[,;:!?])/gu, () => (n++, ''))
    .replace(/(?<=[\p{L}\p{N})\]”’]) +\.(?! ?\.)/gu, () => (n++, '.'))
    .replace(/([“‘(]) +(?=[\p{L}\p{N}])/gu, (_, a) => (n++, a))
    .replace(/(?<=[\p{L}\p{N}.,;:!?)]) +(?=[”’](?:\s|$|[,.;:!?)]))/gu, () => (n++, ''))
  counts.points += n
  return t
}

for (const page of pages) {
  const words = witnessWords(page.pageIndex)
  const wordSet = new Set(words)
  for (const block of page.blocks ?? []) {
    let t = block.text
    if (STAMP.test(t)) {
      counts.stamp++
      t = t.replace(STAMP, ' ').trim()
    }
    t = joinSplits(t, words, wordSet)
    t = curl(t)
    t = points(t)
    // A mark in the text, hard against the word it refers from.
    t = t.replace(/(?<=[\p{L}.,;:”’)])\+/gu, () => (counts.marks++, '†'))
    t = t.replace(/(?<=[\p{L}.,;:”’)])•/gu, () => (counts.marks++, '*'))
    if (block.kind === 'footnote') {
      const m = t.match(/^(•+|[t+](?= [A-Z“‘]))/u)
      if (m) {
        counts.marks++
        t = (m[1].startsWith('•') ? '*'.repeat(m[1].length) : '†') + t.slice(m[1].length)
      }
    }
    block.text = t.replace(/\s{2,}/gu, ' ').trim()
  }
}
// A block that held only the stamp is nothing now: drop it before a reader
// has to decide what an empty heading's level is.
for (const page of pages)
  page.blocks = (page.blocks ?? []).filter((b) => b.text !== '' || b.kind === 'table')
writeFileSync(outPath, JSON.stringify(pages, null, 1) + '\n')
console.log(
  `stamp ${counts.stamp}, joins ${counts.joins}, spacing ${counts.points}, quotes ${counts.quotes}, note marks ${counts.marks}`
)
for (const j of joined.slice(0, 12)) console.log(`   joined: ${j}`)
