/**
 * The model client's HTTP call: the browser's own `fetch`.
 *
 * `@core/transcribe` builds every request to the model API and reads every
 * reply, but never reaches the network itself (core stays pure). Whatever
 * calls it hands it this.
 *
 * A wrapper rather than `fetch` itself: `fetch` called as a method of some
 * other object (`config.transport(...)`) throws "Illegal invocation" in
 * Chrome, so it is always called here, on its own.
 *
 * Browser-only.
 */
import type { Transport } from '@core/transcribe'

export const browserTransport: Transport = (url, init) => fetch(url, init)
