import { describe, it, expect, afterEach } from 'vitest'
import {
  attempt,
  blobSha,
  describeFailure,
  secondsInWords,
  sizeInWords,
  ShelfStepError,
  type ShelfFailure
} from '@platform/browser/shelf-attempt'
import { ShelfError } from '@platform/browser/shelf'
import { reach } from '@platform/browser/shelf-fetch'

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
})

/**
 * A failed shelf request named, sized and timed (see `shelf-attempt.ts`).
 * The flush that uses it is tested end to end in `outbox-flush.test.ts`.
 */
describe('a shelf request that fails', () => {
  it('is “no answer” for fetch’s network error, in every browser’s words', async () => {
    let now = 1000
    const clock = (): number => now
    for (const said of [
      'Load failed',
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.'
    ]) {
      // `fetch` itself rejects, as it does in every browser for a request that
      // got nothing back.
      globalThis.fetch = (async () => {
        now += 400
        throw new TypeError(said)
      }) as typeof fetch
      const failing = attempt(
        'writing the book file',
        3_031_000,
        () => reach('https://api.github.com/x'),
        clock
      )
      await expect(failing).rejects.toBeInstanceOf(ShelfStepError)
      const failure = (await failing.catch((e: ShelfStepError) => e.failure)) as ShelfFailure
      expect(failure).toMatchObject({ kind: 'no-answer', ms: 400, status: null, said })
      expect(describeFailure(failure)).toBe(
        `Writing the book file (3.0 MB) got no answer: the browser gave up after 0.4 seconds and said “${said}”.`
      )
    }
  })

  it('is “refused” when GitHub answered and said no', async () => {
    const failure = await attempt('asking the shelf for the book’s version', null, async () => {
      throw new ShelfError('That token was rejected by GitHub.', 401)
    }).catch((e: ShelfStepError) => e.failure)
    expect(failure).toMatchObject({ kind: 'refused', status: 401 })
    expect(describeFailure(failure)).toBe(
      'Asking the shelf for the book’s version was refused. That token was rejected by GitHub.'
    )
  })

  it('is never “no answer” for a slip in our own code, though that is a TypeError too', async () => {
    const failure = (await attempt('reading the book from the shelf', null, async () => {
      const answer = (await Promise.resolve(undefined)) as unknown as { text: () => string }
      return answer.text()
    }).catch((e: ShelfStepError) => e.failure)) as ShelfFailure
    expect(failure).toMatchObject({ kind: 'failed', status: null })
    expect(describeFailure(failure)).toMatch(/^Reading the book from the shelf failed after/)
    expect(describeFailure(failure)).not.toContain('got no answer')
  })

  it('passes a success straight through', async () => {
    expect(await attempt('reading', null, async () => 'ok')).toBe('ok')
  })
})

describe('sizes and waits in words', () => {
  it('reads as the editor would say them', () => {
    expect(sizeInWords(640)).toBe('640 bytes')
    expect(sizeInWords(12_400)).toBe('12 KB')
    expect(sizeInWords(3_031_000)).toBe('3.0 MB')
    expect(secondsInWords(400)).toBe('0.4 seconds')
    expect(secondsInWords(61_200)).toBe('61 seconds')
  })
})

describe('the name git gives a file', () => {
  it('is the sha the contents API reports for it', async () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(await blobSha(new TextEncoder().encode('hello\n'))).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a'
    )
  })
})
