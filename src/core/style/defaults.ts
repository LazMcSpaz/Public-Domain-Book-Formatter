/**
 * Shipped default style profiles (SPEC §7, state 1).
 *
 * Tasteful starting points so day one isn't a blank page. Real serif font names
 * are used (resolved by XeLaTeX/fontspec at typeset time, not here). These are
 * the banked "looks" the user starts from before tweaking and saving their own.
 */
import type { StyleProfile } from '@core/model'

/**
 * The shipped profiles. The first entry is treated as the primary default
 * (see {@link defaultStyleProfile}).
 */
export const DEFAULT_STYLE_PROFILES: StyleProfile[] = [
  {
    id: 'classic-6x9',
    name: 'Classic 6×9',
    trimSize: '6x9',
    margins: { top: 0.75, bottom: 0.75, inner: 0.75, outer: 0.5 },
    gutter: 0.13,
    bodyFont: 'EB Garamond',
    bodyFontSize: 11,
    headingFont: 'EB Garamond',
    headingStyle: { smallCaps: true, centered: true, scale: 1.6 },
    runningHeads: { verso: 'author', recto: 'chapterTitle' },
    pageNumber: 'bottomCenter',
    ornaments: { chapterOpener: null, sectionDivider: null, pageNumber: null },
    frontMatter: { titlePage: true, copyrightPage: true, halfTitle: true },
  },
  {
    id: 'compact-5x8',
    name: 'Compact 5×8',
    trimSize: '5x8',
    margins: { top: 0.6, bottom: 0.6, inner: 0.6, outer: 0.4 },
    gutter: 0.13,
    bodyFont: 'Linux Libertine',
    bodyFontSize: 10.5,
    headingFont: 'Linux Libertine',
    headingStyle: { smallCaps: false, centered: true, scale: 1.4 },
    runningHeads: { verso: 'bookTitle', recto: 'chapterTitle' },
    pageNumber: 'bottomOuter',
    ornaments: { chapterOpener: null, sectionDivider: null, pageNumber: null },
    frontMatter: { titlePage: true, copyrightPage: true, halfTitle: false },
  },
  {
    id: 'verse-6x9',
    name: 'Verse 6×9',
    trimSize: '6x9',
    margins: { top: 0.85, bottom: 0.85, inner: 0.9, outer: 0.75 },
    gutter: 0.15,
    bodyFont: 'EB Garamond',
    bodyFontSize: 11.5,
    headingFont: 'Cormorant Garamond',
    headingStyle: { smallCaps: true, centered: true, scale: 1.5 },
    runningHeads: { verso: 'author', recto: 'bookTitle' },
    pageNumber: 'bottomCenter',
    ornaments: { chapterOpener: null, sectionDivider: null, pageNumber: null },
    frontMatter: { titlePage: true, copyrightPage: true, halfTitle: true },
  },
]

/** Deep clone so callers can't mutate the shipped constants. */
function clone(p: StyleProfile): StyleProfile {
  return {
    ...p,
    margins: { ...p.margins },
    headingStyle: { ...p.headingStyle },
    runningHeads: { ...p.runningHeads },
    ornaments: { ...p.ornaments },
    frontMatter: { ...p.frontMatter },
  }
}

/** The primary shipped default — a fresh, mutation-safe copy. */
export function defaultStyleProfile(): StyleProfile {
  return clone(DEFAULT_STYLE_PROFILES[0]!)
}
