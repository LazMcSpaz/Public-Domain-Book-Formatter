/**
 * Writing one setting to the device's `localStorage`, with a refusal said
 * plainly instead of thrown.
 *
 * A full store throws on `setItem` (`QuotaExceededError`). Thrown from a
 * button's handler it went nowhere the owner could see: the token he had just
 * typed looked saved and was not. So the save answers with the problem in
 * words, or null when the setting was kept, and the screen shows it.
 *
 * Browser-only.
 */

/** Said when the browser lets the app keep nothing at all. */
export const NO_DEVICE_STORE =
  'This browser is not letting the app keep anything on this device (private browsing can do ' +
  'this), so it was not saved.'

/** Keep `value` under `key`, or remove it when null; the problem in words, or null when done. */
export function keepSetting(
  store: Storage | null,
  key: string,
  value: string | null
): string | null {
  if (!store) return NO_DEVICE_STORE
  try {
    if (value === null) store.removeItem(key)
    else store.setItem(key, value)
    return null
  } catch (err) {
    if (isStorageFull(err)) {
      return (
        'The storage this browser gives the app is full, so it was not saved. Free some room ' +
        'in Settings, under Storage on this device, and try again.'
      )
    }
    const said = err instanceof Error ? err.message : String(err)
    return `This browser would not save it (it said “${said}”).`
  }
}

/** Whether a refused write was the store being full, in any browser's words for it. */
export function isStorageFull(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { name?: unknown; code?: unknown }
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  )
}
