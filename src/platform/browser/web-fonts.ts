/**
 * The book's own faces, registered so a browser can set text in them.
 *
 * The reading view is set in the face the book will be printed in, and "the
 * face the book will be printed in" has to mean the same file in both places.
 * These are therefore the very URLs `fonts.ts` hands to fontkit and pdf-lib —
 * one list, exported from there — rather than a second set of web-font
 * declarations that would agree until the day somebody changed one of them.
 *
 * Loaded on demand and once per family: a reader picks one book face, and
 * fetching all seven to set one column would be megabytes for nothing on the
 * device this view exists for.
 *
 * Never throws and never blocks. A face that will not load leaves the column in
 * its fallback stack, which is a bookish serif and not a failure worth a
 * message — the words are all there either way.
 *
 * Browser-only.
 */
import { faceUrls } from './fonts'

/** Families whose faces have been handed to the document, by name. */
const registered = new Set<string>()

/**
 * Resolve a face path against the app's base.
 *
 * The bundler's `?url` imports are already absolute; Junicode's are relative to
 * `public/`, and the app is served from a sub-path on Pages — where a bare
 * `fonts/junicode/…` would resolve against whatever page happens to be open.
 */
function resolveFace(path: string): string {
  if (/^(https?:|blob:|data:|\/)/.test(path)) return path
  return new URL(path, new URL(import.meta.env.BASE_URL, window.location.href)).href
}

/**
 * Make one family available to CSS, if it is not already.
 *
 * Awaited by nobody in particular: the column is set with the family named
 * first and the fallback behind it, so the text is readable from the first
 * frame and re-sets itself when the real file arrives.
 */
export async function loadBookFace(family: string): Promise<void> {
  if (!family || registered.has(family)) return
  if (typeof window === 'undefined' || !('FontFace' in window)) return
  registered.add(family)

  const urls = faceUrls(family)
  const faces: { style: 'normal' | 'italic'; weight: string; url: string }[] = []
  if (urls.regular) faces.push({ style: 'normal', weight: '400', url: urls.regular })
  if (urls.italic) faces.push({ style: 'italic', weight: '400', url: urls.italic })
  // A family with no bold sets its strong runs in italic — decided in the
  // engine off `TextMeasurer.hasBold`, so nothing here should invent one for
  // the screen that the page will not print.
  if (urls.bold) faces.push({ style: 'normal', weight: '700', url: urls.bold })

  await Promise.all(
    faces.map(async (face) => {
      try {
        const loaded = new FontFace(family, `url(${resolveFace(face.url)})`, {
          style: face.style,
          weight: face.weight,
          display: 'swap'
        })
        await loaded.load()
        document.fonts.add(loaded)
      } catch {
        // Left to the fallback stack. A missing face is a different-looking
        // column, not a lost word.
      }
    })
  )
}
