import { describe, it, expect } from 'vitest'
import { effectiveDpi, dpiStatus } from '@core/image'

describe('effectiveDpi', () => {
  it('computes pixels / inches', () => {
    expect(effectiveDpi(1800, 6)).toBe(300)
    expect(effectiveDpi(900, 6)).toBe(150)
  })

  it('returns 0 for non-positive placed size', () => {
    expect(effectiveDpi(1800, 0)).toBe(0)
    expect(effectiveDpi(1800, -2)).toBe(0)
  })
})

describe('dpiStatus', () => {
  it('is ok at or above the target', () => {
    expect(dpiStatus(300)).toBe('ok')
    expect(dpiStatus(400)).toBe('ok')
  })

  it('warns below the target', () => {
    expect(dpiStatus(299)).toBe('warn')
    expect(dpiStatus(72)).toBe('warn')
  })

  it('honors a custom target', () => {
    expect(dpiStatus(200, 150)).toBe('ok')
    expect(dpiStatus(100, 150)).toBe('warn')
  })
})
