/**
 * Book lexicon builder (the context spine for the model pass).
 *
 * Old and esoteric books are full of vocabulary a modern language model will
 * "helpfully" correct into something wrong — `chirurgeon` → `surgeon`,
 * `shew` → `show`, an unfamiliar proper noun → a common look-alike. The fix is
 * to harvest the book's *own* vocabulary first and hand it to the model as
 * known terms, so ambiguous pixels resolve toward what this book actually says.
 *
 * The harvest is deliberately evidence-driven, never a model's opinion:
 *   - **Frequency** separates real vocabulary from OCR noise. A strange string
 *     seen 40 times is a word; seen once it is probably a misread.
 *   - **Corroboration** from the index/TOC (curated, correctly spelled) promotes
 *     a term regardless of how odd it looks.
 *   - **Orthographic markers** (archaic endings, long-s, doubled terminals)
 *     flag period spelling that must be preserved, not modernized.
 *
 * Pure: no I/O, no model calls, no DOM. Fully unit-testable.
 */
import { isCommonWord } from './common-words'

/** One OCR'd token, the raw input to the harvest. */
export interface LexiconToken {
  text: string
  /** Tesseract per-word confidence 0–100. */
  confidence: number
  pageIndex: number
  /** Optional id so the UI can pull the exact word crop for review evidence. */
  tokenId?: string
}

/** Why a term was surfaced — shown to the user so the flag is never opaque. */
export type LexiconSignal =
  | 'frequent-unknown'
  | 'archaic-orthography'
  | 'low-confidence'
  | 'index-corroborated'
  | 'proper-noun'

export interface LexiconEntry {
  /** Canonical display form (the most frequent casing seen). */
  term: string
  /** Total occurrences across the book. */
  count: number
  /** Mean OCR confidence across occurrences (0–100). */
  meanConfidence: number
  /** Pages the term appears on (ascending, deduped). */
  pages: number[]
  /** Near-identical spellings folded into this entry, e.g. OCR variants. */
  variants: string[]
  /** Why this surfaced for review. */
  signals: LexiconSignal[]
  /**
   * Review priority: frequency × uncertainty. Fixing a term that appears 40×
   * is worth 40× fixing a one-off, so the review grid sorts on this.
   */
  impact: number
  /** A representative token id for pulling the word-crop evidence. */
  sampleTokenId?: string
}

export interface BuildLexiconOptions {
  /** Minimum occurrences before an unknown word is considered real. Default 3. */
  minCount?: number
  /** Terms harvested from the index/TOC — always trusted and included. */
  corroborated?: string[]
  /** Cap on returned entries (highest impact first). Default 200. */
  limit?: number
}

/** Strip surrounding punctuation but keep internal marks (hyphens, apostrophes). */
export function normalizeToken(raw: string): string {
  return raw
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim()
}

/** Archaic-orthography markers worth preserving rather than modernizing. */
const ARCHAIC_PATTERNS: readonly RegExp[] = [
  /ſ/, // long-s
  /(eth|est)$/i, // hath, knoweth, doest
  /(all|ell|ill|oll|ull)$/i, // mineralls, shall-style doubled terminals
  /^y[e]$/i, // ye (thorn)
  /æ|œ/i, // ligatures
  /ie(s)?$/i // everie, divers spellings
]

function archaicScore(term: string): number {
  return ARCHAIC_PATTERNS.reduce((n, re) => (re.test(term) ? n + 1 : n), 0)
}

/** Cheap Levenshtein with an early bail once distance exceeds `max`. */
export function editDistance(a: string, b: string, max = 1): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]!
}

interface Bucket {
  forms: Map<string, number>
  count: number
  confSum: number
  pages: Set<number>
  sampleTokenId?: string
}

/**
 * Harvest the book's distinctive vocabulary from OCR tokens.
 * Returns entries sorted by review impact (highest first).
 */
export function buildLexicon(
  tokens: readonly LexiconToken[],
  options: BuildLexiconOptions = {}
): LexiconEntry[] {
  const minCount = options.minCount ?? 3
  const limit = options.limit ?? 200
  const corroborated = new Set((options.corroborated ?? []).map((t) => t.toLowerCase()))

  // --- 1. Tally by case-folded key, remembering the casings actually seen. ---
  const buckets = new Map<string, Bucket>()
  for (const tok of tokens) {
    const text = normalizeToken(tok.text)
    // Require a letter and at least 3 chars: filters punctuation and page numbers.
    if (text.length < 3 || !/\p{L}/u.test(text)) continue

    const key = text.toLowerCase()
    let b = buckets.get(key)
    if (!b) {
      b = { forms: new Map(), count: 0, confSum: 0, pages: new Set() }
      buckets.set(key, b)
    }
    b.forms.set(text, (b.forms.get(text) ?? 0) + 1)
    b.count++
    b.confSum += tok.confidence
    b.pages.add(tok.pageIndex)
    if (!b.sampleTokenId && tok.tokenId) b.sampleTokenId = tok.tokenId
  }

  // --- 2. Keep only terms worth a human's attention. ---
  const kept: { key: string; bucket: Bucket; signals: LexiconSignal[] }[] = []
  for (const [key, bucket] of buckets) {
    const display = mostFrequentForm(bucket.forms)
    const meanConf = bucket.confSum / bucket.count
    const isCorroborated = corroborated.has(key)
    const archaic = archaicScore(display)
    const known = isCommonWord(key)
    // A capitalized form that isn't a common word is likely a proper noun —
    // exactly the class the model most often "corrects" into something wrong.
    const properNoun = /^\p{Lu}/u.test(display) && !known

    const signals: LexiconSignal[] = []
    if (isCorroborated) signals.push('index-corroborated')
    if (!known && bucket.count >= minCount) signals.push('frequent-unknown')
    if (archaic > 0) signals.push('archaic-orthography')
    if (meanConf < 80) signals.push('low-confidence')
    if (properNoun && bucket.count >= minCount) signals.push('proper-noun')

    // Ordinary words with nothing odd about them never reach review.
    if (known && !isCorroborated && meanConf >= 80) continue
    if (signals.length === 0) continue
    // A single sighting is noise unless the index vouches for it.
    if (bucket.count < minCount && !isCorroborated) continue

    kept.push({ key, bucket, signals })
  }

  // --- 3. Fold near-identical spellings together (OCR variants of one term). ---
  kept.sort((a, b) => b.bucket.count - a.bucket.count)
  const merged: typeof kept = []
  const absorbed = new Map<string, string[]>()
  for (const item of kept) {
    const host = merged.find(
      (m) =>
        m.key[0] === item.key[0] &&
        Math.abs(m.key.length - item.key.length) <= 1 &&
        editDistance(m.key, item.key, 1) <= 1
    )
    if (host) {
      // The more frequent spelling wins; the rarer one becomes a variant.
      host.bucket.count += item.bucket.count
      host.bucket.confSum += item.bucket.confSum
      for (const p of item.bucket.pages) host.bucket.pages.add(p)
      const list = absorbed.get(host.key) ?? []
      list.push(mostFrequentForm(item.bucket.forms))
      absorbed.set(host.key, list)
      for (const s of item.signals) if (!host.signals.includes(s)) host.signals.push(s)
    } else {
      merged.push(item)
    }
  }

  // --- 4. Score and rank by review impact. ---
  const entries: LexiconEntry[] = merged.map(({ key, bucket, signals }) => {
    const meanConfidence = bucket.confSum / bucket.count
    // Uncertainty rises as confidence falls and as orthography looks unusual.
    const uncertainty = (100 - meanConfidence) / 100 + signals.length * 0.15
    return {
      term: mostFrequentForm(bucket.forms),
      count: bucket.count,
      meanConfidence: Math.round(meanConfidence),
      pages: [...bucket.pages].sort((a, b) => a - b),
      variants: absorbed.get(key) ?? [],
      signals,
      impact: Math.round(bucket.count * (1 + uncertainty) * 100) / 100,
      sampleTokenId: bucket.sampleTokenId
    }
  })

  entries.sort((a, b) => b.impact - a.impact || b.count - a.count)
  return entries.slice(0, limit)
}

function mostFrequentForm(forms: Map<string, number>): string {
  let best = ''
  let bestN = -1
  for (const [form, n] of forms) {
    if (n > bestN) {
      best = form
      bestN = n
    }
  }
  return best
}

/**
 * Render the confirmed lexicon as a prompt fragment for the model pass.
 * Kept here (not in the client layer) so it is testable and version-controlled
 * alongside the harvesting rules that produce it.
 */
export function lexiconPromptBlock(entries: readonly LexiconEntry[]): string {
  if (entries.length === 0) return ''
  const terms = entries.map((e) => e.term).join(', ')
  return [
    'Known vocabulary in this work — these spellings are CORRECT and must be',
    'preserved exactly. Do not modernize or substitute a similar modern word:',
    terms
  ].join('\n')
}
