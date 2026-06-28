import { describe, it, expect } from 'vitest'
import { defaultStyleProfile, mergeStyle } from '@core/style'
import { validateKdp, minGutterForPageCount } from '@core/typeset'

function check(report: ReturnType<typeof validateKdp>, id: string) {
  const c = report.checks.find((x) => x.id === id)
  if (!c) throw new Error(`missing check ${id}`)
  return c
}

describe('minGutterForPageCount', () => {
  it('scales up with page count', () => {
    expect(minGutterForPageCount(100)).toBeLessThan(minGutterForPageCount(400))
    expect(minGutterForPageCount(400)).toBeLessThan(minGutterForPageCount(800))
  })
})

describe('validateKdp', () => {
  it('passes a healthy book and reports ready', () => {
    const report = validateKdp({
      profile: defaultStyleProfile(),
      pageCount: 120,
      images: [{ effectiveDpi: 600 }],
      warnings: [],
      fontsEmbedded: true
    })
    expect(report.ready).toBe(true)
    expect(report.checks.every((c) => c.level !== 'fail')).toBe(true)
  })

  it('fails when gutter is inadequate for a heavy book', () => {
    // tiny inner margin + no gutter, large page count
    const profile = mergeStyle(defaultStyleProfile(), {
      margins: { top: 0.5, bottom: 0.5, inner: 0.2, outer: 0.5 },
      gutter: 0
    })
    const report = validateKdp({ profile, pageCount: 650, warnings: [] })
    const gutter = check(report, 'gutter')
    expect(gutter.level).toBe('fail')
    expect(report.ready).toBe(false)
  })

  it('warns on low-DPI images', () => {
    const report = validateKdp({
      profile: defaultStyleProfile(),
      pageCount: 100,
      images: [{ effectiveDpi: 150 }, { effectiveDpi: 600 }],
      warnings: []
    })
    const dpi = check(report, 'image-dpi')
    expect(dpi.level).toBe('warn')
    expect(dpi.detail).toContain('1')
  })

  it('warns on unknown-DPI images', () => {
    const report = validateKdp({
      profile: defaultStyleProfile(),
      pageCount: 100,
      images: [{ effectiveDpi: null }],
      warnings: []
    })
    expect(check(report, 'image-dpi').level).toBe('warn')
  })

  it('warns when LaTeX warnings are present, with counts', () => {
    const report = validateKdp({
      profile: defaultStyleProfile(),
      pageCount: 100,
      warnings: ['Overfull \\hbox ...', 'Underfull \\vbox ...']
    })
    const w = check(report, 'latex-warnings')
    expect(w.level).toBe('warn')
    expect(w.detail).toContain('2')
  })

  it('warns when fonts are not embedded', () => {
    const report = validateKdp({
      profile: defaultStyleProfile(),
      pageCount: 100,
      warnings: [],
      fontsEmbedded: false
    })
    expect(check(report, 'fonts-embedded').level).toBe('warn')
  })

  it('warns on a non-standard trim size', () => {
    const profile = mergeStyle(defaultStyleProfile(), { trimSize: '4x4' })
    const report = validateKdp({ profile, pageCount: 100, warnings: [] })
    expect(check(report, 'trim-size').level).toBe('warn')
  })

  it('surfaces the final page count prominently', () => {
    const report = validateKdp({ profile: defaultStyleProfile(), pageCount: 234, warnings: [] })
    expect(report.pageCount).toBe(234)
    const pc = check(report, 'page-count')
    expect(pc.detail).toContain('234')
  })
})
