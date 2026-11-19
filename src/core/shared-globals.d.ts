/**
 * The only globals `src/core/` may use.
 *
 * `npm run typecheck:core` (`tsconfig.core.json`) checks the core on its own,
 * with no browser (DOM) and no Node types, so `window`, `document`, `fetch`,
 * `process` or a `node:` import inside it fails to compile. These few are the
 * exception: built into browsers and Node alike, and touching neither the
 * screen, files nor the network. Each is declared with only the parts the core
 * uses; a new use that needs more fails the check until it is added here.
 *
 * Add a global only if it works the same in both and touches none of those.
 * Never add a DOM, file or network API: that code belongs in `src/platform/`.
 *
 * Read by `tsconfig.core.json` only. The main `tsconfig.json` excludes it,
 * because its full DOM and Node types declare these already and would clash.
 */

/** Stopping a long model run part-way. */
interface AbortSignal {
  readonly aborted: boolean
}

/** The pause between model retries. */
declare function setTimeout(handler: () => void, timeout?: number): unknown

/** A deep copy of plain data. */
declare function structuredClone<T>(value: T): T

/** UTF-8 bytes to text (the file names inside an EPUB). */
declare class TextDecoder {
  decode(input?: Uint8Array): string
}

/** The `#book=…&at=…` part of a deep link. */
declare class URLSearchParams {
  constructor(init?: string | Record<string, string>)
  get(name: string): string | null
  set(name: string, value: string): void
  toString(): string
}
