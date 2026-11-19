import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The decisions are tested in recon-plan.test.ts and witness-boxes.test.ts.
 * This pins the call sites that run in the driver's browser page, where no
 * unit test reaches (cleanup tasks 17 and 18): take a link out and this fails.
 */
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const driver = read('../scripts/drive.mjs')

function verb(name: string): string {
  const start = driver.indexOf(`\n    ${name}: async (`)
  expect(start, `${name} is a verb in scripts/drive.mjs`).toBeGreaterThan(-1)
  return driver.slice(start, driver.indexOf('\n    },\n', start))
}

describe('transcribe refuses leaves no reading covers', () => {
  const code = verb('transcribe')

  it('decides before anything is written, and throws the refusal', () => {
    const gate = code.indexOf('project.ocrGateRefusal(')
    expect(gate).toBeGreaterThan(-1)
    expect(code).toMatch(/if \(refusal\) throw new Error\(refusal\)/)
    expect(code.indexOf('if (refusal) throw new Error(refusal)')).toBeLessThan(
      code.indexOf('runStore.saveRun(')
    )
    expect(gate).toBeLessThan(code.indexOf('project.mergeBatchIntoRun('))
  })

  it('takes the flag from the command line into the page, and reports through core', () => {
    expect(code).toMatch(/flags\.includes\('--without-ocr-check'\)/)
    expect(code).toMatch(/\[REPO, file, pages, mode === 'replace', withoutCheck\]/)
    expect(code).toMatch(/withoutCheck\s*\}\)\s*\n\s*if \(refusal\)/)
    expect(code).toMatch(/ocr: project\.ocrReport\(/)
  })

  it('never blocks a book with no scan', () => {
    expect(code).toMatch(
      /project\.reconDoesNotApply\(\{\s*fileName: file\.name,\s*shape: held\?\.shape\s*\}\)/
    )
  })
})

describe('every reader of the recon cache asks with the app’s conditions', () => {
  it('no driver verb leaves the cleaning out of what it asks for', () => {
    expect(driver).not.toMatch(
      /loadRecon(Cache|Checkpoint)\([^)]*\{\s*dpi: recon\.RECON_DPI,\s*maxPages: null\s*\}/
    )
    expect(verb('transcribe')).toMatch(/loadReconCache\(key, recon\.BOOK_RECON\)/)
    expect(verb('reconexport')).toMatch(/const wanted = recon\.BOOK_RECON/)
  })

  it('the app asks with the same value', () => {
    const app = read('../src/app/App.tsx')
    expect(app.match(/const wanted = BOOK_RECON\n/g)).toHaveLength(2)
    expect(app).not.toMatch(/\{ dpi: RECON_DPI, maxPages: null/)
  })
})

describe('recon and load', () => {
  it('recon runs reconBook in the page and reports through reconReport', () => {
    const code = verb('recon')
    expect(code).toMatch(/\.reconBook\(key, opts\)/)
    expect(code).toMatch(/\.reconUnderWay\(\)/)
    expect(code).toMatch(/return reconReport\(outcome, \{ beside \}\)/)
    expect(code).toMatch(/resolve\(dirname\(book\.file\), 'recon\.json\.gz'\)/)
  })

  it('the client prints progress while a whole reading runs', () => {
    expect(driver).toMatch(
      /if \(verb === 'recon' && !args\.includes\('--status'\)\) tickRecon\(PORT\)/
    )
  })

  it('load reports whether a reading is cached', () => {
    const code = verb('load')
    expect(code).toMatch(/\.reconStatusLine\(\s*key,\s*beside\s*\)/)
    expect(code).toMatch(/bookFile,\n\s*reading\n/)
  })

  it('reconimport and recon file a shelf reading the same way', () => {
    expect(verb('reconimport')).toMatch(/reconRun\.saveHandoffAsCache\(key, handoff\)/)
  })
})

describe('the italic witnesses fail before writing anything', () => {
  it('words --out writes the boxes through witnessPages, never into this repository', () => {
    const code = verb('words')
    expect(code).toMatch(/const out = await workTarget\('boxes\.json', named\)/)
    expect(code).toMatch(/image\.witnessPages\(cached\.words, recon\.BOOK_RECON\.dpi, leaves\)/)
  })

  it('slant-witness.ts asks noWordsMeasured and exits before its write', () => {
    const code = read('../scripts/slant-witness.ts')
    const asked = code.indexOf('noWordsMeasured({')
    const exit = code.indexOf('process.exit(1)', asked)
    expect(asked).toBeGreaterThan(-1)
    expect(exit).toBeGreaterThan(asked)
    expect(exit).toBeLessThan(code.indexOf('writeFileSync(outPath'))
    expect(code).toMatch(/const DPI = WITNESS_DPI/)
  })

  it('italic-witness.mjs exits before its write when it judged no line', () => {
    const code = read('../scripts/italic-witness.mjs')
    const check = code.indexOf('if (judged === 0)')
    expect(check).toBeGreaterThan(-1)
    expect(code.indexOf('process.exit(1)', check)).toBeLessThan(
      code.indexOf('fs.writeFileSync(out')
    )
  })
})
