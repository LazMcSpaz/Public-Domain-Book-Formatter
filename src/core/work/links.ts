/**
 * What a link in the Workroom opens. A note's links and files are paths on
 * the shelf (`../sync/work-paths.ts` checks them); the screen opens each kind
 * its own way, and never as a raw GitHub page:
 *
 * - a book's questions sheet opens that book's question screen in the app,
 *   where the owner rules as he does now;
 * - a Markdown sheet, a JSON file or plain text opens in the reading view;
 * - a picture is shown;
 * - anything else is named, with where it is.
 *
 * Pure: paths in, the kind out.
 */
import { bookFolderProblem, shelfPathProblem } from '../sync/work-paths'

export type LinkOpen =
  | { kind: 'queries'; path: string; book: string }
  | { kind: 'markdown' | 'json' | 'text' | 'image' | 'other'; path: string }

const KINDS: Record<string, 'markdown' | 'json' | 'text' | 'image'> = {
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  txt: 'text',
  tsv: 'text',
  csv: 'text',
  log: 'text',
  yml: 'text',
  yaml: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image'
}

/** How the Workroom opens a path on the shelf. */
export function linkOpens(path: string): LinkOpen {
  const sheet = /^books\/([^/]+)\/queries\.md$/u.exec(path)
  if (sheet && bookFolderProblem(sheet[1]!) === null) {
    return { kind: 'queries', path, book: sheet[1]! }
  }
  const ext = /\.([A-Za-z0-9]+)$/u.exec(path)?.[1]?.toLowerCase() ?? ''
  return { kind: KINDS[ext] ?? 'other', path }
}

/**
 * Where a link written inside a sheet points, as a path on the shelf, or null
 * when it leaves the shelf, is only a place in the same page (`#…`), or is not
 * a path a note could name. Relative links are read from the sheet's own
 * folder, as GitHub reads them.
 */
export function shelfLinkFrom(sheet: string, href: string): string | null {
  if (href === '' || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/iu.test(href)) return null
  const bare = href.split(/[?#]/u)[0]!
  let decoded: string
  try {
    decoded = decodeURIComponent(bare)
  } catch {
    return null
  }
  const parts = decoded.startsWith('/') ? [] : sheet.split('/').slice(0, -1)
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(segment)
  }
  const path = parts.join('/')
  return shelfPathProblem(path) === null ? path : null
}

/** Whether a link inside a sheet leaves the shelf for the web (opened in a new tab). */
export function isWebLink(href: string): boolean {
  return /^https?:\/\//iu.test(href)
}
