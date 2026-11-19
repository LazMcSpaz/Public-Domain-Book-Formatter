import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error a plain-Node helper with no type declarations
import { houseLookBeside } from '../scripts/lib/house-look.mjs'

/**
 * The house look's rules are tested in house-look.test.ts. This pins where
 * the driver and the app find the file and that both lay out through the one
 * door (`renderInLook`, `useHouseLook`), so neither grows its own copy of the
 * rules. Put back `proof`'s old direct `renderInterior` call and this fails.
 */
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const driver = read('scripts/drive.mjs')
const app = read('src/app/App.tsx')
const hook = read('src/app/house-look.ts')
const platform = read('src/platform/browser/house-look.ts')

function verb(name: string): string {
  const start = driver.indexOf(`\n    ${name}: async (`)
  expect(start, `${name} is a verb in scripts/drive.mjs`).toBeGreaterThan(-1)
  return driver.slice(start, driver.indexOf('\n    },\n', start))
}

describe('the house look file is found at the top of the book’s shelf', () => {
  const root = mkdtempSync(join(tmpdir(), 'house-look-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const shelf = join(root, 'shelf')
  mkdirSync(join(shelf, 'books', 'A-Book'), { recursive: true })
  mkdirSync(join(shelf, 'imprint'), { recursive: true })
  writeFileSync(join(shelf, 'books', 'A-Book', 'book.json'), '{}')

  it('finds imprint/house-look.json above books/<Folder>/book.json', () => {
    writeFileSync(join(shelf, 'imprint', 'house-look.json'), '{"version":1}')
    const found = houseLookBeside(
      join(shelf, 'books', 'A-Book', 'book.json'),
      'imprint/house-look.json'
    )
    expect(found).toEqual({
      path: 'imprint/house-look.json',
      file: join(shelf, 'imprint', 'house-look.json'),
      text: '{"version":1}'
    })
  })

  it('says there is none when the shelf has none', () => {
    const bare = join(root, 'bare')
    mkdirSync(join(bare, 'books', 'B'), { recursive: true })
    expect(
      houseLookBeside(join(bare, 'books', 'B', 'book.json'), 'imprint/house-look.json')
    ).toBeNull()
  })

  it('takes a book outside a shelf as a shelf of its own', () => {
    const loose = join(root, 'loose')
    mkdirSync(join(loose, 'imprint'), { recursive: true })
    writeFileSync(join(loose, 'imprint', 'house-look.json'), 'x')
    expect(houseLookBeside(join(loose, 'book.json'), 'imprint/house-look.json')?.text).toBe('x')
  })
})

describe('proof and the design gate inherit through one door', () => {
  it('proof reads the file beside the book’s shelf, by the shelf map’s path', () => {
    expect(driver).toMatch(/import \{ houseLookBeside \} from '\.\/lib\/house-look\.mjs'/u)
    const proof = verb('proof')
    expect(proof).toMatch(/houseLookBeside\(lookFrom, await askShelfMap\('houseLookPath'\)\)/u)
  })

  it('proof lays out through renderInLook, never straight through renderInterior', () => {
    const proof = verb('proof')
    expect(proof).toMatch(/looks\.renderInLook\(doc, \{/u)
    expect(proof).not.toMatch(/renderInterior\(/u)
    // Never silent: the line names the house look, or the defaults and why.
    expect(proof).toMatch(/from === 'house'\s*\?\s*houseLine/u)
    expect(proof).toMatch(/DEFAULTS/u)
  })

  it('the gate is filled only while the person is still on the design step when measuring ends', () => {
    const then = hook.slice(hook.indexOf('.then((pages)'))
    expect(then).toMatch(/now\.stepId !== 'design' \|\|/)
    expect(then.indexOf("now.stepId !== 'design'")).toBeLessThan(then.indexOf('now.setAnswers('))
  })

  it('inherited answers are kept with a fresh look, so a banked look cannot creep under them', () => {
    expect(platform).toMatch(/return \{ \.\.\.design, profile: FRESH_LOOK \}/u)
    expect((platform.match(/design: asBookDesign\(/gu) ?? []).length).toBe(3)
    expect(hook).toMatch(/now\.setAnswers\(asBookDesign\(design\)\)/u)
  })

  it('the app measures the length as proof does, from the shipped defaults', () => {
    expect(hook).toMatch(/defaultLook: null, styleProfiles: \[\]/u)
  })

  it('the app asks the hook, and the hook asks core', () => {
    expect(app).toMatch(/useHouseLook\(\{/u)
    expect(hook).toMatch(/houseDesignFor\(house\.look, pages\)/u)
    expect(hook).toMatch(/hasOwnDesign\(own\)/u)
    expect(hook).toMatch(/fetchHouseLook\(config\)/u)
  })
})
