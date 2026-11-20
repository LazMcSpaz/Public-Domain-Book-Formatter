/**
 * A JSON file as the Workroom's reading view shows it: an outline of names
 * and values, cut off after a set number of values so a huge file cannot
 * freeze the tablet, with one count of everything left out.
 *
 * Once the count is spent nothing more is drawn: no empty row for a name, no
 * empty numbered line for a list item. A list or a set of names is drawn only
 * when at least one thing in it is, so a drawn one with nothing in it is one
 * that is empty in the file.
 *
 * Pure: a parsed value in, the outline out.
 */

export type OutlineNode =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  /** A number, or yes and no. */
  | { kind: 'plain'; text: string }
  | { kind: 'list'; items: OutlineNode[] }
  | { kind: 'fields'; fields: { name: string; value: OutlineNode }[] }

export interface Outline {
  /** Null only when nothing at all could be drawn. */
  root: OutlineNode | null
  /** How many values the file holds that are not drawn. */
  hidden: number
}

/** The outline of `value`, drawing at most `most` values. */
export function jsonOutline(value: unknown, most: number): Outline {
  const budget = { left: most, hidden: 0 }
  const root = node(value, budget)
  return { root, hidden: budget.hidden }
}

interface Budget {
  left: number
  hidden: number
}

function node(value: unknown, budget: Budget): OutlineNode | null {
  if (budget.left <= 0) {
    budget.hidden += countValues(value)
    return null
  }
  budget.left--
  const children = childrenOf(value)
  if (value === null || value === undefined) return { kind: 'none' }
  if (typeof value === 'string') return { kind: 'text', text: value }
  if (typeof value === 'boolean') return { kind: 'plain', text: value ? 'yes' : 'no' }
  if (typeof value === 'number') return { kind: 'plain', text: String(value) }
  if (!children) return { kind: 'text', text: String(value) }
  const drawn: { name: string; value: OutlineNode }[] = []
  let i = 0
  while (i < children.length && budget.left > 0) {
    const [name, child] = children[i++]!
    const shown = node(child, budget)
    // One left out (and counted) ends the level, so a list's numbers stay true.
    if (!shown) break
    drawn.push({ name, value: shown })
  }
  for (; i < children.length; i++) budget.hidden += countValues(children[i]![1])
  // Not one thing in it fitted: leave it out too, rather than draw it empty.
  if (drawn.length === 0 && children.length > 0) {
    budget.hidden++
    return null
  }
  return Array.isArray(value)
    ? { kind: 'list', items: drawn.map((d) => d.value) }
    : { kind: 'fields', fields: drawn }
}

/** A list's items or an object's fields, named; null for anything else. */
function childrenOf(value: unknown): [string, unknown][] | null {
  if (Array.isArray(value)) return value.map((v, i) => [String(i), v])
  if (typeof value === 'object' && value !== null) return Object.entries(value)
  return null
}

/** How many values `value` holds, itself included; without recursion, for a deep file. */
function countValues(value: unknown): number {
  let n = 0
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const v = stack.pop()
    n++
    if (Array.isArray(v)) for (const x of v) stack.push(x)
    else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) stack.push(x)
  }
  return n
}
