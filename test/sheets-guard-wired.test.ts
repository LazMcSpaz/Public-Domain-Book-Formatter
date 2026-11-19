import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The refusal itself is tested in sheets-beside-the-book.test.ts. This pins
 * the wiring the driver cannot be unit-tested for (it runs the shelf map in a
 * browser page): every sheet destination goes through `sheetTarget`, which
 * must call `refuseInsideTools`, which must ask `sheetRefusal` and throw on
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

  it('refuseInsideTools asks sheetRefusal and throws on an answer', () => {
    const guard = body('refuseInsideTools')
    expect(guard).toMatch(/askShelfMap\('sheetRefusal'/)
    expect(guard).toMatch(/if \(refused\) throw new Error\(refused\)/)
  })

  it('no sheet verb defaults to a bare file name, which would land in the repository root', () => {
    expect(driver).not.toMatch(
      /\?\? '(queries|rulings|review|damage|parallels|proposals|sense)\.md'/
    )
  })
})
