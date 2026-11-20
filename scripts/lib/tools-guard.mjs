/**
 * The one refusal every script that writes book work shares: never inside
 * the tools repository, which is public. A file written there is one
 * `git add -A` from being published (it happened once with three sheets
 * quoting a book).
 *
 * The target need not exist yet. Links are followed from the nearest folder
 * that does exist, so a scratch folder that is really a link into the tools
 * is caught, at any depth: a shelf whose `work` folder, or one month's folder,
 * links into a subfolder of a tools copy is refused too. A link whose target
 * is missing is followed by what it says, so a write that would create that
 * target inside the tools is refused as well. Any copy of the tools counts,
 * not only the one this script runs from: a session working in a second
 * checkout or a worktree must not write into the first. Case is folded on
 * Windows, whose disks ignore it.
 *
 * Plain Node; used by `storage.mjs`, `work.mjs` and `drive.mjs`, tested in
 * `test/work-script.test.ts` and `test/storage-script.test.ts`.
 */
import { existsSync, lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJsonSync } from './json-file.mjs'

/** The top folder of the tools repository this script runs from. */
export const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const NAME = readJsonSync(join(TOOLS, 'package.json')).name

/** The text of the link at `path`, or null when it is not a link. */
function linkText(path) {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null
  } catch {
    return null
  }
}

/**
 * `target` with every link in the part of it that exists resolved, and a
 * link whose target is missing followed by what it says (at most 40 deep, as
 * the system itself stops a loop of links).
 */
function real(target, depth = 0) {
  let probe = resolve(target)
  const rest = []
  for (;;) {
    try {
      return join(realpathSync(probe), ...rest)
    } catch {
      const said = depth < 40 ? linkText(probe) : null
      if (said !== null) return real(join(resolve(dirname(probe), said), ...rest), depth + 1)
      const up = dirname(probe)
      if (up === probe) return resolve(target)
      rest.unshift(basename(probe))
      probe = up
    }
  }
}

function within(path, folder) {
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const inside = relative(fold(folder), fold(path))
  return inside === '' || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
}

/** The copy of the tools `target` sits in, or null: this one, or any folder whose package.json is the tools'. */
export function toolsAround(target) {
  const path = real(target)
  if (within(path, realpathSync(TOOLS))) return TOOLS
  for (let dir = path; ; dir = dirname(dir)) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        if (readJsonSync(pkg).name === NAME) return dir
      } catch {
        // Not a package file anyone can read; it names no tools.
      }
    }
    if (dirname(dir) === dir) return null
  }
}

/** Why `what` may not be written at `target`, or null when it may. */
export function toolsRefusal(target, what) {
  const tools = toolsAround(target)
  if (!tools) return null
  return `Refusing to write ${what} at ${target}: that is inside the tools repository (${tools}), which is public. Use a folder outside it (the shelf, or a scratch folder).`
}
