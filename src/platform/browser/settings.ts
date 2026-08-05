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
  bookContext: string
}

export const DEFAULT_PREFS: AppPrefs = {
  modelId: 'claude-opus-5',
  imageLongEdge: 1568,
  bookContext: ''
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
      bookContext: typeof parsed.bookContext === 'string' ? parsed.bookContext : ''
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(prefs: AppPrefs): void {
  safeLocalStorage()?.setItem(PREFS_STORAGE, JSON.stringify(prefs))
}
