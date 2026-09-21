/**
 * A module resolver for the shelf scripts, so plain Node can load `src/core`.
 *
 * Node 22 strips TypeScript's types but resolves nothing it is not told the
 * extension of, and knows nothing of the `@core/*` alias `tsconfig.json`,
 * `vite.config.ts` and `vitest.config.ts` all define. Until this existed a core
 * module was loadable from a script only if it imported nothing — which is
 * why `book-files.mjs --marks` died on `marks.ts`'s import of `../edits/sweep`,
 * and why `ledger.ts` could not read the shape off a book file without
 * copying `parseShape` into itself.
 *
 * Two rules, applied in order: `@core/x` and `@platform/x` are the matching
 * directories under `src/`, and a specifier with no extension is tried as
 * `x.ts` and then as `x/index.ts`. Nothing else is touched, so `node:fs` and
 * `pdf-lib` resolve exactly as they always did.
 *
 * Registered from a script's first line:
 *
 *   import { register } from 'node:module'
 *   register('./resolve-ts.mjs', import.meta.url)
 *
 * Only the *dynamic* imports that follow go through it — a static import is
 * resolved before the script's body runs — which is why the scripts import
 * core with `await import(…)`.
 */
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const ALIASES = { '@core': resolvePath(SRC, 'core'), '@platform': resolvePath(SRC, 'platform') }

function withTs(path) {
  if (existsSync(path) && statSync(path).isFile()) return path
  if (existsSync(`${path}.ts`)) return `${path}.ts`
  if (existsSync(resolvePath(path, 'index.ts'))) return resolvePath(path, 'index.ts')
  return null
}

export async function resolve(specifier, context, next) {
  for (const [alias, dir] of Object.entries(ALIASES)) {
    if (specifier === alias || specifier.startsWith(`${alias}/`)) {
      const rest = specifier.slice(alias.length + 1)
      const found = withTs(rest ? resolvePath(dir, rest) : dir)
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
    }
  }
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL?.startsWith('file:') &&
    !/\.[a-z]+$/iu.test(specifier)
  ) {
    const found = withTs(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier))
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
  }
  return next(specifier, context)
}
