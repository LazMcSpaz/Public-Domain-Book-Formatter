/**
 * Mechanical clean-up of a draft, for the NLP books read at the lighter
 * standard (personal study, not publication — see nlp/PROMPT.md).
 *
 *   node scripts/reading-kit/nlp/rules.mjs <draft.json> <out.json>
 *
 * Three classes, each one the draft gets wrong on every leaf and none of
 * which needs a reader's judgement:
 *
 *   - Running heads the draft left in the text: a title, a rule of dashes
 *     and a folio (`MENTAL MAPPNG —n—m——— 111`), or the Dummies form
 *     (`— Chapter 6: Seeing, Hearing … 99`). Emptied.
 *   - Junk blocks: specks and bleed-through on blank leaves (`oo`, `£`, `~`),
 *     a block with fewer than three letters in it. Emptied.
 *   - `|` read for the pronoun I (`| woke up`) → `I`; a `|` left at the end
 *     of a line or block by the page edge → removed.
 *
 * Every change is counted; a reader checks each leaf against the image after.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , inPath, outPath] = process.argv
const pages = JSON.parse(readFileSync(inPath, 'utf8'))

const dashes = /[—–-]{4,}|(?:[—–][^\s]{0,3}){3,}/u
const head = (t) => {
  const s = t.trim()
  if (s.length > 140 || s.includes('\n')) return false
  if (dashes.test(s) && /\d{1,3}\s*$|^\S{0,3}\s*\d{1,3}\b/u.test(s)) return true
  if (dashes.test(s) && s.length < 90) return true
  // Dummies: "— Chapter 6: … 99", "Part II: … 45", "98 Part II: …"
  if (/^[—–\-_=~\s]*(\d{1,3}\s+)?(Chapter \d+|Part [IVX]+):.{0,90}?\s\d{1,3}\s*[|\]]?$/u.test(s))
    return true
  if (/^\d{1,3}\s+(Part [IVX]+|Chapter \d+):/u.test(s) && s.length < 110) return true
  return false
}
const letters = (t) => (t.match(/\p{L}/gu) ?? []).length

let heads = 0
let junk = 0
let bars = 0
for (const page of pages) {
  for (const b of page.blocks ?? []) {
    const t = b.text ?? ''
    if (t && head(t)) {
      b.text = ''
      heads++
      continue
    }
    if (t && letters(t) < 3) {
      b.text = ''
      junk++
      continue
    }
    // A verso's head comes back as the first line of the first body block.
    let u = t
    const nl = u.indexOf('\n')
    if (nl > 0 && head(u.slice(0, nl))) {
      u = u.slice(nl + 1)
      heads++
    }
    // A speck at the page edge read as punctuation before the first word.
    u = u.replace(/^[.:,;|~'‘]\s+(?=[A-Za-z“"])/u, () => {
      bars++
      return ''
    })
    u = u.replace(/(^|[\s“"(])\|(?=\s+[a-z’'])/gu, (_, p) => {
      bars++
      return `${p}I`
    })
    u = u.replace(/\s+\|(?=\s*(\n|$))/gu, () => {
      bars++
      return ''
    })
    b.text = u
  }
}
writeFileSync(outPath, JSON.stringify(pages, null, 1) + '\n')
console.log(`nlp rules: ${heads} running heads, ${junk} junk blocks emptied; ${bars} bars`)
