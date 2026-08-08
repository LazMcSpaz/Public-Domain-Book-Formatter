/**
 * Local settings, including the user's API key.
 *
 * The key is the user's own and never leaves their browser except to go
 * straight to the API. There is no server to proxy through and nothing is
 * transmitted anywhere else. It is deliberately kept out of the project file so
 * it can never be committed or shared along with a book.
 */

const KEY_STORAGE = 'pdbf.apiKey'
const PREFS_STORAGE = 'pdbf.prefs'

export interface AppPrefs {
  modelId: string
  /** Long edge in px for the image sent to the model — the main cost lever. */
  imageLongEdge: number
  /**
   * Whether to keep the scan itself on this device, so a book reopens without
   * the file picker.
   *
   * A property of the *device*, not of the book — which is why it lives here
   * rather than with the run. The same person wants opposite answers on a
   * laptop with a spare terabyte and on a phone that is always three photos
   * from full, and they should not have to say so twice.
   *
   * `null` means unasked. It is asked once, with the size measured and the free
   * space alongside it, and can be changed afterwards.
   *
   * This never covers the transcription. That is the one thing in the app the
   * user paid for and cannot regenerate, it is a megabyte or two against the
   * scan's hundred, and making it optional would offer someone the chance to
   * lose the only irreplaceable thing here to save nothing worth saving.
   */
  keepScans: boolean | null
}

export const DEFAULT_PREFS: AppPrefs = {
  modelId: 'claude-opus-5',
  imageLongEdge: 1568,
  keepScans: null
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Storage can throw in private-browsing modes; degrade rather than crash.
    return null
  }
}

export function loadApiKey(): string {
  return safeLocalStorage()?.getItem(KEY_STORAGE) ?? ''
}

export function saveApiKey(key: string): void {
  const store = safeLocalStorage()
  if (!store) return
  if (key.trim()) store.setItem(KEY_STORAGE, key.trim())
  else store.removeItem(KEY_STORAGE)
}

export function clearApiKey(): void {
  safeLocalStorage()?.removeItem(KEY_STORAGE)
}

/** Show only the last few characters, so the UI can confirm *which* key without exposing it. */
export function maskApiKey(key: string): string {
  if (!key) return ''
  return key.length <= 8 ? '••••' : `••••••••${key.slice(-4)}`
}

export function loadPrefs(): AppPrefs {
  const raw = safeLocalStorage()?.getItem(PREFS_STORAGE)
  if (!raw) return { ...DEFAULT_PREFS }
  try {
    const parsed = JSON.parse(raw) as Partial<AppPrefs>
    return {
      modelId: typeof parsed.modelId === 'string' ? parsed.modelId : DEFAULT_PREFS.modelId,
      imageLongEdge:
        typeof parsed.imageLongEdge === 'number'
          ? parsed.imageLongEdge
          : DEFAULT_PREFS.imageLongEdge,
      keepScans: typeof parsed.keepScans === 'boolean' ? parsed.keepScans : null
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(prefs: AppPrefs): void {
  safeLocalStorage()?.setItem(PREFS_STORAGE, JSON.stringify(prefs))
}

/** Bytes, rounded to something a person reads rather than parses. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/**
 * What this browser will let the app keep, and what it is already using.
 *
 * Measured rather than guessed, because the honest answer differs by an order
 * of magnitude between a desktop and a phone and the user should be deciding
 * against their own numbers. Returns null where the browser will not say, in
 * which case the question is asked without the figures rather than with
 * invented ones.
 */
export async function storageEstimate(): Promise<{ quota: number; usage: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
    const { quota, usage } = await navigator.storage.estimate()
    if (typeof quota !== 'number' || typeof usage !== 'number') return null
    return { quota, usage }
  } catch {
    return null
  }
}
