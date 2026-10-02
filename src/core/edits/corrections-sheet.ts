/**
 * The corrections sheet: what changed between the pristine reading and the
 * edited book, as a list a person can read.
 *
 * `corrections.md` on the shelf is two things. The prose at its head is the
 * editor's — what was found, how, and what was left alone — and no amount of
 * reading `book.json` would recover a sentence of it. The entries under it are
 * *derived*: every block whose edited text differs from its pristine text,
 * with the words either side of each change. Until this module the entries
 * were built by a script that lived in one session's scratchpad, so the
 * sheet drifted from the book the moment the session ended, and nothing could
 * say so. `book-files.mjs --body` compares the two now, and
 * `drive.mjs corrections` rewrites them.
 *
 * Two decisions are worth stating. The diff is taken on the **bare** text,
 * with the `<i>` and `<b>` notation stripped, because an italic put back is
 * not a correction and an entry for it would bury the ones that are. And a
 * change that only turns a plain digit into its superscript — a reference
 * mark the conversion set as an ordinary numeral — is listed apart from the
 * word corrections, because twenty-six of those on one sheet would drown the
 * `hut` for `but` a reader is looking for.
 */

/** A block as `drive.mjs body` hands it back: an id and its marked-up text. */
export interface SheetBlock {
  id: string
  text: string
  /**
   * The leaf, for a text whose id does not carry one: a footnote is `fn12`,
   * numbered through the book, and printed on the leaf `pageIndex` names.
   * Without it a note's corrections could not be placed or sorted, and the
   * sheet listed none of them: 101 on _The Secret Doctrine_ Vol. I, a sheet
   * that described the body and was silent about the notes.
   */
  leaf?: number
}

/** One change, with the words either side of it. */
export interface CorrectionRow {
  /** The leaf the block began on, read off its id. */
  leaf: number
  blockId: string
  /** The pristine words around the change. */
  printed: string
  /** The edited words around it. */
  now: string
}

export interface CorrectionRows {
  /** Changes to what the book says. */
  words: CorrectionRow[]
  /** A plain-digit reference mark set as its superscript, and nothing else. */
  marks: CorrectionRow[]
}

/** Words shown either side of a change. */
export const CONTEXT_WORDS = 3

const TAG = /<\/?(?:i|b|strong|em|sc)>/gu

const bare = (text: string): string => text.replace(TAG, '')

const wordsOf = (text: string): string[] => text.split(/\s+/u).filter(Boolean)

/** The leaf and block index a derived id carries: `p120b3` → 120, 3. */
const placeOf = (id: string): [number, number] => {
  const m = /^p(\d+)b(\d+)/u.exec(id)
  return m ? [Number(m[1]), Number(m[2])] : [Number.MAX_SAFE_INTEGER, 0]
}

/** Where a text sits: its leaf, and its order on it (a note after the body). */
const placeOfBlock = (block: SheetBlock): [number, number] =>
  block.leaf === undefined ? placeOf(block.id) : [block.leaf, Number.MAX_SAFE_INTEGER]

interface Hunk {
  i1: number
  i2: number
  j1: number
  j2: number
}

/**
 * The stretches of two word lists that differ, as ranges into each.
 *
 * Longest common subsequence over words rather than characters: a correction
 * is a word, and a character diff of `hut` against `but` gives a window that
 * starts mid-word. Quadratic, which is fine for one paragraph and never runs
 * over a block that has not changed.
 */
export function wordHunks(a: string[], b: string[]): Hunk[] {
  const n = a.length
  const m = b.length
  // lcs[i][j] = length of the LCS of a[i..] and b[j..], flattened.
  const w = m + 1
  const lcs = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * w + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let open: Hunk | null = null
  const close = () => {
    if (open) hunks.push(open)
    open = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close()
      i++
      j++
      continue
    }
    if (!open) open = { i1: i, i2: i, j1: j, j2: j }
    if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      i++
      open.i2 = i
    } else {
      j++
      open.j2 = j
    }
  }
  close()
  return hunks
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const SUPERSCRIPT_RUN = new RegExp(`[${SUPERSCRIPT}]+`, 'u')

/**
 * Whether a change only sets a reference mark as its superscript.
 *
 * `patients. 2 Observations` → `patients.² Observations` is the shape: the
 * edited text carries a superscript run, and writing it back as plain digits,
 * with or without the space the conversion put before it, gives the printed
 * text exactly. An `l` or `I` standing for a `1` and an `O` for a `0` are
 * allowed on the printed side, because that is how a numeral comes through
 * a conversion that has never seen it, and `grammar. l7` is a `¹⁷`.
 */
export function isMarkRestoration(printed: string, now: string): boolean {
  const m = SUPERSCRIPT_RUN.exec(now)
  if (!m) return false
  const plain = [...m[0]].map((c) => String(SUPERSCRIPT.indexOf(c))).join('')
  const head = now.slice(0, m.index)
  const tail = now.slice(m.index + m[0].length)
  const digitsOf = (s: string) => s.replace(/[lI]/gu, '1').replace(/O/gu, '0')
  for (const sep of [' ', '']) {
    const candidate = head + sep + plain + tail
    if (candidate === printed) return true
    // Only the mark itself may be read leniently; the words either side
    // must agree to the letter.
    if (
      printed.startsWith(head + sep) &&
      printed.endsWith(tail) &&
      digitsOf(printed.slice(head.length + sep.length, printed.length - tail.length)) === plain
    )
      return true
  }
  return false
}

/** `CONTEXT_WORDS` either side of a range, with an ellipsis where it was cut. */
const window = (words: string[], from: number, to: number): string => {
  const a = Math.max(0, from - CONTEXT_WORDS)
  const b = Math.min(words.length, to + CONTEXT_WORDS)
  return (a > 0 ? '…' : '') + words.slice(a, b).join(' ') + (b < words.length ? '…' : '')
}

/**
 * Every change between the pristine blocks and the edited ones, sorted by
 * leaf and block, split into word corrections and restored reference marks.
 *
 * A block in one list and not the other is not a correction: a block the
 * edits dropped or added is a structural change and reported elsewhere.
 */
export function correctionRows(pristine: SheetBlock[], edited: SheetBlock[]): CorrectionRows {
  const before = new Map(pristine.map((b) => [b.id, bare(b.text)]))
  const rows: { row: CorrectionRow; mark: boolean; at: [number, number] }[] = []
  const seen = new Set<string>()
  for (const block of edited) {
    const old = before.get(block.id)
    if (old === undefined) continue
    const now = bare(block.text)
    if (old === now) continue
    const a = wordsOf(old)
    const b = wordsOf(now)
    for (const h of wordHunks(a, b)) {
      const row: CorrectionRow = {
        leaf: placeOfBlock(block)[0],
        blockId: block.id,
        printed: window(a, h.i1, h.i2),
        now: window(b, h.j1, h.j2)
      }
      const key = [row.blockId, row.printed, row.now].join('\n')
      if (seen.has(key)) continue
      seen.add(key)
      // Judged on the words that changed, never on the window: a second
      // correction within three words of a mark puts different words in
      // the two windows, and the mark was being listed as a word change.
      const mark = isMarkRestoration(a.slice(h.i1, h.i2).join(' '), b.slice(h.j1, h.j2).join(' '))
      rows.push({ row, mark, at: placeOfBlock(block) })
    }
  }
  rows.sort((x, y) => {
    const [lx, bx] = x.at
    const [ly, by] = y.at
    return lx - ly || bx - by
  })
  return {
    words: rows.filter((r) => !r.mark).map((r) => r.row),
    marks: rows.filter((r) => r.mark).map((r) => r.row)
  }
}

/** Where the derived entries begin in a corrections file. */
const ENTRIES_AT = /\n\*\*leaf \d+\*\*/u

const MARKS_HEADING = '## The reference marks'

/**
 * The editor's prose at the head of a corrections file, and nothing derived.
 *
 * Everything above the first entry is kept. A file with no entries yet is all
 * header; a missing file gets the one line that makes the counts checkable.
 */
export function correctionsHeader(existing: string | null, title: string): string {
  if (existing === null)
    return `# Corrections applied to *${title}*\n\n0 corrections, 0 reference marks restored.\n`
  const at = ENTRIES_AT.exec(existing)
  let head = at ? existing.slice(0, at.index) : existing
  // The heading over the second list is emitted with the entries, so a file
  // whose word list is empty must not keep it in the header.
  head = head.replace(new RegExp(`\\n${MARKS_HEADING}\\s*$`, 'u'), '\n')
  return head.replace(/\s+$/u, '') + '\n'
}

const COUNTS = /^(\d+) corrections?, (\d+) reference marks?/mu

/** The header with its count line brought level with the rows. */
export function withCounts(header: string, rows: CorrectionRows): string {
  return header.replace(
    COUNTS,
    `${rows.words.length} correction${rows.words.length === 1 ? '' : 's'}, ` +
      `${rows.marks.length} reference mark${rows.marks.length === 1 ? '' : 's'}`
  )
}

const entry = (r: CorrectionRow): string =>
  `\n**leaf ${r.leaf}** · \`${r.blockId}\`  \nprinted: ${r.printed}  \nnow: ${r.now}\n`

/** The whole file: the editor's header, counts corrected, then the entries. */
export function correctionsMarkdown(header: string, rows: CorrectionRows): string {
  const words = rows.words.map(entry).join('')
  const marks = rows.marks.length ? `\n\n${MARKS_HEADING}\n${rows.marks.map(entry).join('')}` : ''
  return withCounts(header, rows) + words + marks + '\n'
}

/** The counts a corrections file claims, or null where it makes none. */
export function claimedCounts(text: string): { words: number; marks: number } | null {
  const m = COUNTS.exec(text)
  return m ? { words: Number(m[1]), marks: Number(m[2]) } : null
}

/** A block whose edited text stops short of where its pristine text ends. */
export interface CutShort {
  blockId: string
  /** Where the edited text now stops, and where the printed paragraph did. */
  editedEnds: string
  pristineEnds: string
}

/**
 * Blocks an edit has cut off before the end of their paragraph.
 *
 * A correction written against one leaf's text rather than the assembled block
 * holds the paragraph only to the page seam, and everything the next leaf
 * contributed is gone from the book: on _Patterns_ Vol. II eight hundred
 * characters, on _Clairvoyance_ two paragraph tails, and every check was happy,
 * because a shorter paragraph looks exactly like a paragraph. CLAUDE.md names
 * the fault; this is the check for it. A block is named when its edited text
 * is shorter than the pristine and the pristine's last words are not among the
 * edited text's last words. A tail of fewer than three real words (a diagram's
 * garbled caption replaced on purpose) says nothing either way and is skipped,
 * and so is a tail that stands elsewhere in the book: moved, not lost.
 */
/** Characters of a paragraph's printed ending that, kept, prove it was not cut. */
const ENDING = 20

export function cutShortBlocks(pristine: SheetBlock[], edited: SheetBlock[]): CutShort[] {
  const before = new Map(pristine.map((b) => [b.id, bare(b.text)]))
  const out: CutShort[] = []
  // Every block as it now stands, so a tail that was moved to where the paper
  // sets it is told from one that was lost. _Persuasion Engineering_ leaf 15's
  // last line had been read onto the end of the leaf's first paragraph; put
  // back, it is still in the book, only not at the end of that block.
  const everything = edited.map((b) => bare(b.text)).join('\n')
  for (const block of edited) {
    const old = before.get(block.id)
    if (old === undefined) continue
    const now = bare(block.text)
    if (now.length >= old.length - 15) continue
    // Still ending as the printed paragraph ended: shorter because junk was
    // replaced, not because the tail went. On leaf 481 of _The Secret
    // Doctrine_ Vol. II the tail's only lettered words were the junk.
    if (now.endsWith(old.slice(-ENDING))) continue
    const lastOld = wordsOf(old)
      .filter((w) => /\p{L}{2,}/u.test(w))
      .slice(-8)
    if (lastOld.length < 3) continue
    const lastNow = new Set(wordsOf(now).slice(-20))
    const kept = lastOld.filter((w) => lastNow.has(w)).length
    if (kept >= 3) continue
    // The printed tail stands elsewhere in the book: moved, not cut.
    const tail = old.slice(-3 * ENDING).replace(/^\S*\s/u, '')
    if (tail.length >= ENDING && !now.includes(tail) && everything.includes(tail)) continue
    out.push({ blockId: block.id, editedEnds: now.slice(-50), pristineEnds: old.slice(-50) })
  }
  return out
}
