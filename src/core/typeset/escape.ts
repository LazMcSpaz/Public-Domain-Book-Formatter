/**
 * LaTeX escaping for interpolated content (SPEC §7/§8).
 *
 * Front-matter fields, titles, TOC entries, and running-head text are all
 * user/OCR-derived strings dropped into TeX source. They must be escaped so a
 * stray `&`, `%`, `$`, `_`, `{`, etc. can't break the build or be mis-set.
 *
 * Pure functions, no I/O.
 */

/**
 * Escape a string for safe use as LaTeX text. Handles the ten TeX special
 * characters: `& % $ # _ { } ~ ^ \`. Backslash is replaced first so the
 * replacements we emit (which contain backslashes) aren't double-escaped.
 */
const REPLACEMENTS: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}'
}

export function escapeLatex(s: string): string {
  if (s.length === 0) return ''
  // Single pass so the braces in our own replacements (e.g. \textbackslash{})
  // are not re-escaped by the {/} rules.
  return s.replace(/[\\&%$#_{}~^]/g, (ch) => REPLACEMENTS[ch] ?? ch)
}

/**
 * Escape a short value fragment (e.g. a font name, an ISBN). Behaves like
 * {@link escapeLatex} but additionally collapses internal whitespace, suiting
 * single-line interpolations inside commands.
 */
export function escapeLatexValue(s: string): string {
  return escapeLatex(s.replace(/\s+/g, ' ').trim())
}
