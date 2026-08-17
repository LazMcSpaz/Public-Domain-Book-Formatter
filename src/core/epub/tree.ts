/**
 * The shape an EPUB's markup arrives in, and nothing more.
 *
 * Core cannot use `DOMParser` — parsing XML is a platform capability, and the
 * rule that keeps this flow testable is that no browser API appears here. But
 * *deciding what a `<blockquote>` becomes* is domain logic and belongs nowhere
 * else. So the platform hands over this minimal tree and everything
 * interesting happens on it, with no browser in sight.
 *
 * Deliberately smaller than a DOM node: a name, attributes, children. No
 * parent pointers, no namespaces resolved, no live collections — anything a
 * mapping rule needs to know has to be reachable by walking down.
 */

export interface EpubElement {
  kind: 'element'
  /** Lower-cased local name: `p`, `h2`, `blockquote`. Namespaces are dropped. */
  name: string
  /** Lower-cased attribute names; `epub:type` keeps its prefix, as it is used. */
  attrs: Record<string, string>
  children: EpubNode[]
}

export interface EpubText {
  kind: 'text'
  text: string
}

export type EpubNode = EpubElement | EpubText

export const element = (
  name: string,
  attrs: Record<string, string> = {},
  children: EpubNode[] = []
): EpubElement => ({ kind: 'element', name, attrs, children })

export const text = (value: string): EpubText => ({ kind: 'text', text: value })

/** Every element in the tree, depth first, including the roots given. */
export function* walk(nodes: readonly EpubNode[]): Generator<EpubElement> {
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    yield node
    yield* walk(node.children)
  }
}

/** The first element anywhere below these nodes that `match` accepts. */
export function find(
  nodes: readonly EpubNode[],
  match: (el: EpubElement) => boolean
): EpubElement | null {
  for (const el of walk(nodes)) if (match(el)) return el
  return null
}

/** Every element anywhere below these nodes that `match` accepts. */
export function findAll(
  nodes: readonly EpubNode[],
  match: (el: EpubElement) => boolean
): EpubElement[] {
  return [...walk(nodes)].filter(match)
}

/** All the text under a node, with whitespace collapsed the way HTML collapses it. */
export function textOf(node: EpubNode | readonly EpubNode[]): string {
  const nodes = Array.isArray(node) ? node : [node as EpubNode]
  let out = ''
  const visit = (list: readonly EpubNode[]): void => {
    for (const n of list) {
      if (n.kind === 'text') out += n.text
      else visit(n.children)
    }
  }
  visit(nodes)
  return collapse(out)
}

/** HTML whitespace rules: any run of it is one space, and the ends are trimmed. */
export function collapse(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}
