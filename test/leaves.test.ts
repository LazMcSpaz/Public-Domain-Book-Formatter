import { describe, expect, it } from 'vitest'
import { checkLeafRange } from '@core/project/leaves'

describe('checkLeafRange', () => {
  it('accepts every leaf a book has, counting from zero', () => {
    expect(checkLeafRange([0, 1, 60, 719], 720).message).toBe('')
  })

  it('refuses the leaf one past the end, which is the fault this exists for', () => {
    // Asking for 1..N on an N-leaf book is the mistake: it silently returns
    // the second page onward and loses the first. The last number is the one
    // that does not exist, and saying so is what makes the shift visible.
    const problem = checkLeafRange([1, 2, 3, 720], 720)
    expect(problem.outside).toEqual([720])
    expect(problem.message).toContain('leaf 720 is outside this book')
    expect(problem.message).toContain('720 leaves numbered 0 to 719')
    expect(problem.message).toContain('count from zero')
  })

  it('refuses a negative leaf', () => {
    expect(checkLeafRange([-1, 0], 10).outside).toEqual([-1])
  })

  it('names everything outside, not just the first', () => {
    expect(checkLeafRange([5, 99, 6, 100], 10).outside).toEqual([99, 100])
  })

  it('reports what was not a number at all', () => {
    const problem = checkLeafRange(['fresh', '3', 'x'], 10)
    expect(problem.notNumbers).toEqual(['fresh', 'x'])
    expect(problem.message).toContain('not leaf numbers: fresh, x')
  })

  it('refuses nothing when the page count is unknown', () => {
    // A caller that cannot say how long the book is gets no guard rather
    // than having every leaf refused, which would be worse than the fault.
    expect(checkLeafRange([0, 5000], 0).message).toBe('')
  })
})
