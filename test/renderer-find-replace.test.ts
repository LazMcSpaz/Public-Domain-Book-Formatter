import { describe, expect, it } from 'vitest'
import { applyFindReplace } from '../src/renderer/utils/apply-find-replace'
import type { FindReplaceRule } from '../src/core/model/types'

function rule(partial: Partial<FindReplaceRule> & { find: string }): FindReplaceRule {
  return {
    id: partial.id ?? partial.find,
    find: partial.find,
    replace: partial.replace ?? '',
    regex: partial.regex ?? false,
    note: partial.note
  }
}

describe('applyFindReplace', () => {
  it('replaces all literal occurrences', () => {
    const out = applyFindReplace('foo foo foo', [rule({ find: 'foo', replace: 'bar' })])
    expect(out).toBe('bar bar bar')
  })

  it('treats literal find as non-regex (special chars are escaped)', () => {
    const out = applyFindReplace('a.b a.b axb', [rule({ find: 'a.b', replace: 'Z' })])
    // Only the literal "a.b" matches, not the regex "a<any>b" (which would hit axb).
    expect(out).toBe('Z Z axb')
  })

  it('keeps literal replacements literal (no $ expansion)', () => {
    const out = applyFindReplace('price', [rule({ find: 'price', replace: '$5' })])
    expect(out).toBe('$5')
  })

  it('applies regex rules with the global flag', () => {
    const out = applyFindReplace('cat cot cut', [rule({ find: 'c.t', replace: 'X', regex: true })])
    expect(out).toBe('X X X')
  })

  it('supports regex capture-group replacements', () => {
    const out = applyFindReplace('2020-01', [
      rule({ find: '(\\d+)-(\\d+)', replace: '$2/$1', regex: true })
    ])
    expect(out).toBe('01/2020')
  })

  it('applies rules in order, each over the previous result', () => {
    const out = applyFindReplace('a', [
      rule({ find: 'a', replace: 'b' }),
      rule({ find: 'b', replace: 'c' })
    ])
    expect(out).toBe('c')
  })

  it('skips invalid regex rules without throwing', () => {
    const out = applyFindReplace('hello (world)', [
      rule({ find: '(', replace: 'X', regex: true }), // invalid — unbalanced
      rule({ find: 'world', replace: 'there' })
    ])
    expect(out).toBe('hello (there)')
  })

  it('skips rules with an empty find', () => {
    const out = applyFindReplace('unchanged', [rule({ find: '', replace: 'X' })])
    expect(out).toBe('unchanged')
  })

  it('returns the input unchanged with no rules', () => {
    expect(applyFindReplace('text', [])).toBe('text')
  })
})
