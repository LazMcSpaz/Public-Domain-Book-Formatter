/**
 * Keeping the screen on while a long job runs.
 *
 * Reading a three-hundred-page scan is ten minutes of work the page has to stay
 * alive for. A phone dims and locks after thirty seconds of no touching, and
 * once the screen is off the browser suspends the tab — so the usual way this
 * goes is that someone sets a book reading, puts the phone down, and comes back
 * to a progress bar that stopped at page nine.
 *
 * ## What this can and cannot do
 *
 * It can stop the screen turning itself off. That is the whole of it, and it is
 * the case that actually bites.
 *
 * It cannot keep the work going with the screen *off* or the tab in the
 * background. Nothing in a browser can: the lock is only held while the page is
 * visible and the platform releases it the moment it is not. Web Workers do not
 * escape this — a worker owned by a frozen page freezes with it — and a service
 * worker is killed after seconds of idle, so neither is a way round it. The
 * honest mitigation for a tab that gets frozen is a checkpoint, which is why
 * recon has one.
 *
 * ## Why re-acquiring matters
 *
 * The platform releases the lock whenever the page is hidden, and does not give
 * it back when the page returns. Without the `visibilitychange` handler,
 * glancing at another app once would silently undo it for the rest of the run —
 * which is worse than never having asked, because the progress bar looks the
 * same either way.
 *
 * Every failure is silent by design: an unsupported browser, a refused request
 * or a machine on battery saver all mean the screen may sleep, which is what
 * happened before this existed.
 *
 * Browser-only.
 */

/** Release the lock and stop trying to hold it. Safe to call twice. */
export type ReleaseWakeLock = () => void

interface SentinelLike {
  release: () => Promise<void>
  released: boolean
}

interface WakeLockLike {
  request: (type: 'screen') => Promise<SentinelLike>
}

function api(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null
  const lock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
  return lock ?? null
}

/** Whether this browser offers it at all — for saying so rather than implying it. */
export function canKeepAwake(): boolean {
  return api() !== null
}

/**
 * Hold the screen awake until the returned function is called.
 *
 * Resolves immediately; acquiring happens in the background, so a caller never
 * waits on a permission decision before starting the work it came to do.
 */
export function keepAwake(): ReleaseWakeLock {
  const lock = api()
  if (!lock) return () => {}

  let sentinel: SentinelLike | null = null
  let done = false

  const acquire = (): void => {
    if (done || document.visibilityState !== 'visible') return
    void lock
      .request('screen')
      .then((got) => {
        // Released while the request was in flight: let it go rather than
        // leaving a lock nobody can reach.
        if (done) return void got.release().catch(() => {})
        sentinel = got
      })
      .catch(() => {
        // Refused, or the document lost visibility mid-request. The screen may
        // sleep; that is the status quo this improves on, not a failure state.
      })
  }

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') acquire()
  }

  document.addEventListener('visibilitychange', onVisible)
  acquire()

  return () => {
    if (done) return
    done = true
    document.removeEventListener('visibilitychange', onVisible)
    void sentinel?.release().catch(() => {})
    sentinel = null
  }
}
