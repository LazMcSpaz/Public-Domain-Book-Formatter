/**
 * hOCR parser (SPEC §2 — the backbone).
 *
 * Tesseract / OCRmyPDF emit hOCR: XHTML where each word is an
 * `<span class="ocrx_word" title="bbox x0 y0 x1 y1; x_wconf NN">text</span>`,
 * grouped under `<div class="ocr_page" title="... bbox x0 y0 x1 y1; ...">`.
 *
 * We do NOT use a DOM library (none is available). Instead we scan the markup
 * with regexes that are resilient to attribute order and extra whitespace, then
 * decode the handful of XML entities that appear in OCR text.
 */
import type { BBox, Flag, SourcePage, WordToken } from '@core/model'

/** Decode the common XML entities (named + numeric) found in hOCR text. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      if (Number.isNaN(code)) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    switch (body) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      case 'nbsp':
        return ' '
      default:
        return whole
    }
  })
}

/** Strip any nested tags and decode entities, returning trimmed plain text. */
function extractText(innerHtml: string): string {
  const withoutTags = innerHtml.replace(/<[^>]*>/g, '')
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim()
}

/**
 * Parse an hOCR `title` attribute into its named properties. hOCR titles are
 * semicolon-separated `key v0 v1 ...` clauses (e.g. "bbox 1 2 3 4; x_wconf 90").
 */
function parseTitle(title: string): Map<string, string[]> {
  const props = new Map<string, string[]>()
  for (const raw of title.split(';')) {
    const clause = raw.trim()
    if (!clause) continue
    const parts = clause.split(/\s+/)
    const key = parts.shift()
    if (!key) continue
    props.set(key, parts)
  }
  return props
}

function bboxFromProps(props: Map<string, string[]>): BBox | null {
  const v = props.get('bbox')
  if (!v || v.length < 4) return null
  const nums = v.slice(0, 4).map((n) => Number(n))
  if (nums.some((n) => Number.isNaN(n))) return null
  return { x0: nums[0]!, y0: nums[1]!, x1: nums[2]!, y1: nums[3]! }
}

function confFromProps(props: Map<string, string[]>): number {
  const v = props.get('x_wconf')
  if (!v || v.length < 1) return 0
  const n = Number(v[0])
  return Number.isNaN(n) ? 0 : n
}

/**
 * Pull the `title="..."` (or `title='...'`) attribute value out of an opening
 * tag fragment. Handles both quote styles emitted by Tesseract / OCRmyPDF.
 */
function readTitleAttr(tagOpen: string): string {
  const m = /\btitle\s*=\s*"([^"]*)"|\btitle\s*=\s*'([^']*)'/i.exec(tagOpen)
  if (!m) return ''
  return m[1] ?? m[2] ?? ''
}

// Matches an ocr_page opening div. `[^>]*` is fine because hOCR tags don't
// contain raw `>` in attribute values. Class attr may use single or double
// quotes (`class='ocr_page'` is common in Tesseract output).
const PAGE_OPEN_RE = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bocr_page\b[^"']*["'][^>]*>/gi
// Matches a full ocrx_word span (open tag + inner content + close tag).
const WORD_RE =
  /<span\b([^>]*\bclass\s*=\s*["'][^"']*\bocrx_word\b[^"']*["'][^>]*)>([\s\S]*?)<\/span>/gi

/**
 * Parse hOCR markup into `SourcePage[]`. Pages get `imagePath=null`, `dpi=null`,
 * `regions=[]`; width/height come from the page bbox. Words carry a stable id
 * (`p{page}_w{n}`), trimmed/entity-decoded text, bbox, pageIndex and confidence.
 */
export function parseHocr(hocr: string): SourcePage[] {
  const pages: SourcePage[] = []

  // Find each page's opening tag, then slice its content up to the next page
  // (or end of document). This keeps words bucketed to their page even though
  // we scan flat regex over the body.
  const pageOpens: { index: number; openEnd: number; title: string }[] = []
  PAGE_OPEN_RE.lastIndex = 0
  let pm: RegExpExecArray | null
  while ((pm = PAGE_OPEN_RE.exec(hocr)) !== null) {
    pageOpens.push({
      index: pm.index,
      openEnd: pm.index + pm[0].length,
      title: readTitleAttr(pm[0])
    })
  }

  if (pageOpens.length === 0) return pages

  for (let p = 0; p < pageOpens.length; p++) {
    const cur = pageOpens[p]!
    const next = pageOpens[p + 1]
    const sliceEnd = next ? next.index : hocr.length
    const body = hocr.slice(cur.openEnd, sliceEnd)

    const pageProps = parseTitle(cur.title)
    const pageBox = bboxFromProps(pageProps)
    const width = pageBox ? pageBox.x1 - pageBox.x0 : 0
    const height = pageBox ? pageBox.y1 - pageBox.y0 : 0

    const words: WordToken[] = []
    let wordNo = 0
    WORD_RE.lastIndex = 0
    let wm: RegExpExecArray | null
    while ((wm = WORD_RE.exec(body)) !== null) {
      const tagAttrs = wm[1]!
      const inner = wm[2]!
      const wProps = parseTitle(readTitleAttr('<x ' + tagAttrs + '>'))
      const bbox = bboxFromProps(wProps)
      if (!bbox) continue
      const text = extractText(inner)
      words.push({
        id: `p${p}_w${wordNo}`,
        text,
        bbox,
        pageIndex: p,
        confidence: confFromProps(wProps)
      })
      wordNo++
    }

    pages.push({
      index: p,
      imagePath: null,
      width,
      height,
      dpi: null,
      words,
      regions: []
    })
  }

  return pages
}

/**
 * Seed the review report (SPEC §4): emit an `ocr` flag for every word whose
 * confidence is below `threshold` (default 60). These are the only flags that
 * carry a real probability.
 */
export function flagsFromPages(pages: SourcePage[], threshold = 60): Flag[] {
  const flags: Flag[] = []
  for (const page of pages) {
    for (const w of page.words) {
      if (w.confidence < threshold) {
        flags.push({ kind: 'ocr', tokenId: w.id, confidence: w.confidence })
      }
    }
  }
  return flags
}
