/**
 * The shelf side of `work.mjs`: finding the shelf, turning the paths an agent
 * gives into paths on it, and reading and writing the notes. Every rule
 * about what a note may hold or where it goes is core's (`src/core/work/`,
 * `src/core/sync/work-paths.ts`), handed in as `work` and `paths` because a
 * script loads core only after registering `resolve-ts.mjs`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { TOOLS, toolsRefusal } from './tools-guard.mjs'

export function shelfNotes({ work, paths, fail }) {
  function findShelf(given) {
    const named = given ?? process.env.SHELF
    if (named) {
      if (!existsSync(named)) fail(`There is no folder at ${named}.`)
      return checkShelf(resolve(named))
    }
    const tried = [
      join(TOOLS, '..', 'Public-Domain-Books-Storage'),
      join(homedir(), 'Public-Domain-Books-Storage')
    ]
    const found = tried.find((dir) => existsSync(dir))
    if (!found)
      fail(
        `No shelf found (looked in ${tried.join(' and ')}). Give --shelf <the shelf checkout>, or set SHELF.`
      )
    return checkShelf(resolve(found))
  }

  function checkShelf(dir) {
    const why = toolsRefusal(join(dir, paths.WORK_ROOT), 'status notes')
    if (why) fail(why)
    const books = join(dir, 'books')
    if (!existsSync(books) || !statSync(books).isDirectory()) {
      fail(
        `${dir} has no books/ folder, so it does not look like the shelf. Give --shelf <the shelf checkout>.`
      )
    }
    return dir
  }

  const onShelf = (shelf, rel) => join(shelf, ...rel.split('/'))

  /** A path the agent gave, as a path from the shelf's top, or a refusal. */
  function shelfRelative(shelf, given, what) {
    let rel = given.replace(/\\/gu, '/')
    if (isAbsolute(given) || /^[A-Za-z]:[\\/]/u.test(given)) {
      const inside = relative(shelf, resolve(given))
      if (inside === '' || inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) {
        fail(`${given} is not on the shelf at ${shelf}: ${what} must be a file on the shelf.`)
      }
      rel = inside.split(sep).join('/')
    }
    const why = paths.shelfPathProblem(rel)
    if (why) fail(why)
    return rel
  }

  /** `Label=path` or a bare path, as a link the owner can open. */
  function linkFrom(shelf, given) {
    const cut = given.indexOf('=')
    const label = cut > 0 ? given.slice(0, cut).trim() : null
    const path = shelfRelative(shelf, cut > 0 ? given.slice(cut + 1).trim() : given, '--where')
    if (!existsSync(onShelf(shelf, path))) {
      fail(
        `${path} is not on the shelf at ${shelf}. Write it first, so the owner has something to open.`
      )
    }
    return { label: label || paths.linkLabel(path), path }
  }

  function filesFrom(shelf, given = []) {
    return given.map((g) => {
      const path = shelfRelative(shelf, g, '--file')
      if (!existsSync(onShelf(shelf, path)))
        console.error(`Note: ${path} is not on the shelf checkout yet; named anyway.`)
      return path
    })
  }

  function noteFiles(shelf) {
    const root = onShelf(shelf, paths.RUNS_ROOT)
    if (!existsSync(root)) return []
    const files = []
    for (const month of readdirSync(root).sort()) {
      const dir = join(root, month)
      if (!/^\d{4}-\d{2}$/u.test(month) || !statSync(dir).isDirectory()) continue
      for (const name of readdirSync(dir).sort()) {
        if (!name.endsWith('.json')) continue
        files.push({
          path: `${paths.RUNS_ROOT}/${month}/${name}`,
          text: readFileSync(join(dir, name), 'utf8')
        })
      }
    }
    return files
  }

  function findNote(shelf, id) {
    const why = paths.runIdProblem(id ?? '')
    if (why) fail(why)
    const hits = noteFiles(shelf).filter((f) => paths.runIdOfPath(f.path) === id)
    if (!hits.length) {
      fail(
        `No status note for run ${id} on the shelf at ${shelf}. "node scripts/work.mjs list" shows the runs there.`
      )
    }
    const read = work.readNotes(hits)
    if (read.unreadable.length) {
      const reasons = read.unreadable.map((u) => `${u.path}:\n  - ${u.problems.join('\n  - ')}`)
      fail(
        `The note for run ${id} cannot be believed, so nothing was changed.\n${reasons.join('\n')}`
      )
    }
    return read.notes[0]
  }

  function writeNote(shelf, note, fresh) {
    const rel = paths.statusNotePath(note)
    const file = onShelf(shelf, rel)
    const why = toolsRefusal(file, 'a status note')
    if (why) fail(why)
    const text = work.serializeStatusNote(note)
    const back = work.parseStatusNote(text)
    if (!back.ok)
      fail(
        `The note would not read back, so it was not written:\n  - ${back.problems.join('\n  - ')}`
      )
    mkdirSync(dirname(file), { recursive: true })
    if (fresh) {
      try {
        writeFileSync(file, text, { flag: 'wx' })
      } catch (e) {
        if (e.code === 'EEXIST')
          fail(`${rel} is already on the shelf; a new run never replaces a note. Run start again.`)
        throw e
      }
    } else {
      writeFileSync(`${file}.part`, text)
      renameSync(`${file}.part`, file)
    }
    return rel
  }

  return { findShelf, linkFrom, filesFrom, noteFiles, findNote, writeNote }
}
