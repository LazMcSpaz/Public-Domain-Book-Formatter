/**
 * suspicious-chars — systematic special-character detectors for the cleanup
 * pass (SPEC §4 "suspicious-character flagging", §11 archaic typography).
 *
 * These catch the recurring OCR/typography problems of old public-domain
 * scans — long-s read as f, leftover ligature codepoints, hyphen-pairs that
 * should be em-dashes, and mixed straight/curly quotes. Each match becomes a
 * heuristic flag anchored to a char range in the markdown (NEVER a probability,
 * per SPEC §4's honest-tiers rule).
 *
 * Pure module: no React, no I/O.
 */
import type { Flag } from '@core/model'

export interface SuspiciousPattern {
  /** Stable id used to tag the produced flags (and to de-dupe on re-scan). */
  id: string
  /** Human-readable label shown in the flag panel. */
  label: string
  /** Global regex that finds each occurrence. Must have the `g` flag. */
  test: RegExp
}

export const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  {
    id: 'long-s',
    label: 'suspicious char: long-s (ſ)',
    // U+017F LATIN SMALL LETTER LONG S — frequently OCRs as / hides behind "f".
    test: /ſ/g
  },
  {
    id: 'ligature',
    label: 'suspicious char: leftover ligature',
    // Presentation-form ligatures: ﬁ ﬂ ﬀ ﬃ ﬄ (U+FB01–U+FB04) and ﬅ ﬆ.
    test: /[ﬀ-ﬆ]/g
  },
  {
    id: 'double-hyphen',
    label: 'suspicious char: double-hyphen (probable em-dash)',
    // "--" sitting between two word characters: almost always a mis-set dash.
    test: /(?<=\w)--(?=\w)/g
  },
  {
    id: 'straight-quote',
    label: 'suspicious char: straight quote (mixed with curly)',
    // Straight single/double quotes — flagged when curly quotes also appear in
    // the document (see scanSuspiciousChars), to catch inconsistent quoting.
    test: /["']/g
  }
]

/** Does the text contain any curly/typographic quote? */
function hasCurlyQuotes(markdown: string): boolean {
  return /[‘’“”]/.test(markdown)
}

/**
 * Scan markdown for suspicious characters and return heuristic flags with char
 * offsets into the markdown. Pure — same input always yields the same flags.
 *
 * The straight-quote detector only fires when the document ALSO contains curly
 * quotes (an inconsistency worth surfacing); a document of purely straight
 * quotes is left alone to avoid drowning the panel in noise.
 */
export function scanSuspiciousChars(markdown: string): Flag[] {
  const flags: Flag[] = []
  const curly = hasCurlyQuotes(markdown)

  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.id === 'straight-quote' && !curly) continue

    // Fresh regex per scan so lastIndex state never leaks between calls.
    const re = new RegExp(
      pattern.test.source,
      pattern.test.flags.includes('g') ? pattern.test.flags : pattern.test.flags + 'g'
    )

    let match: RegExpExecArray | null
    while ((match = re.exec(markdown)) !== null) {
      const start = match.index
      const end = start + match[0].length
      flags.push({
        kind: 'heuristic',
        source: 'cleanup',
        label: pattern.label,
        range: { start, end }
      })
      // Guard against zero-length matches causing an infinite loop.
      if (match[0].length === 0) re.lastIndex++
    }
  }

  return flags
}

/** Prefix shared by every suspicious-char flag label (used to de-dupe). */
export const SUSPICIOUS_LABEL_PREFIX = 'suspicious char:'

/** True if a flag was produced by {@link scanSuspiciousChars}. */
export function isSuspiciousCharFlag(flag: Flag): boolean {
  return flag.kind === 'heuristic' && flag.label.startsWith(SUSPICIOUS_LABEL_PREFIX)
}
