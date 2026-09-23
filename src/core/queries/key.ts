/**
 * The id a query's questions are grouped under, and its crop is named by.
 *
 * Its own module, and free of value imports, for the reason `./standing.ts`
 * is: a shelf script has to be able to compute it under plain Node, and the
 * `@core/queries` chain does not load there — `gate.ts` reaches
 * `@core/transcribe`, which reaches a TypeScript parameter property that
 * Node's strip-only mode refuses.
 *
 * Why that matters more here than it looks. A crop is written to
 * `books/<dir>/queries/<key>.jpg` by a session with the paper and fetched by
 * the gate under the key it computes for itself. A second implementation of
 * this function would agree until somebody changed one, and the failure is
 * silent in the worst way: the gate asks for a file that is not there, the
 * editor sees a decision with no pixels beside it, and nothing anywhere says
 * the crop exists under another name. One function, loadable from both sides.
 *
 * Pure: no DOM, no I/O, and structurally typed so it needs no import at all.
 */
export function queryKey(query: { pageIndex: number; quote: string }): string {
  // The leaf plus a digest of the words. Not the words themselves: an id goes
  // in a DOM attribute and into `localStorage`, and a quote carries quotation
  // marks, Greek, and the odd newline.
  let hash = 0
  for (const ch of query.quote) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return `q-${query.pageIndex}-${(hash >>> 0).toString(36)}`
}
