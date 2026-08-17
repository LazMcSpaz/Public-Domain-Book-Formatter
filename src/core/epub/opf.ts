/**
 * What the EPUB says about itself: its metadata, and the order to read it in.
 *
 * The package document is the archive's own index. Two things are taken from
 * it, and the second matters more than it looks:
 *
 *   - **Metadata.** Title, author, date, publisher, already typed in by a
 *     person. For a scan these have to be read off the title page by the vision
 *     pass and confirmed; here they arrive correct and the export gate simply
 *     shows them filled in.
 *   - **The spine.** The order the documents are read in, which is *not* the
 *     order they sit in the archive and *not* alphabetical. Guessing it gives a
 *     book whose chapters are shuffled — which reads as a broken export rather
 *     than as a wrong assumption, so it is taken from the spine or not at all.
 *
 * `dc:date` is deliberately reduced to a year. An EPUB of a 1662 treatise
 * usually carries the date the *ebook* was made, which is not this book's
 * original year — so it is offered as a starting point at the export gate, the
 * same as anything read off a title page, rather than trusted.
 *
 * Pure: a tree in, facts out.
 */
import { findAll, textOf, type EpubElement, type EpubNode } from './tree'

export interface EpubPackage {
  title: string | null
  author: string | null
  /** Four digits, where the date said anything that looked like a year. */
  year: string | null
  publisher: string | null
  language: string | null
  /**
   * Archive paths of the content documents, in reading order.
   *
   * Already resolved against the package document's own folder, so a caller
   * can look each one straight up in the zip.
   */
  spine: string[]
  /** manifest id → archive path, for resolving images and the spine. */
  manifest: Map<string, { href: string; mediaType: string }>
}

const dc = (root: EpubNode, name: string): string | null => {
  const found = findAll([root], (el) => el.name === name || el.name === `dc:${name}`)
  for (const el of found) {
    const value = textOf(el)
    if (value) return value
  }
  return null
}

/**
 * Read a package document, given the archive path it was found at.
 *
 * `resolve` turns an href relative to the package into an archive path — passed
 * in rather than imported so this stays a pure function of its arguments and
 * the zip-path rules live in one place.
 */
export function parsePackage(root: EpubNode, resolve: (href: string) => string): EpubPackage {
  const manifest = new Map<string, { href: string; mediaType: string }>()
  for (const item of findAll([root], (el) => el.name === 'item')) {
    const id = item.attrs['id']
    const href = item.attrs['href']
    if (!id || !href) continue
    manifest.set(id, { href: resolve(href), mediaType: item.attrs['media-type'] ?? '' })
  }

  const spine: string[] = []
  const spineEl = findAll([root], (el) => el.name === 'spine')[0]
  for (const ref of spineEl ? findAll([spineEl], (el) => el.name === 'itemref') : []) {
    // `linear="no"` marks matter outside the reading order — a cover page, a
    // pop-up note. Keeping it would print the cover in the middle of the book.
    if ((ref.attrs['linear'] ?? 'yes').toLowerCase() === 'no') continue
    const item = manifest.get(ref.attrs['idref'] ?? '')
    if (item) spine.push(item.href)
  }

  const date = dc(root, 'date')
  const year = date ? (/\b(1[0-9]{3}|20[0-9]{2})\b/u.exec(date)?.[1] ?? null) : null

  return {
    title: dc(root, 'title'),
    author: creatorOf(root),
    year,
    publisher: dc(root, 'publisher'),
    language: dc(root, 'language'),
    spine,
    manifest
  }
}

/**
 * The author, preferring a `dc:creator` that says it is one.
 *
 * EPUBs list translators, illustrators and editors as creators too, marked by
 * `opf:role` or a `role` refine. Taking the first one regardless is how a
 * reprint ends up credited to its 1913 translator.
 */
function creatorOf(root: EpubNode): string | null {
  const creators = findAll(
    [root],
    (el) => el.name === 'creator' || el.name === 'dc:creator'
  ) as EpubElement[]
  if (creators.length === 0) return null

  const roleOf = (el: EpubElement): string =>
    (el.attrs['opf:role'] ?? el.attrs['role'] ?? '').toLowerCase()
  const authored = creators.find((el) => roleOf(el) === 'aut')
  const unmarked = creators.find((el) => roleOf(el) === '')
  const chosen = authored ?? unmarked ?? creators[0]!
  return textOf(chosen) || null
}
