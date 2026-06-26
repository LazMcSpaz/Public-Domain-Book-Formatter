/**
 * Cleanup stage (SPEC §3 cleanup layer; SPEC §12 #4) — REAL v1.
 *
 * Applies de-hyphenation, ligature normalization, a few common OCR-confusion
 * fixes, and a header/footer strip heuristic to the OCR'd text, emitting an
 * honest `{kind:'heuristic', source:'cleanup', label}` flag for every touched
 * span (SPEC §4 — heuristics are never dressed up as probabilities).
 *
 * Transforms are small PURE functions (exported) so they're independently
 * unit-testable. The stage wires them together: it builds the page text from
 * `ctx.pages` words (or uses an existing `ctx.markdown`), runs the transforms,
 * stores the cleaned text on `ctx.markdown`, and appends the heuristic flags.
 */
import type { Flag } from '@core/model'
import type { PipelineContext, Stage } from '../stage'

/** A cleanup transform's result: the new text plus the labels it touched. */
export interface CleanupResult {
  text: string
  /** One label per touched span (drives heuristic flags). */
  labels: string[]
}

/**
 * Join words split across a line break by a trailing hyphen: `inter-\nnational`
 * -> `international`. Only joins when both sides look like word characters, so
 * genuine hyphenated compounds at a line end are left alone when the next line
 * starts non-alphabetically.
 */
export function dehyphenate(text: string): CleanupResult {
  const labels: string[] = []
  const out = text.replace(/([A-Za-z])-\n[ \t]*([a-z])/g, (_m, a: string, b: string) => {
    labels.push('de-hyphenated')
    return a + b
  })
  return { text: out, labels }
}

/** Ligature → ASCII pairs (and a few common Unicode presentation forms). */
const LIGATURES: Array<[RegExp, string]> = [
  [/ﬀ/g, 'ff'], // ﬀ
  [/ﬁ/g, 'fi'], // ﬁ
  [/ﬂ/g, 'fl'], // ﬂ
  [/ﬃ/g, 'ffi'], // ﬃ
  [/ﬄ/g, 'ffl'], // ﬄ
  [/ﬅ/g, 'st'], // ﬅ (long-s t)
  [/ﬆ/g, 'st'], // ﬆ
  [/œ/g, 'oe'], // œ
  [/Œ/g, 'OE'], // Œ
  [/æ/g, 'ae'], // æ
  [/Æ/g, 'AE'], // Æ
]

/** Normalize typographic ligatures to their ASCII letter sequences. */
export function normalizeLigatures(text: string): CleanupResult {
  const labels: string[] = []
  let out = text
  for (const [re, replacement] of LIGATURES) {
    out = out.replace(re, () => {
      labels.push('ligature-normalized')
      return replacement
    })
  }
  return { text: out, labels }
}

/**
 * A couple of common OCR-confusion fixes (SPEC §4 suspicious-character class):
 * long-s (ſ) -> s, and "rn" mis-read as "m" is NOT auto-corrected (too risky);
 * we only fix unambiguous glyph substitutions here.
 */
export function fixOcrConfusions(text: string): CleanupResult {
  const labels: string[] = []
  let out = text.replace(/ſ/g, () => {
    // ſ long-s
    labels.push('long-s-normalized')
    return 's'
  })
  // Curly quotes left as-is (typographically valid); normalize the stray
  // Unicode replacement char which signals a decode failure.
  out = out.replace(/�/g, () => {
    labels.push('replacement-char-removed')
    return ''
  })
  return { text: out, labels }
}

/**
 * Drop a line if it looks like a running head or a bare page number. Operates
 * on the FIRST and LAST non-empty line of a page block only.
 */
function looksLikeRunningHeadOrPageNo(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  // Bare page number (possibly with surrounding punctuation/roman numerals).
  if (/^[\[\(]?\s*(\d{1,4}|[ivxlcdm]{1,7})\s*[\]\)]?$/i.test(t)) return true
  // Short ALL-CAPS running head (few words, no sentence punctuation).
  if (/^[A-Z0-9 .,'\-]{2,40}$/.test(t) && t === t.toUpperCase() && t.split(/\s+/).length <= 6) {
    return true
  }
  return false
}

/** Strip a probable running head/footer line from the top and bottom of text. */
export function stripHeaderFooter(text: string): CleanupResult {
  const labels: string[] = []
  const lines = text.split('\n')
  // Top: first non-empty line.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === '') continue
    if (looksLikeRunningHeadOrPageNo(lines[i]!)) {
      labels.push('header-stripped')
      lines.splice(i, 1)
    }
    break
  }
  // Bottom: last non-empty line.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() === '') continue
    if (looksLikeRunningHeadOrPageNo(lines[i]!)) {
      labels.push('footer-stripped')
      lines.splice(i, 1)
    }
    break
  }
  return { text: lines.join('\n'), labels }
}

/** Run all cleanup transforms in order, accumulating touched labels. */
export function cleanupText(input: string): CleanupResult {
  const labels: string[] = []
  let text = input
  for (const transform of [
    stripHeaderFooter,
    dehyphenate,
    normalizeLigatures,
    fixOcrConfusions,
  ]) {
    const r = transform(text)
    text = r.text
    labels.push(...r.labels)
  }
  return { text, labels }
}

/** Build a page-ordered plain-text rendering from OCR words. */
function pagesToText(ctx: PipelineContext): string {
  if (typeof ctx.markdown === 'string') return ctx.markdown
  const pages = ctx.pages ?? []
  return pages
    .map((p) => p.words.map((w) => w.text).join(' '))
    .join('\n\n')
}

export const cleanupStage: Stage = {
  name: 'cleanup',
  async run(ctx: PipelineContext): Promise<void> {
    const input = pagesToText(ctx)
    const { text, labels } = cleanupText(input)
    ctx.markdown = text

    const flags: Flag[] = labels.map((label) => ({
      kind: 'heuristic',
      source: 'cleanup',
      label,
    }))
    ctx.flags = [...(ctx.flags ?? []), ...flags]
  },
}
