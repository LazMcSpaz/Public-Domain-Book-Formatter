/**
 * The readiness list: every check a book must pass to be called _checked_ or
 * _ready to upload_, and the rule that turns their results into one verdict.
 *
 * The list is `docs/process/checking.md`'s "Checks that must pass", C1 to C12
 * and R1 to R11, one entry each. `scripts/readiness.mjs` runs what it can and
 * hands the results here; this module never runs anything.
 *
 * The rule is the owner's: a stage is reached only when every check of that
 * stage, and of every earlier stage, PASSED or was signed off by a person. A
 * check that could not run is NOT CHECKED with its reason, and it blocks the
 * stage exactly as a failure does. A check with no result at all is reported
 * NOT CHECKED rather than left out, so no check can go missing in silence.
 *
 * Pure: no files, no processes. The sign-off lines are in `readiness-signoff.ts`
 * and the Markdown in `readiness-report.ts`.
 */

export type ReadinessStage = 'checked' | 'ready'
export type ReadinessOutcome = 'PASSED' | 'FAILED' | 'NEEDS A PERSON' | 'NOT CHECKED'
export type ReadinessVerdict = 'checked' | 'ready to upload' | 'not ready'

/**
 * What a check is run on, and so what a person's sign-off must name: the book
 * file, the interior PDF, both cover PDFs, or the EPUB, by fingerprint.
 */
export type ReadinessSubject = 'book' | 'interior' | 'covers' | 'epub'

/**
 * How a check is run today: a command that needs no browser, a driver verb
 * (`drive.mjs serve` must be up with the book open), a check built into the
 * readiness command, or a person.
 */
export type ReadinessRunner = 'command' | 'driver' | 'built-in' | 'person'

export interface ReadinessCheck {
  readonly id: string
  readonly stage: ReadinessStage
  readonly title: string
  /** The command or the instructions, as `checking.md` gives them. */
  readonly how: string
  readonly runner: ReadinessRunner
  readonly subject: ReadinessSubject
}

const c = (
  id: string,
  title: string,
  runner: ReadinessRunner,
  how: string,
  subject: ReadinessSubject = 'book'
): ReadinessCheck => ({ id, stage: 'checked', title, how, runner, subject })
const r = (
  id: string,
  title: string,
  runner: ReadinessRunner,
  how: string,
  subject: ReadinessSubject = 'interior'
): ReadinessCheck => ({ id, stage: 'ready', title, how, runner, subject })

const VN = 'npx vite-node --config vitest.config.ts'

/** The whole list, in the order `checking.md` gives it. */
export const READINESS_CHECKS: readonly ReadinessCheck[] = [
  c('C1', 'Conversion damage', 'driver', 'node scripts/drive.mjs damage --check'),
  c(
    'C2',
    'Damage, apparatus, consistency, rulings not yet in the text',
    'command',
    `${VN} scripts/checks-of.ts <book.json> --check`
  ),
  c(
    'C3',
    'Paragraphs broken at a page turn',
    'command',
    `${VN} scripts/page-turns-of.ts <book.json> --check`
  ),
  c(
    'C4',
    'Lines lost or moved, against a second reading',
    'command',
    `${VN} scripts/coverage-of.ts <book.json> [--second <second.json>]; with no pixels, ` +
      '`drive.mjs witness <second.json>` and `drive.mjs parallels`'
  ),
  c(
    'C5',
    'Footnotes under their own marks',
    'driver',
    'node scripts/drive.mjs pairs; node scripts/drive.mjs notes n.json --full'
  ),
  c(
    'C6',
    'Italic kept',
    'driver',
    `italics-absent inside C1; ${VN} scripts/emphasis-of.ts where a witness exists`
  ),
  c(
    'C7',
    'Glossary marks, rulings applied, ledger, shape, every query ruled',
    'driver',
    'node scripts/drive.mjs finish <book-dir>'
  ),
  c(
    'C8',
    'Readable files in step',
    'command',
    `node scripts/book-files.mjs <book-dir> --check --body <body.json> (the body from ${VN} scripts/body-of.ts)`
  ),
  c(
    'C9',
    'Same apparatus as the last comparable book',
    'person',
    'node scripts/book-files.mjs --shelf <shelf>/books/, the row read'
  ),
  c(
    'C10',
    "Editor's prose audited",
    'command',
    'node scripts/voice.mjs audit <book.json> --name "Etsu T. Dhent" --shelf <shelf>'
  ),
  c(
    'C11',
    'No working notes in the text',
    'built-in',
    'every "(word)" in section and note text and in the book folder\'s .md sheets'
  ),
  c(
    'C12',
    'Italic and bold survived every sweep',
    'built-in',
    `<i>, <b> and <sc> counted per block, first reading against corrected (${VN} scripts/body-of.ts)`
  ),
  r(
    'R1',
    'Spelling, on the exported interior',
    'command',
    `${VN} scripts/spelling-of.ts <book.json> --shelf <shelf>/books/ --text <interior.pdf>; the sheet read`
  ),
  r(
    'R2',
    'Export report clean',
    'driver',
    'the `drive.mjs proof "answers=<book.json>" "pdf=<interior.pdf>"` report: warnings 0, nothing dropped, design from the book file; any running head shortened to fit read by a person'
  ),
  r(
    'R3',
    'No character printed as an empty box',
    'driver',
    '`unprintable` in the same report is empty, or each one ruled by the editor'
  ),
  r(
    'R4',
    'Printed notes match the pairing',
    'person',
    'the note sequence read out of the PDF (`pdftotext`) against `drive.mjs pairs`, by hand'
  ),
  r(
    'R5',
    'PDF made from this book file, with no markup in it',
    'built-in',
    'no <i>, <b> or <sc> in `pdftotext` output; the book file not changed since the PDF was made'
  ),
  r(
    'R6',
    'Text copies out of the PDF',
    'person',
    '`pdftotext -layout <interior.pdf> - | less` reads as words, by hand'
  ),
  r(
    'R7',
    'Covers made for this interior',
    'built-in',
    'the interior\'s page count equals `pageCount` in covers/softcover.json and covers/hardcover.json; the "-flat" PDFs made after the last recut',
    'covers'
  ),
  r(
    'R8',
    'Pages looked at',
    'person',
    '`drive.mjs proof <n> … "answers=<book.json>"`: title page, contents, a chapter opening, a page with a note, a picture page, a blank verso'
  ),
  r(
    'R9',
    'No line opens on a closing mark or ends on an opening one',
    'person',
    'counted in the `pdftotext` output after any change to line breaking, by hand'
  ),
  r(
    'R10',
    'Listing matches the cover',
    'person',
    'title with its label, subtitle and author: the KDP listing against the cover',
    'covers'
  ),
  r(
    'R11',
    'Every EPUB picture described',
    'built-in',
    'every picture in the EPUB itself has a description (alt text) that is not empty',
    'epub'
  )
]

export function readinessCheck(id: string): ReadinessCheck | undefined {
  return READINESS_CHECKS.find((k) => k.id === id)
}

/** A sign-off line from the book's ledger, as `readiness-signoff.ts` reads it. */
export interface SignOff {
  id: string
  fingerprints: string[]
  date: string
  note: string
  line: number
}

export interface CheckResult {
  id: string
  outcome: ReadinessOutcome
  /** One line for the results table. */
  summary: string
  /** Further lines for the details: findings, commands run, what to read. */
  details?: string[]
  /** For NEEDS A PERSON: the fingerprints a sign-off must name, every one. */
  subjects?: string[]
  /** Set by `applySignOffs` when the ledger signs this result off. */
  signedOff?: SignOff
}

const WORST: readonly ReadinessOutcome[] = ['FAILED', 'NOT CHECKED', 'NEEDS A PERSON', 'PASSED']

/**
 * Several partial results for one check as one: the worst outcome wins
 * (FAILED, then NOT CHECKED, then NEEDS A PERSON), and every part's words are
 * kept, so the half that did run is not hidden by the half that did not.
 */
export function combineResults(id: string, parts: readonly CheckResult[]): CheckResult {
  if (parts.length === 0) return notChecked(id, 'no result was recorded for this check')
  if (parts.length === 1) return { ...parts[0]!, id }
  const outcome = WORST.find((o) => parts.some((p) => p.outcome === o)) ?? 'NOT CHECKED'
  const subjects = [...new Set(parts.flatMap((p) => p.subjects ?? []))]
  return {
    id,
    outcome,
    summary: parts.map((p) => p.summary).join('; '),
    details: parts.flatMap((p) => p.details ?? []),
    ...(subjects.length > 0 ? { subjects } : {})
  }
}

export function notChecked(id: string, reason: string, details?: string[]): CheckResult {
  return { id, outcome: 'NOT CHECKED', summary: reason, ...(details ? { details } : {}) }
}

/**
 * One result per listed check, in the list's order. A check with no result
 * becomes NOT CHECKED; two results for one check are combined. A result for
 * an id the list does not have is refused: it would otherwise be dropped.
 */
export function everyCheck(results: readonly CheckResult[]): CheckResult[] {
  for (const res of results) {
    if (!readinessCheck(res.id)) throw new Error(`"${res.id}" is not a check in the readiness list`)
  }
  return READINESS_CHECKS.map((k) =>
    combineResults(
      k.id,
      results.filter((res) => res.id === k.id)
    )
  )
}

/** Whether a result lets its stage through: PASSED, or a person's check signed off. */
export function isSettled(res: CheckResult): boolean {
  return res.outcome === 'PASSED' || (res.outcome === 'NEEDS A PERSON' && res.signedOff != null)
}

export interface ReadinessDecision {
  verdict: ReadinessVerdict
  asked: ReadinessStage
  /** Whether the stage that was asked for is reached: the command's exit code. */
  reachedAsked: boolean
  reached: Record<ReadinessStage, boolean>
  /** The results that keep the asked-for stage from being reached. */
  blocking: CheckResult[]
  results: CheckResult[]
}

/** The verdict, by the rule at the head of this file. */
export function decideReadiness(
  results: readonly CheckResult[],
  asked: ReadinessStage
): ReadinessDecision {
  const all = everyCheck(results)
  const stageOf = (res: CheckResult): ReadinessStage => readinessCheck(res.id)!.stage
  const open = all.filter((res) => !isSettled(res))
  const checked = !open.some((res) => stageOf(res) === 'checked')
  const ready = checked && open.length === 0
  const verdict: ReadinessVerdict = ready ? 'ready to upload' : checked ? 'checked' : 'not ready'
  const blocking = asked === 'checked' ? open.filter((res) => stageOf(res) === 'checked') : open
  return {
    verdict,
    asked,
    reachedAsked: asked === 'ready' ? ready : checked,
    reached: { checked, ready },
    blocking,
    results: all
  }
}
