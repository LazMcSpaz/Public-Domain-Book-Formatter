/**
 * A made-up shelf of status notes for the Workroom's browser check
 * (`scripts/check-workroom.mjs`), and a stand-in for the GitHub requests the
 * screen makes. Every book here is invented; no shelf is read.
 *
 * The notes are written with core's own changes (`src/core/work/changes.ts`),
 * so each is one the strict parser accepts, at times counted back from now:
 * one waiting for forty days (an old month, which must still be read), a run
 * stale for fifteen hours, tools work with no book, a hand-off nobody has
 * picked up, and one file that is not a note at all.
 */
import { register } from 'node:module'
import { blobSha } from './blob-sha.mjs'

register('../resolve-ts.mjs', import.meta.url)
const work = await import('../../src/core/work/index.ts')
const paths = await import('../../src/core/sync/work-paths.ts')

export const BOOKS = {
  lantern: 'Nobody-TheLanternOfDust-abc123',
  keeper: 'Someone-TheKeepersNotebook-xyz789',
  doors: 'Anon-TheSevenDoors-q1w2e3',
  bell: 'Unknown-TheBellAndTheRope-z9y8x7',
  stair: 'Nemo-TheQuietStair-k5k5k5'
}
export const BAD_NOTE = 'work/runs/2026-01/2026-01-05-no-book-builder-badnote1.json'

/** Every note of the made-up shelf, by path, with the ids the check looks for. */
export function madeUpNotes(nowMs = Date.now()) {
  const ago = (hours) => new Date(nowMs - hours * 3600_000).toISOString().replace(/\.\d+Z$/u, 'Z')
  const start = (id, role, book, stage, job, hours, from = null) =>
    work.startNote({ id, role, book, stage, job, now: ago(hours), from })
  const sheet = (book, name) => `books/${book}/${name}`
  const { lantern, keeper, doors, bell, stair } = BOOKS

  const notes = [
    work.noteDone(start('reader01', 'reader', lantern, 'reading', 'Read the whole book', 80), {
      now: ago(74),
      result: 'Read 214 of 214 leaves'
    }),
    work.noteAsk(
      work.noteProgress(
        start('checkr01', 'checker', lantern, 'checking', 'Check the text', 9, 'reader01'),
        { now: ago(7), note: 'Text checks run', progress: { done: 9, total: 12, unit: 'checks' } }
      ),
      {
        now: ago(5),
        what: 'Rule the four questions in chapter two',
        links: [
          { label: 'Questions sheet', path: sheet(lantern, 'queries.md') },
          { label: 'Readiness report', path: sheet(lantern, 'readiness.md') }
        ]
      }
    ),
    work.noteProgress(start('etsuwr01', 'etsu', lantern, 'writing', 'Write the introduction', 6), {
      now: ago(0.3),
      progress: { done: 3, total: 7, unit: 'sections' }
    }),
    work.noteDone(
      start('etsued01', 'etsu-editor', lantern, 'writing', 'Second round on the notes', 30),
      { now: ago(26), result: 'Passed on round 2' }
    ),
    work.noteDone(start('reader02', 'reader', keeper, 'reading', 'Read the plates', 60), {
      now: ago(50),
      result: 'Read 40 of 40 plates'
    }),
    work.noteProgress(start('typset01', 'typesetter', keeper, 'pictures', 'Trace the plates', 4), {
      now: ago(1),
      progress: { done: 12, total: 40, unit: 'plates' }
    }),
    work.noteDone(
      start('checkr02', 'checker', doors, 'upload', 'Readiness on the upload files', 5),
      {
        now: ago(3),
        result: 'Readiness: 23 passed, 0 failed, 0 not checked',
        files: [sheet(doors, 'readiness.md')]
      }
    ),
    work.noteAsk(start('managr01', 'managing-editor', doors, 'upload', 'The upload pack', 2.5), {
      now: ago(2),
      what: 'Approve the upload pack',
      links: [{ label: 'Upload pack', path: sheet(doors, 'about.json') }]
    }),
    work.noteAsk(start('scout001', 'scout', bell, 'sourcing', 'Find the best printing', 990), {
      now: ago(960),
      what: 'Choose between the 1904 and 1911 printings',
      links: [{ label: 'Comparison', path: sheet(bell, 'sources.md') }]
    }),
    work.noteProgress(start('scout002', 'scout', bell, 'sourcing', 'Compare three scans', 1), {
      now: ago(0.2)
    }),
    work.noteProgress(start('stale001', 'reader', stair, 'reading', 'Read batch 3', 20), {
      now: ago(15),
      progress: { done: 20, total: 60, unit: 'leaves' }
    }),
    start('build001', 'builder', null, null, 'Build the Workroom screen', 0.5),
    work.noteHandoff(start('build000', 'builder', null, null, 'Fix the outbox', 30), {
      now: ago(24),
      role: 'reviewer',
      result: 'Built; ready for review',
      note: 'Review the outbox fix against its spec'
    })
  ]
  const files = new Map(notes.map((n) => [paths.statusNotePath(n), work.serializeStatusNote(n)]))
  files.set(BAD_NOTE, '{ "format": "status-note", "version": 1, "id": ')
  return files
}

/** One more note, for the check that a refresh fetches only what is new. */
export function lateNote(nowMs = Date.now()) {
  const note = work.startNote({
    id: 'late0001',
    role: 'typesetter',
    book: BOOKS.doors,
    stage: 'layout',
    job: 'Recut the cover to 148 pages',
    now: new Date(nowMs - 60_000).toISOString().replace(/\.\d+Z$/u, 'Z')
  })
  return [paths.statusNotePath(note), work.serializeStatusNote(note)]
}

/**
 * GitHub, as far as the Workroom and the query screen need it: the trees
 * listing of `work/runs`, notes by blob sha, the repository, and the files in
 * `shelf.files` by path. Counts every trees and blobs request.
 */
export async function stubShelf(page, shelf) {
  const seen = { trees: 0, blobs: 0 }
  await page.route('https://api.github.com/**', async (route) => {
    const url = new URL(route.request().url())
    const path = decodeURIComponent(url.pathname)
    const json = (status, body) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (/^\/repos\/[^/]+\/[^/]+$/u.test(path)) {
      return json(200, {
        full_name: 'Someone/Made-Up-Shelf',
        default_branch: 'main',
        private: true
      })
    }
    if (path.endsWith('/git/ref/heads/main')) return json(200, { ref: 'refs/heads/main' })
    if (path.endsWith('/git/trees/main:work/runs')) {
      seen.trees++
      if (shelf.refuse) return json(shelf.refuse, { message: 'Bad credentials' })
      if (shelf.notes.size === 0) return json(404, { message: 'Not Found' })
      const tree = [...shelf.notes].map(([p, text]) => ({
        path: p.replace(/^work\/runs\//u, ''),
        type: 'blob',
        sha: blobSha(text)
      }))
      return json(200, { sha: 'runs', truncated: false, tree })
    }
    const blob = /\/git\/blobs\/([0-9a-f]{40})$/u.exec(path)
    if (blob) {
      seen.blobs++
      const text = [...shelf.notes.values()].find((t) => blobSha(t) === blob[1])
      return text === undefined
        ? json(404, {})
        : route.fulfill({ status: 200, contentType: 'text/plain', body: text })
    }
    const file = path.split('/contents/')[1]
    if (file !== undefined) {
      if (file === 'books')
        return json(
          200,
          shelf.books.map((name) => ({ name, type: 'dir' }))
        )
      if (!shelf.files.has(file)) return json(404, { message: 'Not Found' })
      const text = shelf.files.get(file)
      if (!(route.request().headers()['accept'] ?? '').includes('raw')) {
        return json(200, { type: 'file', sha: blobSha(text), path: file })
      }
      return route.fulfill({ status: 200, contentType: 'text/plain', body: text })
    }
    return json(404, { message: 'Not Found' })
  })
  return seen
}
