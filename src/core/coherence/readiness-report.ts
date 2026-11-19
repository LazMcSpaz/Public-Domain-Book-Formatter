/**
 * The readiness report, as the Markdown `readiness.md` beside the book.
 *
 * One row per check in the list, always all of them: `decideReadiness` has
 * already turned a missing result into NOT CHECKED, and this writes every
 * result it is handed. The verdict comes first and again at the foot, with
 * what is keeping the book from the stage that was asked for.
 */
import {
  readinessCheck,
  type CheckResult,
  type ReadinessDecision,
  type ReadinessStage
} from './readiness'
import { SIGN_OFF_FORM, signOffLine } from './readiness-signoff'

export interface ReadinessFile {
  /** interior, softcover, hardcover or epub. */
  role: string
  /** As the session named it: a local path, a storage key, or a shelf path. */
  source: string
  /** The path it had on the shelf, when `STORAGE.tsv` or its place says. */
  shelfPath?: string | null
  sha256: string
  bytes: number
  pages?: number | null
}

export interface ReadinessMeta {
  /** The book's folder name on the shelf. */
  book: string
  /** When the report was written, ISO 8601. */
  writtenAt: string
  /** Today, YYYY-MM-DD, for the sign-off lines. */
  today: string
  /** The command line that wrote it. */
  command: string
  bookFingerprint: string
  toolsCommit?: string | null
  shelfCommit?: string | null
  files: readonly ReadinessFile[]
  /** One line saying whether the driver was up and which book it had open. */
  driver: string
  /** What was said about the ledger's sign-off lines. */
  signOffNotes: readonly string[]
}

const STAGE_NAME: Record<ReadinessStage, string> = {
  checked: 'checked',
  ready: 'ready to upload'
}

const cell = (s: string): string => s.replace(/\|/gu, '\\|').replace(/\s*\n\s*/gu, ' ')

function outcomeOf(res: CheckResult): string {
  if (res.signedOff) return `NEEDS A PERSON, signed off ${res.signedOff.date}`
  return res.outcome
}

function verdictLine(d: ReadinessDecision): string {
  const asked = STAGE_NAME[d.asked]
  const head = `**Verdict: ${d.verdict}.** Asked for: _${asked}_`
  if (d.reachedAsked) return `${head}, and every check for it passed or was signed off.`
  return (
    `${head}; not reached: ${d.blocking.length} check${d.blocking.length === 1 ? '' : 's'} ` +
    `(${d.blocking.map((b) => b.id).join(', ')}) did not pass and ${d.blocking.length === 1 ? 'is' : 'are'} not signed off.`
  )
}

function counts(results: readonly CheckResult[]): string {
  const n = (f: (r: CheckResult) => boolean): number => results.filter(f).length
  const person = n((r) => r.outcome === 'NEEDS A PERSON')
  const signed = n((r) => r.signedOff != null)
  return (
    `${results.length} checks: ${n((r) => r.outcome === 'PASSED')} passed, ` +
    `${n((r) => r.outcome === 'FAILED')} failed, ${person} need a person (${signed} signed off), ` +
    `${n((r) => r.outcome === 'NOT CHECKED')} not checked.`
  )
}

function detailsOf(res: CheckResult, today: string): string[] {
  const k = readinessCheck(res.id)!
  const out = [`### ${k.id} ${k.title}: ${outcomeOf(res)}`, '', `How: ${k.how}`, '', res.summary]
  if (res.details && res.details.length > 0) out.push('', ...res.details.map((l) => `    ${l}`))
  if (res.signedOff) {
    out.push(
      '',
      `Signed off on ledger.md line ${res.signedOff.line}, ${res.signedOff.date}: ${res.signedOff.note}`
    )
  } else {
    const line = signOffLine(res, today)
    if (line) {
      out.push(
        '',
        'When the person has done it, they add this line to `ledger.md`, with who and what in place of the part in angle brackets:',
        '',
        `    ${line}`
      )
    }
  }
  out.push('')
  return out
}

/** The whole report. */
export function readinessReport(d: ReadinessDecision, meta: ReadinessMeta): string {
  const files =
    meta.files.length === 0
      ? ['No upload file was named, so nothing for _ready to upload_ was run on one.']
      : [
          '| file | named as | was on the shelf at | SHA-256 | bytes | pages |',
          '| --- | --- | --- | --- | ---: | ---: |',
          ...meta.files.map(
            (f) =>
              `| ${f.role} | \`${cell(f.source)}\` | ${f.shelfPath ? `\`${cell(f.shelfPath)}\`` : ''} | ` +
              `\`${f.sha256}\` | ${f.bytes} | ${f.pages ?? ''} |`
          )
        ]
  const rows = d.results.map((res) => {
    const k = readinessCheck(res.id)!
    return `| ${k.id} | ${cell(k.title)} | ${STAGE_NAME[k.stage]} | ${outcomeOf(res)} | ${cell(res.summary)} |`
  })
  const blocking =
    d.blocking.length === 0
      ? []
      : [
          '## What keeps it from the stage asked for',
          '',
          ...d.blocking.map((b) => `- **${b.id}** ${outcomeOf(b)}: ${b.summary}`),
          ''
        ]
  return [
    `# Readiness: ${meta.book}`,
    '',
    verdictLine(d),
    '',
    `Written ${meta.writtenAt} by \`${meta.command}\`.`,
    `Tools at ${meta.toolsCommit ?? 'an unknown commit'}; shelf at ${meta.shelfCommit ?? 'an unknown commit'}.`,
    `Book file \`book.json\`, SHA-256 \`${meta.bookFingerprint}\`.`,
    `Driver: ${meta.driver}`,
    '',
    'Every check in the list is below; none is left out. PASSED ran and found nothing; FAILED ran and',
    'found something; NEEDS A PERSON wants a person to read or look, and counts only once signed off in',
    '`ledger.md`; NOT CHECKED did not run, with the reason, and blocks the stage like a failure.',
    '',
    '## The files checked',
    '',
    ...files,
    '',
    '## Results',
    '',
    counts(d.results),
    '',
    '| check | what | stage | result | found |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...blocking,
    '## Sign-offs',
    '',
    `A sign-off is one line in \`ledger.md\`, above "By the numbers": \`${SIGN_OFF_FORM}\`. It counts only for the exact file it names.`,
    '',
    ...(meta.signOffNotes.length > 0
      ? meta.signOffNotes.map((n) => `- ${n}`)
      : ['No sign-off line in the ledger was set aside.']),
    '',
    '## Details',
    '',
    ...d.results.flatMap((res) => detailsOf(res, meta.today)),
    '---',
    '',
    verdictLine(d),
    ''
  ].join('\n')
}
