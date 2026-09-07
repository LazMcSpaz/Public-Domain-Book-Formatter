/**
 * Being an installed app: the service worker, and storage that survives.
 *
 * Both exist for one reason, and it is worth stating plainly because neither
 * looks important from a desktop. The reading pass is done on a tablet, the
 * shelf is the only durable home for what it produces, and between the mark
 * being made and the shelf accepting it the record lives in this browser's
 * storage. Safari clears script-writable storage for a site that has not been
 * visited for a stretch — installed web apps being exempt — so an uninstalled
 * tab holding a fortnight of unpushed reading is a fortnight of reading with a
 * deletion timer on it.
 *
 * Neither call is load-bearing on its own and neither is allowed to break the
 * app: a refused worker costs offline, a refused persistence grant costs a
 * guarantee, and both are *reported* rather than assumed, because the whole
 * point is to know which of the two situations you are in.
 */

/** What the device has agreed to. Reported, never assumed. */
export interface InstallState {
  /** The worker is registered and this page is controlled by it. */
  offlineReady: boolean
  /**
   * The browser has promised not to evict this origin's storage without asking.
   *
   * Null when the browser does not implement the API at all, which is a
   * different thing from having said no and must not be shown as one.
   */
  storagePersisted: boolean | null
  /** Running from a Home Screen icon rather than in a browser tab. */
  installed: boolean
}

/** Whether this is running as an installed app rather than in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false
  // The standard signal, and iOS's own, which predates it and is still what
  // Safari sets for a Home Screen app.
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true
  return standalone || iosStandalone
}

/**
 * Ask the browser to keep this origin's storage.
 *
 * Granted without a prompt where the site is installed or well used, refused
 * silently otherwise — so this is a request, and its answer is a fact about the
 * device that the interface has to be able to state. Never throws: a browser
 * without the API returns null and the app carries on unprotected, which is
 * exactly what it did before this existed.
 */
export async function askForPersistentStorage(): Promise<boolean | null> {
  const storage = navigator.storage as StorageManager | undefined
  if (!storage?.persist || !storage.persisted) return null
  try {
    if (await storage.persisted()) return true
    return await storage.persist()
  } catch {
    return null
  }
}

/**
 * Register the service worker, if this build has one to register.
 *
 * Skipped in development: a worker caching a dev server's modules is how an
 * edit stops appearing on the page, and this repository has already lost time
 * to exactly that class of fault with Vite's own watcher and Chromium's HTTP
 * cache.
 */
export async function registerWorker(): Promise<boolean> {
  if (import.meta.env.DEV) return false
  if (!('serviceWorker' in navigator)) return false
  try {
    // Resolved against the app's base, because the app is served from a
    // sub-path on Pages and an absolute `/sw.js` is a 404 there — which would
    // fail silently, leaving an app that simply never works offline.
    const url = new URL('sw.js', new URL(import.meta.env.BASE_URL, window.location.href))
    await navigator.serviceWorker.register(url, {
      scope: new URL(import.meta.env.BASE_URL, window.location.href).pathname
    })
    return true
  } catch {
    return false
  }
}

/** Do both, once, at start-up, and report what the device agreed to. */
export async function prepareInstall(): Promise<InstallState> {
  const [offlineReady, storagePersisted] = await Promise.all([
    registerWorker(),
    askForPersistentStorage()
  ])
  return { offlineReady, storagePersisted, installed: isInstalled() }
}
