/**
 * A Markdown sheet read into plain blocks, so the Workroom's reading view can
 * show a readiness report, a draft or a ledger as ordinary text with headings,
 * lists and tables, never as raw GitHub.
 *
 * Deliberately small: the Markdown the tools and sessions write (headings,
 * paragraphs, lists, block quotes, fenced code, pipe tables, rules, strong,
 * emphasis, code and links). Anything else comes through as the text it is,
 * never dropped and never read as markup: the view builds elements from these
 * blocks, so nothing in a sheet is ever handed to the page as HTML. HTML
 * comments are left out, as GitHub leaves them out.
 *
 * Pure: text in, blocks out.
 */

export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong' | 'em'; spans: Span[] }
  | { kind: 'link'; href: string; spans: Span[] }

export interface ListItem {
  /** How far the item is indented: 0 at the margin, one more per level. */
  depth: number
  /** A task box: true ticked, false empty, null none. */
  check: boolean | null
  spans: Span[]
}

export type MdBlock =
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'quote'; blocks: MdBlock[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: Span[][]; rows: Span[][][] }
  | { kind: 'rule' }

const FENCE = /^\s{0,3}(`{3,}|~{3,})/u
/**
 * A heading line; its text is everything after the marks, trimmed and cut by
 * `headingText`. Never `(.*?)\s*#*\s*$`: with a long run of spaces inside
 * the text, that backtracks for minutes (3,000 spaces froze the page).
 */
const HEADING = /^\s{0,3}(#{1,6})\s(.*)$/u
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/u
const ITEM = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/u
const QUOTE = /^\s{0,3}>\s?(.*)$/u
/** Tested on a trimmed line: leading and trailing `\s*` around `\|?` backtrack on a long run of spaces. */
const TABLE_RULE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/u

/** The blocks of a Markdown text. */
export function markdownBlocks(text: string): MdBlock[] {
  const lines = text
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
  return blocksOf(lines)
}

function blocksOf(lines: string[]): MdBlock[] {
  const blocks: MdBlock[] = []
  let para: string[] = []
  const endPara = (): void => {
    if (para.length > 0) blocks.push({ kind: 'paragraph', spans: inline(para.join(' ')) })
    para = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      endPara()
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      endPara()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!))
        body.push(lines[i++]!)
      blocks.push({ kind: 'code', text: body.join('\n') })
      i++
      continue
    }
    // An underline under a one-line paragraph makes it a heading, as GitHub reads it.
    if (para.length === 1 && /^\s{0,3}(=+|-+)\s*$/u.test(line)) {
      blocks.push({ kind: 'heading', level: line.includes('=') ? 1 : 2, spans: inline(para[0]!) })
      para = []
      i++
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      endPara()
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length,
        spans: inline(headingText(heading[2]!))
      })
      i++
      continue
    }
    if (RULE.test(line)) {
      endPara()
      blocks.push({ kind: 'rule' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      endPara()
      const inner: string[] = []
      while (i < lines.length && QUOTE.test(lines[i]!)) inner.push(QUOTE.exec(lines[i++]!)![1]!)
      blocks.push({ kind: 'quote', blocks: blocksOf(inner) })
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!.trim())) {
      endPara()
      const head = cells(line)
      const rows: Span[][][] = []
      i += 2
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(cells(lines[i++]!))
      }
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      endPara()
      i = readList(lines, i, blocks)
      continue
    }
    para.push(line.trim())
    i++
  }
  endPara()
  return blocks
}

/**
 * A heading's text: trimmed, and closing marks dropped when a space comes
 * before them (`## Notes ##`), as GitHub reads it; `C#` keeps its mark. Done
 * in code, in one pass, so no run of spaces can make it slow.
 */
function headingText(raw: string): string {
  const text = raw.trim()
  let end = text.length
  while (end > 0 && text[end - 1] === '#') end--
  if (end === 0) return ''
  return end < text.length && /\s/u.test(text[end - 1]!) ? text.slice(0, end).trimEnd() : text
}

/** A list from line `i`; returns the line after it. A switch between numbered and not starts a new list. */
function readList(lines: string[], start: number, blocks: MdBlock[]): number {
  const first = ITEM.exec(lines[start]!)!
  const ordered = first[3] !== undefined
  const items: ListItem[] = []
  const base = first[1]!.length
  let current: { depth: number; text: string[] } | null = null
  const close = (): void => {
    if (!current) return
    const joined = current.text.join(' ')
    const box = /^\[([ xX])\]\s+/u.exec(joined)
    items.push({
      depth: current.depth,
      check: box ? box[1] !== ' ' : null,
      spans: inline(box ? joined.slice(box[0].length) : joined)
    })
    current = null
  }
  let i = start
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      // A blank line ends the list unless an indented line or another item follows.
      const next = lines[i + 1]
      if (next === undefined || !(ITEM.test(next) || /^\s{2,}\S/u.test(next))) break
      i++
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      const depth = Math.max(0, Math.floor((item[1]!.length - base) / 2))
      if (depth === 0 && (item[3] !== undefined) !== ordered) break
      close()
      current = { depth, text: [item[4]!.trim()] }
    } else if (current && (/^\s+\S/u.test(line) || !isBlockStart(line))) {
      current.text.push(line.trim())
    } else break
    i++
  }
  close()
  blocks.push({ kind: 'list', ordered, start: ordered ? Number(first[3]) : 1, items })
  return i
}

function isBlockStart(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)
}

/** A table row's cells, the outer pipes dropped; `\|` stays a pipe inside a cell. */
function cells(row: string): Span[][] {
  const parts = row
    .trim()
    .replace(/^\|/u, '')
    .replace(/(?<!\\)\|$/u, '')
    .split(/(?<!\\)\|/u)
  return parts.map((c) => inline(c.trim().replace(/\\\|/gu, '|')))
}

const ESCAPABLE = /[\\`*_[\]()#+\-.!|<>~{}]/u

/** The spans of one run of text: code, strong, emphasis, links and plain text. */
export function inline(src: string): Span[] {
  const out: Span[] = []
  let text = ''
  const flush = (): void => {
    if (text) out.push({ kind: 'text', text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    const rest = src.slice(i)
    if (c === '\\' && ESCAPABLE.test(src[i + 1] ?? '')) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      const run = /^`+/u.exec(rest)![0]
      const end = src.indexOf(run, i + run.length)
      if (end > i) {
        flush()
        out.push({ kind: 'code', text: src.slice(i + run.length, end).trim() })
        i = end + run.length
      } else {
        text += run
        i += run.length
      }
      continue
    }
    if (c === '*' || c === '_') {
      const mark = src[i + 1] === c ? c + c : c
      const found = emphasis(src, i, mark)
      if (found) {
        flush()
        out.push({ kind: mark.length === 2 ? 'strong' : 'em', spans: inline(found.inner) })
        i = found.end
      } else {
        text += mark
        i += mark.length
      }
      continue
    }
    // `(?=(\s*))\2` takes the spaces after `(` once and never gives them back,
    // so a long run of them is not tried split every way.
    const link =
      c === '[' ? /^\[([^\]]*)\]\((?=(\s*))\2<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/u.exec(rest) : null
    if (link) {
      flush()
      out.push({ kind: 'link', href: link[3]!, spans: inline(link[1]!) })
      i += link[0].length
      continue
    }
    const auto = c === '<' ? /^<(https?:\/\/[^>\s]+)>/u.exec(rest) : null
    if (auto) {
      flush()
      out.push({ kind: 'link', href: auto[1]!, spans: [{ kind: 'text', text: auto[1]! }] })
      i += auto[0].length
      continue
    }
    const br = c === '<' ? /^<br\s*\/?>/iu.exec(rest) : null
    if (br) {
      text += ' '
      i += br[0].length
      continue
    }
    text += c
    i++
  }
  flush()
  return out
}

/** A closing mark for the emphasis opening at `i`, or null when it does not close. */
function emphasis(src: string, i: number, mark: string): { inner: string; end: number } | null {
  const open = i + mark.length
  const after = src[open]
  if (after === undefined || /\s/u.test(after)) return null
  const wordy = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/u.test(ch)
  // An underscore inside a word (snake_case) is a letter, not emphasis.
  if (mark[0] === '_' && wordy(src[i - 1])) return null
  for (let k = src.indexOf(mark, open + 1); k > -1; k = src.indexOf(mark, k + 1)) {
    if (/\s/u.test(src[k - 1]!)) continue
    if (mark[0] === '_' && wordy(src[k + mark.length])) continue
    // A single mark does not close on half of a double one.
    if (mark.length === 1 && (src[k + 1] === mark || src[k - 1] === mark)) continue
    return { inner: src.slice(open, k), end: k + mark.length }
  }
  return null
}
