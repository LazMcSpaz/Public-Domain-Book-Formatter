import { describe, it, expect } from 'vitest'
import { assetUrl } from '../src/renderer/utils/asset-url'
import { trimWidthInches, MIN_PRINT_DPI } from '../src/renderer/components/ImageMode/dpi'

describe('assetUrl', () => {
  it('builds a local-asset URL with encoded root and path', () => {
    expect(assetUrl('/books/my.bookproj', 'assets/p1.png')).toBe(
      'local-asset://img/?root=%2Fbooks%2Fmy.bookproj&path=assets%2Fp1.png'
    )
  })

  it('encodes spaces and special characters so the URL is well-formed', () => {
    const url = assetUrl('/My Books/A & B.bookproj', 'assets/page 1.png')
    expect(url.startsWith('local-asset://img/?root=')).toBe(true)
    expect(url).toContain('%20') // space encoded
    expect(url).toContain('%26') // ampersand encoded
    const parsed = new URL(url)
    expect(parsed.searchParams.get('root')).toBe('/My Books/A & B.bookproj')
    expect(parsed.searchParams.get('path')).toBe('assets/page 1.png')
  })
})

describe('trimWidthInches', () => {
  it('parses the width from a trim token', () => {
    expect(trimWidthInches('6x9')).toBe(6)
    expect(trimWidthInches('5.5x8.5')).toBe(5.5)
    expect(trimWidthInches('6.14×9.21')).toBeCloseTo(6.14)
  })

  it('falls back when missing or unparseable', () => {
    expect(trimWidthInches(undefined)).toBe(6)
    expect(trimWidthInches('not-a-size')).toBe(6)
    expect(trimWidthInches('', 5)).toBe(5)
  })

  it('exposes the KDP minimum DPI constant', () => {
    expect(MIN_PRINT_DPI).toBe(300)
  })
})
