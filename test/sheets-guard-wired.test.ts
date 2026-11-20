import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The refusal itself is tested in sheets-beside-the-book.test.ts, and the
 * shared guard in work-script.test.ts. This pins the wiring the driver cannot
 * be unit-tested for (it runs the shelf map in a browser page): every sheet
 * destination goes through `sheetTarget`, which must call
 * `refuseInsideTools`, which must ask `sheetRefusal` (this checkout, with a
 * message naming the book's folder), then `toolsRefusal` from
 * `lib/tools-guard.mjs` (any copy of the tools, links followed), and throw on
 * an answer. Take any link out and this fails, so a sheet that quotes a book
 * cannot quietly start landing in this public repository again.
 */
const driver = readFileSync(new URL('../scripts/drive.mjs', import.meta.url), 'utf8')

function body(name: string): string {
  const start = driver.indexOf(`const ${name} = async`)
  expect(start, `${name} is defined in scripts/drive.mjs`).toBeGreaterThan(-1)
  const end = driver.indexOf('\n  }\n', start)
  return driver.slice(start, end)
}

describe('the sheet guard is wired into the driver', () => {
  it('sheetTarget refuses through refuseInsideTools', () => {
    expect(body('sheetTarget')).toMatch(/await refuseInsideTools\(target, book\.file\)/)
  })

  it('refuseInsideTools asks sheetRefusal, then the shared guard, and throws on an answer', () => {
    const guard = body('refuseInsideTools')
    expect(guard).toMatch(/askShelfMap\('sheetRefusal'/)
    expect(guard).toMatch(/\?\?\s*toolsRefusal\(target, /)
    expect(guard).toMatch(/if \(refused\) throw new Error\(refused\)/)
  })

  it('the shared guard is the one in lib/tools-guard.mjs', () => {
    expect(driver).toMatch(/^import \{ toolsRefusal \} from '\.\/lib\/tools-guard\.mjs'$/m)
  })

  it('no sheet verb defaults to a bare file name, which would land in the repository root', () => {
    expect(driver).not.toMatch(
      /\?\? '(queries|rulings|review|damage|parallels|proposals|sense)\.md'/
    )
  })
})

/**
 * The working files carry the book's text as the sheets do. They used to
 * default to a bare name resolved in the tools checkout; now each verb takes
 * its path from `workTarget`, which writes to a scratch folder under the
 * system's temporary folder and refuses a path inside this repository.
 */
const WORKING = {
  body: 'body.json',
  truth: 'truth.json',
  chunks: 'chunks.json',
  concordance: 'concordance.json',
  witness: 'witness.json',
  second: 'second.json',
  cleantrial: 'cleantrial.json'
}

function verb(name: string): string {
  const start = driver.indexOf(`\n    ${name}: async (`)
  expect(start, `${name} is a verb in scripts/drive.mjs`).toBeGreaterThan(-1)
  return driver.slice(start, driver.indexOf('\n    },\n', start))
}

describe('the working-file guard is wired into the driver', () => {
  it('workTarget defaults outside the repository and refuses inside it', () => {
    expect(driver).toMatch(/const WORK_DIR = resolve\(tmpdir\(\), 'pdbf-work'\)/)
    const guard = body('workTarget')
    expect(guard).toMatch(/: resolve\(WORK_DIR, name\)/)
    expect(guard).toMatch(/askShelfMap\('workFileRefusal', realTarget\(target\), REPO_REAL/)
    expect(guard).toMatch(/\?\?\s*toolsRefusal\(target, /)
    expect(guard).toMatch(/if \(refused\) throw new Error\(refused\)/)
  })

  it('every working-file verb writes where workTarget says, and only there', () => {
    for (const [name, file] of Object.entries(WORKING)) {
      const code = verb(name)
      expect(code, name).toMatch(new RegExp(`const out = await workTarget\\(\\s*'${file}'`))
      expect(code, name).not.toMatch(/writeFile\(\s*resolve\(/)
      expect(code, name).toMatch(/writeFile\(out, /)
    }
  })

  it('no working-file verb defaults to a bare name in the repository', () => {
    const names = Object.values(WORKING).join('|').replace(/\./g, '\\.')
    expect(driver).not.toMatch(new RegExp(`(=|\\?\\?)\\s*'(${names})'`))
  })
})
