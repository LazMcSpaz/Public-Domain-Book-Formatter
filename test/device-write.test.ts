import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadApiKey, loadShelf, saveApiKey, saveShelf } from '@platform/browser/settings'
import { NO_DEVICE_STORE, isStorageFull } from '@platform/browser/device-write'

/**
 * Saving the shelf's settings and the API key when the device's storage is
 * full. `setItem` throws then, and a throw from a button's handler went
 * nowhere the owner could see: the token looked saved and was not. Each save
 * now answers with the reason in words, or null when it was kept.
 */

/** A `localStorage` that is full: every write throws as a browser's does. */
function fullStorage(): Storage {
  const items = new Map<string, string>()
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: () => {
      const err = new Error('The quota has been exceeded.')
      err.name = 'QuotaExceededError'
      throw err
    },
    removeItem: (k: string) => void items.delete(k),
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size
    }
  }
}

function roomyStorage(): Storage {
  const items = new Map<string, string>()
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size
    }
  }
}

const shelf = { repo: 'someone/shelf', branch: 'main', token: 'github_pat_madeup' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a save the device refuses', () => {
  it('says a full store plainly for the shelf, and never throws', () => {
    vi.stubGlobal('localStorage', fullStorage())
    let said: string | null = null
    expect(() => (said = saveShelf(shelf))).not.toThrow()
    expect(said).toMatch(/storage this browser gives the app is full.*Storage on this device/u)
  })

  it('says a full store plainly for the API key, and never throws', () => {
    vi.stubGlobal('localStorage', fullStorage())
    let said: string | null = null
    expect(() => (said = saveApiKey('sk-ant-madeup'))).not.toThrow()
    expect(said).toMatch(/is full/u)
  })

  it('says when the browser keeps nothing at all', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(saveShelf(shelf)).toBe(NO_DEVICE_STORE)
    expect(saveApiKey('sk-ant-madeup')).toBe(NO_DEVICE_STORE)
  })

  it('answers null, and keeps them, when there is room', () => {
    vi.stubGlobal('localStorage', roomyStorage())
    expect(saveShelf(shelf)).toBeNull()
    expect(saveApiKey(' sk-ant-madeup ')).toBeNull()
    expect(loadShelf()).toEqual(shelf)
    expect(loadApiKey()).toBe('sk-ant-madeup')
    // Clearing is a save too: an empty key removes it.
    expect(saveApiKey('')).toBeNull()
    expect(loadApiKey()).toBe('')
  })

  it('knows a full store by any browser’s name for it', () => {
    expect(isStorageFull({ name: 'QuotaExceededError' })).toBe(true)
    expect(isStorageFull({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true)
    expect(isStorageFull({ code: 22 })).toBe(true)
    expect(isStorageFull(new Error('something else'))).toBe(false)
  })
})
