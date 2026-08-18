/**
 * Local settings, including the user's API key.
 *
 * The key is the user's own and never leaves their browser except to go
 * straight to the API. There is no server to proxy through and nothing is
 * transmitted anywhere else. It is deliberately kept out of the project file so
 * it can never be committed or shared along with a book.
 */
import { defaultVoice, normalizeVoice, type EditorVoice } from '@core/annotate'
import { validRepo, type ShelfConfig } from '@core/sync'
import {
  emptyVocabulary,
  growVocabulary,
  normalizeVocabulary,
  type Fact,
  type TagVocabulary
} from '@core/harvest'

const KEY_STORAGE = 'pdbf.apiKey'
const PREFS_STORAGE = 'pdbf.prefs'
const VOICE_STORAGE = 'pdbf.voice'
const BANK_STORAGE = 'pdbf.bank'
/**
 * The shelf: which repository books are kept in, and the token to write there.
 *
 * Beside the API key rather than with a book, and under the same rules. A token
 * that travelled with a book file would be published the first time that book
 * was saved to a repository — which is the one way this feature could hurt
 * someone, so the credential lives here and the book files never see it.
 */
const SHELF_STORAGE = 'pdbf.shelf'
const REVIEW_PREFIX = 'pdbf.review.'
const CURSOR_PREFIX = 'pdbf.cursor.'

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

/** The shelf configuration, or empty strings when it has not been set up. */
export function loadShelf(): ShelfConfig {
  const raw = safeLocalStorage()?.getItem(SHELF_STORAGE)
  if (!raw) return { repo: '', branch: 'main', token: '' }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    const value = parsed as Partial<ShelfConfig>
    return {
      repo: typeof value.repo === 'string' ? value.repo : '',
      branch: typeof value.branch === 'string' && value.branch ? value.branch : 'main',
      token: typeof value.token === 'string' ? value.token : ''
    }
  } catch {
    return { repo: '', branch: 'main', token: '' }
  }
}

export function saveShelf(config: ShelfConfig): void {
  const store = safeLocalStorage()
  if (!store) return
  const clean: ShelfConfig = {
    repo: config.repo.trim(),
    branch: config.branch.trim() || 'main',
    token: config.token.trim()
  }
  if (!clean.repo && !clean.token) store.removeItem(SHELF_STORAGE)
  else store.setItem(SHELF_STORAGE, JSON.stringify(clean))
}

/** Whether the shelf is set up enough to talk to. */
export function shelfReady(config: ShelfConfig): boolean {
  return validRepo(config.repo) && config.token.length > 0
}

export function clearShelf(): void {
  safeLocalStorage()?.removeItem(SHELF_STORAGE)
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

/**
 * The editor's voice, banked on this device.
 *
 * Kept here beside the other local settings rather than with the saved looks,
 * because there is one editor and many books: an editor's pen name, register
 * and approved notes are the same on every title they put out, so there is
 * nothing to choose between at a gate. It is small enough that local storage is
 * the right home — the exemplars are a few hundred words at most.
 */
export function loadVoice(): EditorVoice {
  const raw = safeLocalStorage()?.getItem(VOICE_STORAGE)
  if (!raw) return defaultVoice()
  try {
    return normalizeVoice(JSON.parse(raw))
  } catch {
    return defaultVoice()
  }
}

export function saveVoice(voice: EditorVoice): void {
  safeLocalStorage()?.setItem(VOICE_STORAGE, JSON.stringify(voice))
}

export function clearVoice(): void {
  safeLocalStorage()?.removeItem(VOICE_STORAGE)
}

/**
 * The fact bank's tag vocabulary and standing interest, kept on this device.
 *
 * Only the *vocabulary* is kept, never the entries themselves. The entries are
 * downloaded as files the user owns and files away; holding a second copy here
 * would grow without bound in a browser store and make this app the custodian
 * of a library it has no way to show anyone. What has to persist is the small
 * thing that makes the next book's tags line up with the last one's.
 */
export interface BankSettings {
  vocabulary: TagVocabulary
  /** A subject the user is collecting towards, carried between books. */
  interest: string
}

export function loadBank(): BankSettings {
  const raw = safeLocalStorage()?.getItem(BANK_STORAGE)
  if (!raw) return { vocabulary: emptyVocabulary(), interest: '' }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      vocabulary: normalizeVocabulary(parsed['vocabulary']),
      interest: typeof parsed['interest'] === 'string' ? parsed['interest'] : ''
    }
  } catch {
    return { vocabulary: emptyVocabulary(), interest: '' }
  }
}

export function saveBank(bank: BankSettings): void {
  safeLocalStorage()?.setItem(BANK_STORAGE, JSON.stringify(bank))
}

/** Fold a finished harvest into the vocabulary, so the next book lines up. */
export function recordHarvest(facts: readonly Fact[], interest: string): BankSettings {
  const current = loadBank()
  const next: BankSettings = {
    vocabulary: growVocabulary(current.vocabulary, facts),
    interest
  }
  saveBank(next)
  return next
}

export function clearBank(): void {
  safeLocalStorage()?.removeItem(BANK_STORAGE)
}

/**
 * Where the user had got to in reviewing a book, keyed to the file.
 *
 * The transcription is the thing that costs money and it has always been
 * stored. This is the thing that costs *time*: three hundred pages of "looks
 * fine / read it again / leave it out" at the uncertainty gate is an hour of
 * someone's attention, and until now a refresh threw all of it away while
 * carefully preserving the pages it applied to.
 *
 * Kept out of the saved run deliberately. That record is megabytes of
 * transcription, and rewriting it on every click of a radio button would make
 * the gate stutter on a long book. These are a few kilobytes of verdicts, so
 * they go somewhere cheap to write often.
 */
export type StepAnswers = Record<string, Record<string, unknown>>

const reviewKey = (fileKey: string): string => `${REVIEW_PREFIX}${fileKey}`

export function loadReviewProgress(fileKey: string): StepAnswers {
  if (!fileKey) return {}
  const raw = safeLocalStorage()?.getItem(reviewKey(fileKey))
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: StepAnswers = {}
    for (const [step, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        out[step] = value as Record<string, unknown>
      }
    }
    return out
  } catch {
    return {}
  }
}

export function saveReviewProgress(fileKey: string, answers: StepAnswers): void {
  if (!fileKey) return
  try {
    safeLocalStorage()?.setItem(reviewKey(fileKey), JSON.stringify(answers))
  } catch {
    // A full store must never break the gate the user is standing on. The
    // transcription is safe either way, and losing the verdicts is what
    // happened before this existed.
  }
}

export function clearReviewProgress(fileKey: string): void {
  if (!fileKey) return
  safeLocalStorage()?.removeItem(reviewKey(fileKey))
  safeLocalStorage()?.removeItem(cursorKey(fileKey))
}

// ---------------------------------------------------------------------------
// Where you had got to
// ---------------------------------------------------------------------------

/**
 * Where the user had got to in a gate, and what they have already been through.
 *
 * The verdicts themselves were already kept; this is the other half of not
 * losing your work. Forty flagged leaves taken one at a time is a job you come
 * back to, and coming back to leaf one every time — with no way to see how much
 * is left — is how a review stops being finished at all.
 *
 * Beside the verdicts rather than inside them, so reading "what did I answer"
 * never has to step over a field that is not an answer.
 */
const cursorKey = (fileKey: string): string => `${CURSOR_PREFIX}${fileKey}`

export interface ReviewPlace {
  /** The group id last opened. */
  at: string | null
  /** Group ids already worked through — what the progress bar measures. */
  done: string[]
}

const EMPTY_PLACE: ReviewPlace = { at: null, done: [] }

export function loadReviewPlace(fileKey: string, stepId: string): ReviewPlace {
  if (!fileKey) return EMPTY_PLACE
  const raw = safeLocalStorage()?.getItem(cursorKey(fileKey))
  if (!raw) return EMPTY_PLACE
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_PLACE
    const entry = (parsed as Record<string, unknown>)[stepId]
    if (typeof entry !== 'object' || entry === null) return EMPTY_PLACE
    const record = entry as { at?: unknown; done?: unknown }
    return {
      at: typeof record.at === 'string' ? record.at : null,
      done: Array.isArray(record.done)
        ? record.done.filter((d): d is string => typeof d === 'string')
        : []
    }
  } catch {
    return EMPTY_PLACE
  }
}

export function saveReviewPlace(fileKey: string, stepId: string, place: ReviewPlace): void {
  if (!fileKey) return
  try {
    const raw = safeLocalStorage()?.getItem(cursorKey(fileKey))
    const all: unknown = raw ? JSON.parse(raw) : {}
    const base = typeof all === 'object' && all !== null && !Array.isArray(all) ? all : {}
    safeLocalStorage()?.setItem(
      cursorKey(fileKey),
      JSON.stringify({ ...(base as Record<string, unknown>), [stepId]: place })
    )
  } catch {
    // Losing your place is a nuisance, never a reason to break the gate you
    // are standing on.
  }
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
