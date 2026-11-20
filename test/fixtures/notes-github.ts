/**
 * A stand-in for GitHub as far as the Workroom's reader needs it (the trees
 * listing of `work/runs`, notes by blob sha, the repository, the branch), for
 * `test/shelf-notes.test.ts` and `test/workroom-device-notes.test.ts`. No
 * request leaves the machine; the books and jobs are made up.
 */
import { createHash } from 'node:crypto'
import { serializeStatusNote, startNote, type StatusNote } from '@core/work'
import { statusNotePath, type ShelfConfig } from '@core/sync'

export const config: ShelfConfig = { repo: 'someone/shelf', branch: 'main', token: 't' }
export const API = 'https://api.github.com/repos/someone/shelf'

/** Git's blob sha of a text, as GitHub lists it. */
export const sha = (text: string): string =>
  createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(text)}\0`), Buffer.from(text)]))
    .digest('hex')

export function note(id: string, book: string | null, job = 'Read the first batch'): StatusNote {
  return startNote({
    id,
    role: 'reader',
    book,
    stage: book ? 'reading' : null,
    job,
    now: '2026-10-02T09:00:00Z'
  })
}

/** A shelf: note files by path from the shelf's top. */
export type Shelf = Map<string, string>
export const shelfOf = (...notes: StatusNote[]): Shelf =>
  new Map(notes.map((n) => [statusNotePath(n), serializeStatusNote(n)]))

export interface Seen {
  url: string
  cache: RequestCache | undefined
  accept: string
}

/** GitHub as far as the reader needs it; `extra` answers anything else first. */
export function stubGitHub(shelf: () => Shelf, extra?: (url: URL) => Response | null): Seen[] {
  const seen: Seen[] = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const accept = String((init?.headers as Record<string, string>)?.['Accept'] ?? '')
    seen.push({ url: String(input), cache: init?.cache, accept })
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      })
    const answer = extra?.(url)
    if (answer) return Promise.resolve(answer)
    const files = shelf()
    if (url.pathname.startsWith('/repos/someone/shelf/git/trees/main:work/runs')) {
      if (files.size === 0) return Promise.resolve(json(404, { message: 'Not Found' }))
      const tree = [...files].map(([path, text]) => ({
        path: path.replace(/^work\/runs\//u, ''),
        type: 'blob',
        sha: sha(text)
      }))
      const months = [...new Set(tree.map((e) => e.path.split('/')[0]!))]
      const dirs = months.map((m) => ({ path: m, type: 'tree', sha: `tree-${m}` }))
      return Promise.resolve(
        json(200, { sha: 'runs-tree', truncated: false, tree: [...dirs, ...tree] })
      )
    }
    const blob = /\/git\/blobs\/([0-9a-f]+)$/u.exec(url.pathname)
    if (blob) {
      const text = [...files.values()].find((t) => sha(t) === blob[1])
      return Promise.resolve(text === undefined ? json(404, {}) : new Response(text))
    }
    if (url.pathname === '/repos/someone/shelf/git/ref/heads/main') {
      return Promise.resolve(json(200, { ref: 'refs/heads/main' }))
    }
    if (url.pathname === '/repos/someone/shelf') {
      return Promise.resolve(
        json(200, { full_name: 'someone/shelf', default_branch: 'main', private: true })
      )
    }
    return Promise.resolve(json(404, { message: 'Not Found' }))
  }) as typeof fetch
  return seen
}

export const blobsIn = (seen: Seen[]): Seen[] => seen.filter((s) => s.url.includes('/git/blobs/'))
