/**
 * C1 to C12, the checks for "checked", as `readiness.mjs` runs them: each
 * existing command run and its exit code and output read, and C11 and C12
 * done here over the book file and its assembled body. The list and its
 * wording are `docs/process/checking.md`; the verdict is `@core/coherence`.
 *
 * Each function returns one result, or several for a check with parts. A
 * command that stopped before its report is NOT CHECKED, never FAILED: its
 * exit code says nothing about the book.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJsonSync } from './json-file.mjs'
import { tail } from './readiness-run.mjs'

export const passed = (id, summary, details) => ({ id, outcome: 'PASSED', summary, details })
export const failed = (id, summary, details) => ({ id, outcome: 'FAILED', summary, details })
export const person = (id, summary, details, subjects) => ({
  id,
  outcome: 'NEEDS A PERSON',
  summary,
  details,
  subjects
})
export const notRun = (id, summary, details) => ({ id, outcome: 'NOT CHECKED', summary, details })

/** The result of a command whose exit code is the check: 0 passes, 1 with its report fails. */
export function byExit(id, res, ran, { ok, bad }) {
  const details = [`$ ${res.line}`, ...tail(res)]
  if (res.code === 0) return passed(id, ok, details)
  if (res.code === 1 && ran.test(`${res.out}\n${res.err}`)) return failed(id, bad, details)
  return notRun(id, `the command stopped before its report (exit ${res.code})`, details)
}

const needsDriver = (ctx, id) => notRun(id, `needs the driver, which is ${ctx.driver.why}`)

function c1(ctx) {
  if (!ctx.driver.ok) return needsDriver(ctx, 'C1')
  const res = ctx.run.drive('damage', ['--check'])
  const found = tail(res, 3).join(' ')
  return byExit('C1', res, /conversion faults still in the book/u, {
    ok: `no conversion damage${res.json?.toRead ? `; ${res.json.toRead}` : ''}`,
    bad: found
  })
}

function c2(ctx) {
  const res = ctx.run.viteNode('scripts/checks-of.ts', [ctx.bookJson, '--check'])
  const counts = res.out
    .split('\n')
    .filter((l) => /^\s{2}(damage|apparatus|consistency|rulings)\b/u.test(l))
    .map((l) => l.trim().replace(/\s+/gu, ' '))
  return byExit('C2', res, /have findings left after their rulings/u, {
    ok: counts.join('; ') || 'nothing left after the rulings',
    bad: `findings left after the rulings: ${counts.join('; ')}`
  })
}

/**
 * C3 in two halves: the text half (a paragraph that stops at a leaf's foot and
 * runs on at the next head) and the paper half (the next leaf's first line,
 * read off the book's own recon reading). The command exits 0 on the text half
 * alone when it has no reading of this copy to read the paper from, so that
 * half is reported NOT CHECKED with its reason, never folded into a pass.
 */
export function c3(ctx) {
  const res = ctx.run.viteNode('scripts/page-turns-of.ts', [ctx.bookJson, '--check'])
  const head = /(\d+) split; (\d+) owed(.*)/u.exec(res.out)
  if (!head) {
    return [
      notRun('C3', `the command stopped before its report (exit ${res.code})`, [
        `$ ${res.line}`,
        ...tail(res)
      ])
    ]
  }
  const paper = /paper read from \d+ leaves/u.exec(head[3])
  const said = `${head[1]} split, ${head[2]} owed${paper ? `; ${paper[0]}` : ' (text half)'}`
  const text = byExit('C3', res, /\d+ split; \d+ owed/u, {
    ok: said,
    bad: `${said}; crop each finding before joining`
  })
  if (text.outcome === 'NOT CHECKED' || paper) return [text]
  const why = /text only: (.*)/u.exec(head[3])?.[1] ?? 'the command did not say it read the paper'
  return [
    text,
    notRun(
      'C3',
      `the paper half did not run (${why}); only the book's own recon reading can say where a leaf's first line starts`
    )
  ]
}

const COVERAGE = /(\d+) leaves compared: (\d+) runs missing, (\d+) lines moved/u
const REFUSED = /carry a reading|names no PDF scan|ENOENT|no such file/iu

function c4(ctx) {
  if (!ctx.shape) {
    return notRun(
      'C4',
      "the book's shape is not recorded (`node scripts/shape.mjs <book-dir> --write`), so which second reading applies is unknown"
    )
  }
  const second = join(ctx.bookDir, 'second.json')
  if (ctx.shape.pixels) {
    let res = ctx.run.viteNode('scripts/coverage-of.ts', [ctx.bookJson])
    const tried = [res]
    if (!COVERAGE.test(res.out) && REFUSED.test(`${res.out}\n${res.err}`) && existsSync(second)) {
      res = ctx.run.viteNode('scripts/coverage-of.ts', [ctx.bookJson, '--second', second])
      tried.push(res)
    }
    const m = COVERAGE.exec(res.out)
    const details = tried.flatMap((t) => [`$ ${t.line}`, ...tail(t, 25)])
    if (!m)
      return notRun('C4', `the coverage check did not compare: ${tail(res, 2).join(' ')}`, details)
    const found = Number(m[2]) + Number(m[3])
    const said = `${m[1]} leaves compared: ${m[2]} runs missing, ${m[3]} lines moved`
    return found === 0
      ? passed('C4', said, details)
      : person('C4', `${said}; read each against the page`, details, [ctx.bookSha])
  }
  if (!ctx.driver.ok) return needsDriver(ctx, 'C4')
  if (!existsSync(second)) {
    return notRun('C4', 'no second reading beside the book (`drive.mjs second` writes second.json)')
  }
  const w = ctx.run.drive('witness', [second, join(ctx.scratch, 'witness.json')])
  const p = ctx.run.drive('parallels', [join(ctx.sheets, 'readiness-parallels.md')])
  if (w.code !== 0 || p.code !== 0) {
    return notRun('C4', 'witness or parallels stopped with an error', [...tail(w), ...tail(p)])
  }
  return person(
    'C4',
    'the second reading and the parallels to read: the disagreements, and readiness-parallels.md',
    [`$ ${w.line}`, ...tail(w), `$ ${p.line}`, ...tail(p)],
    [ctx.bookSha]
  )
}

/**
 * Why a driver verb's answer cannot be read as counts, or null when it can:
 * it exited 0, answered JSON with no `error`, and gave every count asked for.
 * A missing count is not a zero: read as one, an error passed as "no footnotes".
 */
export function uncounted(res, fields) {
  if (res.code !== 0) return `exit ${res.code}${res.json?.error ? `: ${res.json.error}` : ''}`
  if (!res.json || typeof res.json !== 'object') return 'it answered no result'
  if (res.json.error) return String(res.json.error)
  const missing = fields.filter((f) => !Number.isInteger(res.json[f]) || res.json[f] < 0)
  return missing.length > 0 ? `it gave no count of ${missing.join(', ')}` : null
}

export function c5(ctx) {
  if (!ctx.driver.ok) return needsDriver(ctx, 'C5')
  const pairsOut = join(ctx.sheets, 'readiness-pairs.json')
  const pairs = ctx.run.drive('pairs', [pairsOut])
  const notes = ctx.run.drive('notes', [join(ctx.scratch, 'notes.json'), '--full'])
  const details = [`$ ${pairs.line}`, ...tail(pairs, 4), `$ ${notes.line}`, ...tail(notes, 4)]
  const wrong = [
    ['pairs', uncounted(pairs, ['references', 'notes', 'orphaned'])],
    ['notes', uncounted(notes, ['notes', 'orphaned'])]
  ].filter(([, why]) => why)
  if (wrong.length > 0) {
    return notRun(
      'C5',
      `the driver did not count the notes: ${wrong.map(([verb, why]) => `${verb}: ${why}`).join('; ')}`,
      details
    )
  }
  const orphans = pairs.json.orphaned + notes.json.orphaned
  if (orphans > 0)
    return failed('C5', `${orphans} notes orphaned (pairs and notes together)`, details)
  if (pairs.json.notes === 0 && pairs.json.references === 0 && notes.json.notes === 0) {
    return passed('C5', 'the book has no footnotes', details)
  }
  return person(
    'C5',
    `${pairs.json.references} marks, ${pairs.json.notes} notes, none orphaned; read each mark against its note in readiness-pairs.json`,
    details,
    [ctx.bookSha]
  )
}

function c6(ctx, c1Result) {
  const parts = []
  if (c1Result.outcome === 'NOT CHECKED')
    parts.push(notRun('C6', `italics-absent runs inside C1, which did not run`))
  else if (c1Result.outcome === 'FAILED' && /italics-absent/u.test(c1Result.summary)) {
    parts.push(failed('C6', 'C1 found italics-absent'))
  } else parts.push(passed('C6', 'no italics-absent among C1’s findings'))
  if (ctx.witness) {
    const out = join(ctx.scratch, 'emphasis.json')
    const res = ctx.run.viteNode('scripts/emphasis-of.ts', [ctx.bookJson, ctx.witness, out])
    if (res.code !== 0 || !existsSync(out)) {
      parts.push(notRun('C6', 'emphasis-of.ts stopped with an error', tail(res)))
    } else {
      const dropped = readJsonSync(out).length
      parts.push(
        dropped === 0
          ? passed('C6', 'the witness saw no italic the book sets in roman', [`$ ${res.line}`])
          : person(
              'C6',
              `the witness saw ${dropped} italic the book sets in roman; crop a sample`,
              [`$ ${res.line}`, ...tail(res)],
              [ctx.bookSha]
            )
      )
    }
  } else {
    parts.push(
      person(
        'C6',
        'no italic witness was given (--witness <w.json>, from italic-witness.mjs or slant-witness.ts); a person gives one or signs off that this scan has none',
        [],
        [ctx.bookSha]
      )
    )
  }
  return parts
}

function c7(ctx) {
  if (!ctx.driver.ok) return needsDriver(ctx, 'C7')
  const res = ctx.run.drive('finish', [ctx.bookDir])
  return byExit('C7', res, /not finished/u, {
    ok: 'finish found nothing owed',
    bad: `finish found things owed: ${tail(res, 4).join(' ')}`
  })
}

function c8(ctx) {
  const body = ctx.body()
  if (!body.ok)
    return notRun('C8', `the assembled body could not be made: ${body.why}`, body.details)
  const res = ctx.run.node('scripts/book-files.mjs', [ctx.bookDir, '--check', '--body', body.path])
  const stale = res.out
    .split('\n')
    .filter((l) => /^\s{2}(STALE|MISSING|DRIFTED|UNMARKED|WALL)\b/u.test(l))
  return byExit('C8', res, /in step with book\.json|out of date/u, {
    ok: 'readable files and corrections.md in step with book.json',
    bad: `${stale.length} readable files out of step: ${stale.map((l) => l.trim()).join('; ')}`
  })
}

function c9(ctx) {
  const res = ctx.run.node('scripts/book-files.mjs', ['--shelf', join(ctx.shelf, 'books')])
  if (res.code !== 0) return notRun('C9', 'the shelf table could not be made', tail(res))
  const rows = res.out.split('\n').filter((l) => l.trim())
  const mine = rows.find((l) => l.startsWith(`${ctx.folder} `))
  return person(
    'C9',
    `this book's row: ${mine ? mine.replace(/\s+/gu, ' ').trim() : 'not in the table'}; compare it with the last comparable book's`,
    [`$ ${res.line}`, ...rows],
    [ctx.bookSha]
  )
}

function c10(ctx) {
  const args = ['audit', ctx.bookJson, '--name', 'Etsu T. Dhent', '--shelf', ctx.shelf]
  const res = ctx.run.node('scripts/voice.mjs', args)
  return byExit('C10', res, /sentences/u, {
    ok: "the editor's prose passed the audit",
    bad: "the audit flagged the editor's prose; fix the prose and run it again"
  })
}

function c11(ctx) {
  const texts = (ctx.book.run?.edits ?? [])
    .filter((e) => (e.kind === 'section' || e.kind === 'note') && typeof e.text === 'string')
    .map((e) => ({
      where:
        e.kind === 'section'
          ? `section "${e.title ?? e.sectionId ?? '?'}"`
          : `note at ${e.blockId ?? e.id ?? '?'}`,
      text: e.text
    }))
  for (const f of readdirSync(ctx.bookDir)
    .filter((n) => n.endsWith('.md') && !n.startsWith('readiness'))
    .sort()) {
    texts.push({ where: f, text: readFileSync(join(ctx.bookDir, f), 'utf8') })
  }
  const found = ctx.core.workingNotes(texts)
  const row = (h) => `${h.where}, line ${h.line}: (${h.word}) in "${h.context}"`
  const listed = (hits) => [
    ...hits.slice(0, 40).map(row),
    ...(hits.length > 40 ? [`… and ${hits.length - 40} more`] : [])
  ]
  const parts = []
  if (found.notes.length > 0) {
    parts.push(
      failed(
        'C11',
        `${found.notes.length} working notes left: ${found.notes
          .slice(0, 3)
          .map((h) => `(${h.word}) in ${h.where}`)
          .join(', ')}`,
        listed(found.notes)
      )
    )
  }
  if (found.toRead.length > 0) {
    parts.push(
      person('C11', `${found.toRead.length} other bracketed words to read`, listed(found.toRead), [
        ctx.bookSha
      ])
    )
  }
  if (parts.length === 0) {
    parts.push(
      passed(
        'C11',
        `no working notes in ${texts.length} texts (${found.ordinary} list marks and "(sic)" not counted)`
      )
    )
  }
  return parts
}

function c12(ctx) {
  const body = ctx.body()
  if (!body.ok)
    return notRun('C12', `the assembled body could not be made: ${body.why}`, body.details)
  const s = ctx.core.emphasisSurvival(readJsonSync(body.path))
  const t = (x) => `${x.i} italic, ${x.b} bold, ${x.sc} small capitals`
  const said = `first reading ${t(s.totals.pristine)}; corrected ${t(s.totals.edited)}; ${s.compared} blocks compared, ${s.uncompared} merged away`
  if (s.losses.length === 0) return passed('C12', said)
  return person(
    'C12',
    `${s.losses.length} blocks carry fewer tags than first read; read each (${said})`,
    s.losses.slice(0, 40).map((l) => `${l.id}: <${l.tag}> ${l.was} → ${l.now}`),
    [ctx.bookSha]
  )
}

/** C1 to C12, in order. */
export function checkedStage(ctx) {
  const one = c1(ctx)
  return [
    one,
    c2(ctx),
    ...c3(ctx),
    c4(ctx),
    c5(ctx),
    ...c6(ctx, one),
    c7(ctx),
    c8(ctx),
    c9(ctx),
    c10(ctx),
    ...c11(ctx),
    c12(ctx)
  ]
}
