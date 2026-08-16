import { describe, it, expect } from 'vitest'
import { RECON_CACHE_VERSION, reconCacheUsable, reconStamp } from '@core/project'

/**
 * Everything here is about *refusing* a stored reading. Accepting one is the
 * easy half and saves ten minutes; accepting a wrong one puts every word box in
 * the wrong place and reports it as a book that was read.
 */
describe('reconCacheUsable — when a stored reading may be reused', () => {
  const wanted = { dpi: 300, maxPages: null }
  const good = { ...reconStamp(wanted) }

  it('accepts a reading taken under the same conditions', () => {
    expect(reconCacheUsable(good, wanted)).toBe(true)
  })

  it('refuses one taken at a different resolution', () => {
    // Word boxes, crops and illustration regions are all in page pixels. At a
    // different DPI every one of them points somewhere else, and the KDP image
    // check divides the placed size by a number the pixels never had.
    expect(reconCacheUsable({ ...good, dpi: 200 }, wanted)).toBe(false)
    expect(reconCacheUsable({ ...good, dpi: 400 }, wanted)).toBe(false)
  })

  it('refuses a partial reading when the whole book was asked for', () => {
    // The "try a few pages first" path reads part of a scan. Handed back as the
    // whole thing it makes a book that is missing its second half in silence.
    expect(reconCacheUsable({ ...good, maxPages: 5 }, wanted)).toBe(false)
  })

  it('refuses a whole reading when only a few pages were asked for', () => {
    expect(reconCacheUsable(good, { dpi: 300, maxPages: 5 })).toBe(false)
    expect(reconCacheUsable({ ...good, maxPages: 5 }, { dpi: 300, maxPages: 5 })).toBe(true)
  })

  it('refuses a record written by another version of the shape', () => {
    expect(reconCacheUsable({ ...good, version: RECON_CACHE_VERSION + 1 }, wanted)).toBe(false)
    expect(reconCacheUsable({ ...good, version: RECON_CACHE_VERSION - 1 }, wanted)).toBe(false)
  })

  it('refuses a record from before the page limit was recorded', () => {
    // A missing field is not the same claim as "all of them": it is no claim.
    const { maxPages, ...older } = good
    expect(maxPages).toBeNull()
    expect(reconCacheUsable(older, wanted)).toBe(false)
  })

  it('refuses rubbish without throwing over it', () => {
    for (const junk of [null, undefined, 0, '', 'a reading', [], true]) {
      expect(reconCacheUsable(junk, wanted)).toBe(false)
    }
  })

  it('stamps what it was actually taken under', () => {
    expect(reconStamp({ dpi: 150, maxPages: 8 })).toEqual({
      version: RECON_CACHE_VERSION,
      dpi: 150,
      maxPages: 8
    })
  })
})
