import { describe, it, expect, beforeEach } from 'vitest'
import {
  setHoverToken,
  getHoverToken,
  subscribeHover,
  registerJump,
  jumpToToken
} from '../src/renderer/highlight'

// The DOM class-toggling side of highlight.ts is a no-op under the `node` test
// environment (it guards on `typeof document`), so these tests exercise the
// observable + jump-registry logic that the panes and popover rely on.

beforeEach(() => {
  setHoverToken(null)
  registerJump(null)
})

describe('hover observable', () => {
  it('tracks the current hover token', () => {
    expect(getHoverToken()).toBeNull()
    setHoverToken('a')
    expect(getHoverToken()).toBe('a')
    setHoverToken(null)
    expect(getHoverToken()).toBeNull()
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const seen: (string | null)[] = []
    const unsub = subscribeHover((id) => seen.push(id))
    setHoverToken('a')
    setHoverToken('b')
    unsub()
    setHoverToken('c')
    expect(seen).toEqual(['a', 'b'])
  })

  it('does not re-notify when the token is unchanged', () => {
    const seen: (string | null)[] = []
    subscribeHover((id) => seen.push(id))
    setHoverToken('a')
    setHoverToken('a')
    expect(seen).toEqual(['a'])
  })
})

describe('jump registry', () => {
  it('routes jumpToToken through the registered scroll fn', () => {
    const jumps: string[] = []
    registerJump((id) => jumps.push(id))
    jumpToToken('x')
    expect(jumps).toEqual(['x'])
  })

  it('is a no-op scroll when nothing is registered (still safe)', () => {
    expect(() => jumpToToken('x')).not.toThrow()
  })
})
