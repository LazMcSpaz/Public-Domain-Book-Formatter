/**
 * The editor's queries, gathered into a sheet a person reads.
 *
 * Some things a reader meets are neither transcription errors nor findings.
 * They are **decisions**, and they belong to the editor: a compositor's error
 * the page is unambiguous about, a place where the book contradicts itself, a
 * passage where "faithful to the original" and "correct" pull apart.
 *
 * The standing rule is that such a thing is **transcribed as printed and raised
 * as a query** — never silently corrected, never silently kept. Whether a
 * reprint fixes a 1916 compositor's `belleves`, keeps it, or notes it is not a
 * question a reader gets to settle on the editor's behalf.
 *
 * ## Why this is a file rather than a queue
 *
 * A repository is a shelf rather than a blob store precisely so its owner can
 * look at it, and JSON is not looking. A query that lives only in a chat
 * session survives exactly as long as the session does, which is the one
 * property it must not have: the whole reason to raise a query is that nobody
 * should have to remember it.
 *
 * So this renders Markdown, sorted by leaf, with the exact words and the reason
 * and nothing else. **No proposed fix appears anywhere**, because a suggestion
 * sitting beside a question is an answer in all but name — the same reason
 * `EditorialQuery` has no field for one.
 *
 * Pure: no DOM, no I/O.
 */
import type { EditorialQuery, PageTranscription } from '@core/transcribe'
import { held, outstanding, type Ruling } from './rulings'

export * from './rulings'
export * from './standing'
export * from './gate'
export * from './locate'
export * from './proposals'
export * from './key'

/** A query with the leaf it was raised on. */
export interface RaisedQuery extends EditorialQuery {
  pageIndex: number
  /**
   * The number the leaf itself prints, when it printed one.
   *
   * Carried because the editor meets a query on a screen headed by the *leaf*
   * — a count of images in a scan — while every word written about the book,
   * the query's own reason included, cites the **page**. On this shelf's first
   * volume leaf 228 prints folio 170, and a query whose reason said "page 170"
   * under a heading that said "Leaf 228" read as a question about somewhere
   * else entirely. Two numbers for one place, and nothing on screen to say so.
   */
  folio?: string
}

/** Every query in a reading, oldest leaf first. */
export function collectQueries(transcriptions: readonly PageTranscription[]): RaisedQuery[] {
  return [...transcriptions]
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .flatMap((page) =>
      (page.queries ?? []).map((query) => ({
        ...query,
        pageIndex: page.pageIndex,
        ...(page.furniture?.folio?.trim() ? { folio: page.furniture.folio.trim() } : {})
      }))
    )
}

const HEADING: Record<EditorialQuery['kind'], string> = {
  'printers-error': 'Printer\u2019s errors',
  inconsistent: 'The book contradicts itself',
  unclear: 'Unclear for this edition'
}

const DECIDED: Record<Ruling['decision'], string> = {
  'as-printed': 'kept as printed',
  corrected: 'set right',
  noted: 'kept, and told to the reader'
}

/**
 * How many of each kind, for the catalogue card and the driver's report.
 *
 * A count is not a substitute for reading the sheet, and is not offered as one
 * — it is there so a session can say "eleven decisions are waiting" without
 * having to render the whole file.
 */
export function countQueries(queries: readonly RaisedQuery[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const query of queries) counts[query.kind] = (counts[query.kind] ?? 0) + 1
  return counts
}

function escapeCell(text: string): string {
  return text.replace(/\|/gu, '\\|').replace(/\n+/gu, ' ')
}

/**
 * The sheet.
 *
 * Grouped by kind rather than run straight through, because the decisions
 * within one kind are usually the same decision made repeatedly — a book that
 * prints `belleves` once often prints two more like it — and an editor who has
 * settled the first will settle the rest in a moment. Ordered by leaf inside
 * each group so it can be worked through against the scan.
 */
export function queriesMarkdown(
  book: { title: string; fileName: string },
  raised: readonly RaisedQuery[],
  rulings: readonly Ruling[] = []
): string {
  // A settled query is not a decision waiting, and leaving it on the sheet is
  // how a sheet stops being read. What was decided is written down too, in
  // `rulingsMarkdown` — this file is the work outstanding.
  const queries = outstanding(raised, rulings)
  const answered = raised.length - queries.length
  const holding = held(raised, rulings)
  const heldKeys = new Set(holding.map((h) => `${h.query.pageIndex}\u0000${h.query.quote}`))
  const lines: string[] = [
    `# Queries for the editor — ${book.title}`,
    '',
    'Each of these was **read clearly**. None of them is a transcription',
    'problem; each is a decision that is yours rather than the reader’s.',
    '',
    'The book carries every one of them **as printed**. Nothing here has been',
    'changed, and nothing here proposes a change — a suggestion beside a',
    'question is an answer in all but name.',
    ''
  ]

  if (queries.length === 0) {
    lines.push('Nothing is waiting on you.', '')
    if (answered > 0) {
      lines.push(
        '',
        `${answered} ${answered === 1 ? 'has' : 'have'} been ruled on \u2014 see ` +
          '`rulings.md`.',
        ''
      )
    }
    return lines.join('\n')
  }

  lines.push(
    `${queries.length} decision${queries.length === 1 ? '' : 's'} waiting, from ` +
      `\`${book.fileName}\`.` +
      (answered > 0
        ? ` ${answered} other${answered === 1 ? '' : 's'} already ruled on \u2014 see ` +
          '`rulings.md`.'
        : ''),
    ''
  )

  // Held first: a look and a nod each, and the editor should not have to
  // find them among the decisions. Never filed from here — the gate, or
  // `drive.mjs held approve`, is where a person says yes.
  if (holding.length > 0) {
    lines.push(
      '## Held under a standing ruling — waiting for your approval',
      '',
      'Each of these falls under a ruling you have already made on a class of',
      'cases. The decision below is what that ruling would give; it is **not',
      'filed** until you approve it, at the gate or with `drive.mjs held approve`.',
      '',
      '| Leaf | As printed | Standing ruling | Would be | Why it was raised |',
      '| --- | --- | --- | --- | --- |'
    )
    for (const { query, ruling } of holding) {
      lines.push(
        `| ${query.pageIndex} | \`${escapeCell(query.quote)}\` | ${escapeCell(ruling.quote)} | ` +
          `${DECIDED[ruling.decision]} | ${escapeCell(query.why)} |`
      )
    }
    lines.push('')
  }

  for (const kind of Object.keys(HEADING) as EditorialQuery['kind'][]) {
    const group = queries.filter(
      (q) => q.kind === kind && !heldKeys.has(`${q.pageIndex}\u0000${q.quote}`)
    )
    if (group.length === 0) continue
    lines.push(`## ${HEADING[kind]}`, '')
    lines.push('| Leaf | As printed | Why it needs you |', '| --- | --- | --- |')
    for (const query of group) {
      lines.push(
        `| ${query.pageIndex} | \`${escapeCell(query.quote)}\` | ${escapeCell(query.why)} |`
      )
    }
    lines.push('')
  }

  lines.push(
    '---',
    '',
    'To look at any of these against the paper:',
    '',
    '```bash',
    'node scripts/drive.mjs leaf <leaf>            # the whole leaf',
    'node scripts/drive.mjs sheet doubts <leaf>:<word>   # the word, cut from it',
    '```',
    ''
  )
  return lines.join('\n')
}
