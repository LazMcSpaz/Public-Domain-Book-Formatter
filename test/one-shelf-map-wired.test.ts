import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The helper itself is tested in book-pictures.test.ts. This pins the wiring
 * the driver and the EPUB builder cannot be unit-tested for: every script
 * that turns a picture a book names into a file asks `lib/book-pictures.mjs`,
 * which asks core's `pictureCandidates`, and none works the place out by hand.
 * Put back a loop over "the shelf root, then the book's folder" and this fails.
 */
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const driver = read('scripts/drive.mjs')
const epub = read('scripts/epub-of.ts')
const helper = read('scripts/lib/book-pictures.mjs')

function verb(name: string): string {
  const start = driver.indexOf(`\n    ${name}: async (`)
  expect(start, `${name} is a verb in scripts/drive.mjs`).toBeGreaterThan(-1)
  return driver.slice(start, driver.indexOf('\n    },\n', start))
}

describe('the scripts find pictures through one helper', () => {
  it('the helper asks core’s rule and does not copy it', () => {
    expect(helper).toMatch(
      /await import\('\.\.\/\.\.\/src\/core\/sync\/pictures\.ts'\)\)\.pictureCandidates/
    )
    // The rule's own refusals live in core; a copy here would drift from it.
    expect(helper).not.toMatch(/URL_SPECIAL|settle\(|'\.\.'/)
  })

  it('the driver imports it', () => {
    expect(driver).toMatch(
      /import \{ findBookPictures, findPicture, picturePlaces \} from '\.\/lib\/book-pictures\.mjs'/
    )
  })

  it('the driver hands the helper its page’s copy of the rule, so no Node feature is needed', () => {
    expect(driver).toMatch(
      /const pictureRule = \(bookFile, picture\) => askShelfMap\('pictureCandidates', bookFile, picture\)/
    )
  })

  it('load finds every picture the book names with findBookPictures, and reports the lost', () => {
    const load = verb('load')
    expect(load).toMatch(
      /await findBookPictures\(bookFile, JSON\.parse\(json\)\.images, pictureRule\)/
    )
    expect(load).toMatch(/const missing = named\.lost/)
    expect(load).toMatch(/missingImages: missing/)
    // The old roots: the shelf root first, then the book's folder.
    expect(load).not.toMatch(/resolve\(dirname\(bookFile\), '\.\.', '\.\.'\)/)
    expect(load).not.toMatch(/image\.path/)
  })

  it('save keeps a picture where the rule finds it and writes a new one where it looks first', () => {
    const save = verb('save')
    expect(save).toMatch(/if \(await findPicture\(path, picture\.path, pictureRule\)\) continue/)
    expect(save).toMatch(
      /const \[target\] = await picturePlaces\(path, picture\.path, pictureRule\)/
    )
    expect(save).not.toMatch(/resolve\(dirname\(path\), picture\.path\)/)
  })

  it('the EPUB builder copies each picture from where the helper finds it, and stops on a lost one', () => {
    expect(epub).toMatch(/import \{ findBookPictures \} from '\.\/lib\/book-pictures\.mjs'/)
    expect(epub).toMatch(/await findBookPictures\(bookFile, /)
    expect(epub).toMatch(/const lost = named\.lost\.join\(.*\)\nif \(lost\) throw new Error/)
    expect(epub).toMatch(/copyFileSync\(p\.file, /)
    expect(epub).not.toMatch(/join\(dir, src\)/)
  })

  it('no script resolves a named picture’s path by hand', () => {
    const dirs = ['scripts', 'scripts/lib']
    const files = dirs.flatMap((dir) =>
      readdirSync(new URL(`../${dir}`, import.meta.url))
        .filter((name) => /\.(mjs|ts)$/u.test(name))
        .map((name) => join(dir, name))
    )
    // `resolve(…, image.path)` or `join(…, picture.path)`, one level of
    // brackets inside allowed (`resolve(dirname(path), picture.path)`).
    const byHand =
      /\b(resolve|join)\((?:[^()]|\([^()]*\))*\b(image|picture|src)\.path\b|\b(resolve|join)\(dir, src\)/u
    for (const file of files) {
      if (file === join('scripts', 'lib', 'book-pictures.mjs')) continue
      expect(read(file), file).not.toMatch(byHand)
    }
  })
})
