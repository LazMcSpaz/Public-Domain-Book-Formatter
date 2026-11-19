/**
 * R1 to R11, the checks for "ready to upload", as `readiness.mjs` runs them,
 * every one on the exact files named for KDP. R5 (no markup, made from this
 * book file), R7 (covers for this page count) and R11 (pictures described,
 * read out of the EPUB itself) are done here; the spelling sheet and the
 * export report come from the existing commands; the rest are a person's.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tail } from './readiness-run.mjs'
import { failed, notRun, passed, person } from './readiness-checked.mjs'
import { inStep, lastCommitted, pdfFacts, uncommitted } from './readiness-files.mjs'
import { readZip } from './zip.mjs'

function pdftotext(path, layout = false) {
  const r = spawnSync('pdftotext', [...(layout ? ['-layout'] : []), path, '-'], {
    encoding: 'utf8',
    maxBuffer: 1 << 30
  })
  if (r.error) return { ok: false, why: 'pdftotext is not installed (poppler-utils)' }
  if (r.status !== 0) return { ok: false, why: `pdftotext could not read it: ${r.stderr.trim()}` }
  return { ok: true, text: r.stdout }
}

const noInterior = (id) => notRun(id, 'no interior PDF was named (--interior)')

function r1(ctx, interior) {
  if (!interior) return noInterior('R1')
  const sheet = join(ctx.sheets, 'readiness-spelling.md')
  const res = ctx.run.viteNode('scripts/spelling-of.ts', [
    ctx.bookJson,
    '--shelf',
    join(ctx.shelf, 'books'),
    '--text',
    interior.path,
    '--out',
    sheet
  ])
  const json = /\{[\s\S]*\}/u.exec(res.out)
  let said = null
  try {
    said = json ? JSON.parse(json[0]) : null
  } catch {
    /* not the report */
  }
  const details = [`$ ${res.line}`]
  if (res.code !== 0 || !said || !existsSync(sheet)) {
    return notRun('R1', `the spelling check did not write its sheet: ${tail(res, 2).join(' ')}`, [
      ...details,
      ...tail(res)
    ])
  }
  if (said.words + said.names === 0) return passed('R1', 'nothing on the spelling sheet', details)
  return person(
    'R1',
    `readiness-spelling.md lists ${said.words} words and ${said.names} names to read, every word decided`,
    details,
    [interior.sha256]
  )
}

/** The export report: the saved one, or the driver's proof of the same text. */
async function exportReport(ctx, interior) {
  if (ctx.exportReport) {
    const report = JSON.parse(readFileSync(ctx.exportReport, 'utf8'))
    return { report, from: `the saved report ${ctx.run.short(ctx.exportReport)}` }
  }
  if (!ctx.driver.ok) {
    return {
      why: `no saved export report was given (--export-report) and the driver is ${ctx.driver.why}`
    }
  }
  const rebuilt = join(ctx.scratch, 'rebuilt.pdf')
  const res = ctx.run.drive('proof', [`answers=${ctx.bookJson}`, `pdf=${rebuilt}`])
  if (!res.json || !existsSync(rebuilt)) return { why: `proof stopped: ${tail(res, 2).join(' ')}` }
  const a = pdftotext(rebuilt)
  const b = pdftotext(interior.path)
  if (!a.ok || !b.ok) return { why: a.why ?? b.why }
  if (a.text !== b.text) {
    return {
      why: 'the PDF the driver makes from this book now prints different text from the upload file, so its report is not the upload file’s'
    }
  }
  return {
    report: res.json,
    from: 'a proof run in the driver that prints the same text as the upload file'
  }
}

function r2r3(ctx, interior, got) {
  if (!interior) return [noInterior('R2'), noInterior('R3')]
  if (!got.report) return [notRun('R2', got.why), notRun('R3', got.why)]
  const rep = got.report
  if (rep.pages !== interior.pages) {
    const why = `${got.from} is for a PDF of ${rep.pages} pages; the interior has ${interior.pages}`
    return [notRun('R2', why), notRun('R3', why)]
  }
  const wrong = [
    rep.warnings !== 0 && `warnings: ${rep.warnings}`,
    (rep.notesDropped ?? []).length > 0 && `notes dropped: ${JSON.stringify(rep.notesDropped)}`,
    (rep.imagesDropped ?? []).length > 0 &&
      `pictures dropped: ${JSON.stringify(rep.imagesDropped)}`,
    rep.designFrom !== 'the book file' && `design from ${rep.designFrom}`
  ].filter(Boolean)
  const r2 =
    wrong.length === 0
      ? passed('R2', `clean, from ${got.from}`)
      : failed(
          'R2',
          wrong.join('; '),
          (rep.warningsFirst ?? []).map((w) => `page ${w.page}: ${w.text}`)
        )
  const boxes = Array.isArray(rep.unprintable)
    ? rep.unprintable
    : Object.keys(rep.unprintable ?? {})
  const r3 =
    boxes.length === 0
      ? passed('R3', `no unprintable character, from ${got.from}`)
      : person(
          'R3',
          `${boxes.length} characters print as an empty box; the editor rules on each`,
          [JSON.stringify(rep.unprintable).slice(0, 600)],
          [interior.sha256]
        )
  return [r2, r3]
}

/**
 * Whether `file` was made after `dependsOn` (shelf-relative) last changed, as
 * far as can be told: `{ state: 'in step' | 'stale' | 'unknown', why }`. Git
 * first (the commit that holds this exact file); else the date the PDF says
 * it was made, against the last commit of `dependsOn`.
 */
async function madeAfter(ctx, file, dependsOn) {
  const step = inStep(ctx.shelf, file, dependsOn)
  if (step.state !== 'unknown') return step
  const facts = file.name.toLowerCase().endsWith('.pdf')
    ? await pdfFacts(file.path).catch(() => null)
    : null
  const last = lastCommitted(ctx.shelf, dependsOn)
  if (!facts?.created || !last) {
    return {
      state: 'unknown',
      why: `${step.why}; no date to compare${facts?.created ? '' : ' (the file gives none)'}`
    }
  }
  const dates = `the file says it was made ${facts.created.toISOString()}; ${dependsOn} last changed ${last.toISOString()}`
  if (facts.created < last) return { state: 'stale', why: `${step.why}; ${dates}` }
  if (uncommitted(ctx.shelf, dependsOn) !== false) {
    return { state: 'unknown', why: `${step.why}; ${dates}, and it has changes not committed` }
  }
  return { state: 'in step', why: `${step.why}; ${dates}` }
}

async function r5(ctx, interior) {
  if (!interior) return noInterior('R5')
  const text = pdftotext(interior.path)
  if (!text.ok) return notRun('R5', text.why)
  const tags = ctx.core.countMarkup(text.text)
  const markup =
    tags === 0
      ? passed('R5', 'no <i>, <b> or <sc> in the PDF text')
      : failed('R5', `${tags} of our own tags print in the PDF text`)
  // The book file changes for things that never print (a picture's alt text, a
  // memo, a query), so a change after the PDF is a person's call, not a failure.
  const made = await madeAfter(ctx, interior, `${ctx.bookRel}/book.json`)
  const step =
    made.state === 'in step'
      ? passed('R5', made.why)
      : person(
          'R5',
          `${made.why}; a person confirms the change does not touch what prints, or the book is exported again`,
          [],
          [interior.sha256]
        )
  return [markup, step]
}

async function r7(ctx, interior, covers) {
  if (!interior) return noInterior('R7')
  const specs = ['softcover', 'hardcover'].map((cover) => {
    const path = join(ctx.bookDir, 'covers', `${cover}.json`)
    if (!existsSync(path)) return { cover, missing: true }
    const n = JSON.parse(readFileSync(path, 'utf8')).pageCount
    return { cover, pageCount: Number.isInteger(n) ? n : null }
  })
  if (specs.every((s) => s.missing))
    return notRun(
      'R7',
      'this book has no cover specs (covers/softcover.json, covers/hardcover.json)'
    )
  const parts = []
  for (const s of specs.filter((x) => x.missing))
    parts.push(notRun('R7', `no covers/${s.cover}.json`))
  const wrong = ctx.core.coverCountsDisagree(
    interior.pages,
    specs.filter((s) => !s.missing)
  )
  parts.push(
    wrong.length === 0
      ? passed('R7', `both cover specs say ${interior.pages} pages, as the interior has`)
      : failed('R7', wrong.join('; '))
  )
  for (const s of specs.filter((x) => !x.missing)) {
    const file = covers[s.cover]
    if (!file) parts.push(notRun('R7', `no ${s.cover} cover PDF was named (--${s.cover})`))
    else if (!/-flat\.pdf$/iu.test(file.name))
      parts.push(failed('R7', `the ${s.cover} cover named is ${file.name}, not the -flat copy`))
    else {
      // A change to the spec is a recut by definition: the composer redraws
      // from it, so a flat copy older than its spec is stale (upload.md).
      const made = await madeAfter(ctx, file, `${ctx.bookRel}/covers/${s.cover}.json`)
      parts.push(
        made.state === 'in step'
          ? passed('R7', made.why)
          : made.state === 'stale'
            ? failed(
                'R7',
                `the ${s.cover} flat copy is older than its spec: ${made.why}; recut and flatten again`
              )
            : person(
                'R7',
                `cannot tell whether the ${s.cover} flat copy was made after the last recut: ${made.why}`,
                [],
                [file.sha256]
              )
      )
    }
  }
  return parts
}

function r11(ctx, epub) {
  if (!epub) return notRun('R11', 'no EPUB was named (--epub)')
  let pages
  try {
    pages = readZip(readFileSync(epub.path), (n) => /\.x?html?$/iu.test(n)).map((e) => ({
      name: e.name,
      text: e.bytes.toString('utf8')
    }))
  } catch (e) {
    return notRun('R11', `the EPUB could not be read: ${e.message}`)
  }
  const found = ctx.core.undescribedPictures(pages)
  if (found.undescribed.length > 0) {
    return failed(
      'R11',
      `${found.undescribed.length} of ${found.pictures} pictures have no description`,
      found.undescribed.map((u) => `${u.file}: ${u.src}`)
    )
  }
  return passed(
    'R11',
    found.pictures === 0
      ? `no pictures in ${pages.length} pages`
      : `all ${found.pictures} pictures described`
  )
}

/** R1 to R11, in order, on the named files. */
export async function readyStage(ctx) {
  const { interior, softcover, hardcover, epub } = ctx.files
  const covers = { softcover, hardcover }
  const coverShas = [softcover, hardcover].filter(Boolean).map((f) => f.sha256)
  const byHand = (id, what) => (interior ? person(id, what, [], [interior.sha256]) : noInterior(id))
  const at = interior ? ctx.run.short(interior.path) : '<interior.pdf>'
  const content = (() => {
    const p = join(ctx.bookDir, 'covers', 'softcover.json')
    const c = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')).content ?? {}) : {}
    return [
      `cover title: ${String(c.title ?? '?').replace(/\s*\n\s*/gu, ' ')}`,
      `subtitle: ${c.subtitle ?? '?'}`,
      `author: ${c.author ?? '?'}`
    ]
  })()
  return [
    r1(ctx, interior),
    ...r2r3(ctx, interior, interior ? await exportReport(ctx, interior) : {}),
    byHand(
      'R4',
      `read the note sequence out of the PDF (\`pdftotext ${at} -\`) against \`drive.mjs pairs\`; not built yet (proposed check)`
    ),
    ...[await r5(ctx, interior)].flat(),
    byHand('R6', `\`pdftotext -layout ${at} - | less\` reads as words`),
    ...[await r7(ctx, interior, covers)].flat(),
    byHand(
      'R8',
      'look at the proof pages: title page, contents, a chapter opening, a page with a note, a picture page, a blank verso'
    ),
    byHand(
      'R9',
      'count lines that open on a closing mark or end on an opening one in the pdftotext output; not built yet (proposed check)'
    ),
    coverShas.length === 0
      ? notRun('R10', 'no cover PDF was named (--softcover, --hardcover)')
      : person(
          'R10',
          'compare the KDP listing (the book’s entry in KDP-listings.md) with the cover: title with its label, subtitle, author',
          content,
          coverShas
        ),
    r11(ctx, epub)
  ]
}
