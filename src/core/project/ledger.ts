/**
 * The ledger's derivable half, and the reason it has one.
 *
 * CLAUDE.md, `PROCESS-reading.md` and `HANDOFF.md` §7 each say **keep the
 * ledger**: findings raised, confirmed and refuted per book, because a check
 * nobody can score is worse than no check — it manufactures confidence. Three
 * books of eleven had one.
 *
 * A rule written down three times and kept three times in eleven is not a
 * comprehension problem, and this repository already has the diagnosis in its
 * own words: *"Two things that are supposed to be standing rules turned out to
 * be habits, and habits skip."* What was missing was structural, and the piece
 * this module supplies is the one `corrections.md` already had and the ledger
 * did not — **something that rebuilds it.** The entries of `corrections.md`
 * were once written by a script in a session's scratchpad, so the first
 * session to end took the only thing that could rewrite them; `correctionRows`
 * is that script as a pure module. This is the same move for the ledger.
 *
 * ## What is derivable and what is not
 *
 * The **counts** are: leaves, edits by kind, queries and rulings, block kinds,
 * footnotes, pictures, banked facts, marked passages. Every one of them is in
 * the book file, and every one of them goes stale the moment a book is worked
 * on again — which is exactly the drift `book-files.mjs` exists to catch.
 *
 * The **narrative** is not, and must not be faked. What the scan actually is,
 * why a ruling went the way it did, what the book cost the process: those are
 * written by whoever read it. Patterns Vol. I's ledger has an empty reading
 * section that says so, because that book was read across sessions that left
 * no record — and an invented reconstruction would have been worse than the
 * gap, since the gap is the finding.
 *
 * So this writes **one section**, under a fixed heading, and leaves every
 * other word alone. The same bargain `keepHead` strikes in `book-files.mjs`,
 * turned round: there the editor's sentences are at the top and the body is
 * rebuilt; here the editor's sentences are the file and one section is
 * rebuilt.
 *
 * Pure: no DOM, no I/O, no network.
 */
import { standingFor } from '@core/queries/standing'
import type { Ruling } from '@core/queries/rulings'
import {
  parseShape,
  describeShape,
  routeKey,
  type BookShape,
  type RouteKey
} from '@core/provenance'

/** The heading the generated section lives under. Fixed, so it can be found. */
export const LEDGER_HEADING = '## By the numbers'

export interface LedgerNumbers {
  /** Leaves the reading covers. */
  leaves: number
  /** Whether the run calls itself finished. */
  complete: boolean
  /** Edits by kind, in descending count. */
  edits: { kind: string; count: number }[]
  /** Every edit, so a total can be stated without re-summing. */
  editTotal: number
  /** Queries attached to leaves, by kind. */
  queries: { kind: string; count: number }[]
  queryTotal: number
  /** Rulings filed against them. */
  rulings: number
  /** Queries with no ruling on the spot, and how many of those a standing ruling holds. */
  queriesWaiting: number
  queriesHeld: number
  /** Pristine block kinds — what the reading found the book to be made of. */
  blocks: { kind: string; count: number }[]
  /**
   * Footnotes the **original** printed, counted in the pristine reading.
   *
   * Kept apart from `editorNotes` because the two answer different questions
   * and conflating them hid a real one: _Clairvoyance_ reports 0 here and 23
   * notes the editor wrote, and a single "notes" count would have said 23 and
   * let a reader think the 1916 book carried them.
   */
  footnotes: number
  /** Notes the **editor** added — the apparatus this edition brings. */
  editorNotes: number
  /** Reference marks declared to claim no note. */
  bareMarks: number
  /** Pictures carried with the book. */
  pictures: number
  /** Entries in the fact bank. */
  facts: number
  /** Passages the editor marked while reading. */
  marked: number
  /** Written matter — an introduction, a glossary, an afterword. */
  sections: string[]
  /**
   * Whether the editor wrote front matter for this book.
   *
   * Decided on `sectionId`/`placement` and **not** on the title, because every
   * book on this shelf calls its introduction "Before You Begin". A check that
   * matched the word would have reported all five as lacking one.
   */
  front: boolean
  /** The scan, and its size where the book file records one. */
  scan: { path: string | null; bytes: number | null }
  /** What the file is made of, where the run records it, and the route that puts it on. */
  shape: BookShape | null
  route: RouteKey | null
}

function tally(values: readonly string[]): { kind: string; count: number }[] {
  const seen = new Map<string, number>()
  for (const v of values) seen.set(v, (seen.get(v) ?? 0) + 1)
  return [...seen]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/**
 * Read the counts off a book file.
 *
 * Takes the parsed file rather than a path, so it stays pure and so the same
 * function serves the shelf script and anything else that wants the numbers.
 * Every field is defaulted: a book file from an older schema, or one written
 * before a field existed, reports zero rather than throwing — this is a
 * *report*, and a report that cannot be produced for a half-finished book is a
 * report nobody runs until it is too late to be useful.
 */
export function ledgerNumbers(book: unknown): LedgerNumbers {
  const file = isRecord(book) ? book : {}
  const run = isRecord(file['run']) ? file['run'] : {}
  const transcriptions = list(run['transcriptions']).filter(isRecord)
  const edits = list(run['edits']).filter(isRecord)

  const queryKinds: string[] = []
  const blockKinds: string[] = []
  let footnotes = 0
  // Matched, not subtracted: a ruling names its query by leaf and quote, and
  // `rulings.length` also counts standing rulings that answer a class. A
  // query with no ruling on the spot is waiting; one a standing ruling's
  // covers reach is held for approval, and counted apart.
  const rulings = list(run['rulings']).filter(isRecord)
  const onTheSpot = new Set(
    rulings
      .filter((r) => typeof r['pageIndex'] === 'number' && typeof r['quote'] === 'string')
      .map((r) => `${r['pageIndex']}\u0000${String(r['quote']).trim().toLowerCase()}`)
  )
  const standing = rulings.filter(
    (r): r is Record<string, unknown> & { quote: string; kind: string } =>
      r['pageIndex'] === null && typeof r['quote'] === 'string' && typeof r['kind'] === 'string'
  )
  let queriesWaiting = 0
  let queriesHeld = 0
  for (const leaf of transcriptions) {
    const pageIndex = typeof leaf['pageIndex'] === 'number' ? leaf['pageIndex'] : -1
    for (const q of list(leaf['queries']).filter(isRecord)) {
      const kind = typeof q['kind'] === 'string' ? q['kind'] : 'unclear'
      queryKinds.push(kind)
      const quote = typeof q['quote'] === 'string' ? q['quote'] : ''
      if (onTheSpot.has(`${pageIndex}\u0000${quote.trim().toLowerCase()}`)) continue
      queriesWaiting += 1
      const raised = { pageIndex, quote, kind: kind as 'unclear', why: '' }
      if (standingFor(raised, standing as unknown as Ruling[]) !== null) queriesHeld += 1
    }
    for (const b of list(leaf['blocks']).filter(isRecord)) {
      const kind = typeof b['kind'] === 'string' ? b['kind'] : 'paragraph'
      blockKinds.push(kind)
      if (kind === 'footnote') footnotes += 1
    }
  }

  const editKinds = edits.map((e) => (typeof e['kind'] === 'string' ? e['kind'] : 'unknown'))
  const scan = isRecord(file['scan']) ? file['scan'] : {}
  const shape = parseShape(run['shape'])

  return {
    leaves: typeof run['pageCount'] === 'number' ? run['pageCount'] : transcriptions.length,
    complete: run['complete'] === true,
    edits: tally(editKinds),
    editTotal: editKinds.length,
    queries: tally(queryKinds),
    queryTotal: queryKinds.length,
    rulings: rulings.length,
    queriesWaiting,
    queriesHeld,
    blocks: tally(blockKinds),
    footnotes,
    editorNotes: editKinds.filter((k) => k === 'note').length,
    bareMarks: editKinds.filter((k) => k === 'bare-mark').length,
    pictures: list(file['images']).length,
    facts: list(run['facts']).length,
    marked: editKinds.filter((k) => k === 'highlight').length,
    sections: edits
      .filter((e) => e['kind'] === 'section')
      .map((e) => (typeof e['title'] === 'string' ? e['title'] : 'untitled')),
    front: edits.some(
      (e) => e['kind'] === 'section' && (e['sectionId'] === 'intro' || e['placement'] === 'front')
    ),
    scan: {
      path: typeof scan['path'] === 'string' ? scan['path'] : null,
      bytes: typeof scan['bytes'] === 'number' ? scan['bytes'] : null
    },
    shape,
    route: shape ? routeKey(shape) : null
  }
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/**
 * The generated section, as markdown.
 *
 * Deliberately **counts and nothing else**. There is no sentence here that
 * interprets a number, because an interpretation is the part a person writes
 * and a generator that produced one would be putting words in the editor's
 * mouth on every run.
 */
export function ledgerSection(n: LedgerNumbers): string {
  const row = (label: string, value: string): string => `| ${label} | ${value} |`
  const lines = [
    LEDGER_HEADING,
    '',
    '_Derived from `book.json` — everything above this heading is written by',
    'hand, and this section is rebuilt by `book-files.mjs`._',
    '',
    '| | |',
    '| --- | --- |',
    row('Leaves', String(n.leaves)),
    row('Reading', n.complete ? 'complete' : '**not complete**'),
    row('Edits', `${n.editTotal} — ${n.edits.map((e) => `${e.count} ${e.kind}`).join(', ')}`),
    row(
      'Queries',
      n.queryTotal === 0
        ? 'none raised'
        : `${n.queryTotal} raised (${n.queries.map((q) => `${q.count} ${q.kind}`).join(', ')}), ` +
            `${plural(n.rulings, 'ruling')} filed` +
            (n.queriesWaiting === 0
              ? ', none waiting'
              : `, **${n.queriesWaiting} waiting**` +
                (n.queriesHeld > 0
                  ? ` (${n.queriesHeld} held under a standing ruling for approval)`
                  : ''))
    ),
    row('Blocks, as read', n.blocks.map((b) => `${b.count} ${b.kind}`).join(', ') || '—'),
    row('Footnotes the original printed', String(n.footnotes)),
    row('Notes the editor added', String(n.editorNotes)),
    row('Bare marks', String(n.bareMarks)),
    row('Pictures', String(n.pictures)),
    row('Written matter', n.sections.length === 0 ? 'none' : n.sections.join(', ')),
    row('Marked passages', String(n.marked)),
    row('Fact bank', String(n.facts)),
    row(
      'Scan',
      n.scan.path === null
        ? '**not recorded**'
        : `\`${n.scan.path}\`${n.scan.bytes === null ? '' : ` (${Math.round(n.scan.bytes / 1024)} KB)`}`
    ),
    // The shape and its route, with the evidence beside them: a measurement's
    // numbers or a declaration's reason, so a reader can see which it was.
    row(
      'Shape',
      n.shape === null
        ? '**not recorded** — `node scripts/shape.mjs <book-dir> --write`'
        : `${describeShape(n.shape)}; route \`${n.route}\`. ${n.shape.evidence.join('; ')}`
    ),
    ''
  ]
  return lines.join('\n')
}

/**
 * Put the generated section into a ledger, keeping every other word.
 *
 * Replaces from `LEDGER_HEADING` to the next `## ` heading, or to the end
 * where it is last. Appends where the file has no such heading yet, so a
 * hand-written ledger gains the section on its first run without anybody
 * editing it.
 *
 * **The search is anchored to the start of a line.** Without that, a ledger
 * that quotes its own heading mid-paragraph — which the one explaining this
 * machinery necessarily does — has its prose eaten from the quotation onwards.
 */
export function withLedgerSection(existing: string | null, section: string): string {
  const body = existing ?? ''
  const lines = body.split('\n')
  const at = lines.findIndex((l) => l.trimEnd() === LEDGER_HEADING)
  if (at === -1) {
    const trimmed = body.trimEnd()
    return trimmed.length === 0 ? section : `${trimmed}\n\n${section}`
  }
  let end = at + 1
  while (end < lines.length && !/^## /u.test(lines[end]!)) end += 1
  const before = lines.slice(0, at).join('\n').trimEnd()
  const after = lines.slice(end).join('\n').trim()
  const head = before.length === 0 ? '' : `${before}\n\n`
  return after.length === 0 ? `${head}${section}` : `${head}${section}\n${after}\n`
}
