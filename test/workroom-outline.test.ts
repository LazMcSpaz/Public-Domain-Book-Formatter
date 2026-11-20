import { describe, expect, it } from 'vitest'
import { jsonOutline, type OutlineNode } from '@core/work'

/**
 * A JSON file in the Workroom's reading view (`src/core/work/outline.ts`):
 * drawn up to a set number of values, then one count of the rest. The view
 * once went on drawing a numbered line for every list item after the count
 * was spent, each empty: a 5,000-item list showed 2,000 empty rows.
 */

/** Every value the outline draws, itself included. */
function drawn(node: OutlineNode | null): number {
  if (!node) return 0
  if (node.kind === 'list') return 1 + node.items.reduce((n, i) => n + drawn(i), 0)
  if (node.kind === 'fields') return 1 + node.fields.reduce((n, f) => n + drawn(f.value), 0)
  return 1
}

/** Whether any list or set of names drawn is empty although the file's is not. */
function emptyRows(node: OutlineNode | null, value: unknown): boolean {
  if (!node) return false
  if (node.kind === 'list') {
    const items = value as unknown[]
    return (
      (node.items.length === 0 && items.length > 0) ||
      node.items.some((item, i) => emptyRows(item, items[i]))
    )
  }
  if (node.kind === 'fields') {
    const fields = value as Record<string, unknown>
    return (
      (node.fields.length === 0 && Object.keys(fields).length > 0) ||
      node.fields.some((f) => emptyRows(f.value, fields[f.name]))
    )
  }
  return false
}

describe('a JSON file’s outline', () => {
  it('draws a small file whole, in its own words', () => {
    const outline = jsonOutline({ pages: 148, complete: true, title: 'The Seven Doors' }, 3000)
    expect(outline.hidden).toBe(0)
    expect(outline.root).toEqual({
      kind: 'fields',
      fields: [
        { name: 'pages', value: { kind: 'plain', text: '148' } },
        { name: 'complete', value: { kind: 'plain', text: 'yes' } },
        { name: 'title', value: { kind: 'text', text: 'The Seven Doors' } }
      ]
    })
  })

  it('stops drawing a long list when the count is spent, and counts the rest once', () => {
    const leaves = Array.from({ length: 5000 }, (_, i) => i + 1)
    const outline = jsonOutline(leaves, 3000)
    const root = outline.root as Extract<OutlineNode, { kind: 'list' }>
    // The list is one value, so 2,999 of its items fit.
    expect(root.items).toHaveLength(2999)
    expect(root.items.every((item) => item.kind === 'plain')).toBe(true)
    expect(outline.hidden).toBe(2001)
    expect(drawn(outline.root) + outline.hidden).toBe(5001)
  })

  it('draws no empty row for a name or a list it has no room for', () => {
    const file = { a: [1, 2, 3], b: { c: 'x' }, d: 'last' }
    const outline = jsonOutline(file, 3)
    expect(outline.root).toEqual({
      kind: 'fields',
      fields: [{ name: 'a', value: { kind: 'list', items: [{ kind: 'plain', text: '1' }] } }]
    })
    // 2 and 3, then b and the c inside it, then d.
    expect(outline.hidden).toBe(5)
  })

  it('never draws an empty list or set of names that is not empty in the file', () => {
    const file = {
      books: Array.from({ length: 400 }, (_, i) => ({
        name: `Book ${i}`,
        leaves: [[1, 2], [3]],
        notes: {}
      }))
    }
    let total = 0
    for (const most of [1, 2, 3, 4, 5, 7, 10, 50, 999, 3000]) {
      const outline = jsonOutline(file, most)
      expect(emptyRows(outline.root, file)).toBe(false)
      expect(drawn(outline.root)).toBeLessThanOrEqual(most)
      total ||= drawn(outline.root) + outline.hidden
      expect(drawn(outline.root) + outline.hidden).toBe(total)
    }
    // An empty one is drawn as empty.
    expect(jsonOutline({ notes: {}, list: [] }, 10).root).toEqual({
      kind: 'fields',
      fields: [
        { name: 'notes', value: { kind: 'fields', fields: [] } },
        { name: 'list', value: { kind: 'list', items: [] } }
      ]
    })
  })
})
