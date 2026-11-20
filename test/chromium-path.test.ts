/**
 * Which Chromium a browser script drives (`scripts/lib/chromium.mjs`).
 *
 * The cover scripts carried a path that was only ever right in one sandbox;
 * anywhere else the launch failed with a missing executable. The rule: the
 * environment's `CHROMIUM_PATH` first, the vendored browser only if it is
 * there, and otherwise nothing, so Playwright launches its own.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain-Node helper with no type declarations
import { chromiumPath } from '../scripts/lib/chromium.mjs'

describe('chromiumPath', () => {
  it('takes CHROMIUM_PATH when it is set, whatever else is on the machine', () => {
    expect(chromiumPath({ CHROMIUM_PATH: '/made/up/chrome' }, () => true)).toBe('/made/up/chrome')
  })

  it('takes the vendored browser only when it is actually there', () => {
    expect(chromiumPath({}, () => true)).toMatch(/chrome$/)
  })

  it('leaves the choice to Playwright when neither is there', () => {
    expect(chromiumPath({}, () => false)).toBeUndefined()
  })
})
