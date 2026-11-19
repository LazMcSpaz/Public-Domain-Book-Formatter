import { describe, it, expect } from 'vitest'
import {
  attempt,
  blobSha,
  describeFailure,
  secondsInWords,
  sizeInWords,
  ShelfStepError
} from '@platform/browser/shelf-attempt'
import { ShelfError } from '@platform/browser/shelf'

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
      const failing = attempt(
        'writing the book file',
        3_031_000,
        async () => {
          now += 400
          throw new TypeError(said)
        },
        clock
      )
      await expect(failing).rejects.toBeInstanceOf(ShelfStepError)
      const failure = await failing.catch((e: ShelfStepError) => e.failure)
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
