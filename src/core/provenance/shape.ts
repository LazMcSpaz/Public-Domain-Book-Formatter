/**
 * What a book is made of, before anything decides how to read it.
 *
 * Not every book on the shelf has the same parts. _Isis Unveiled_ is six
 * hundred photographed leaves and no text; _The Human Aura_ is photographed
 * leaves with somebody's OCR laid under them; _Patterns_ Vol. I is a text
 * layer and nothing else, somebody's 2016 OCR of a 1975 typescript printed to
 * PDF; a Standard Ebooks EPUB is text a person typed. Each of those needs a
 * different reading, has a different witness to accept a reading with, and
 * fails a different check — and until this module existed the difference
 * lived in whichever session last thought about it. Every book file now
 * carries its shape, `routeFor` turns the shape into the list of stages that
 * apply, and `docs/FLOW.md` is generated from that list rather than written
 * beside it.
 *
 * Three questions, each a fact about the file and not a guess about its
 * words:
 *
 * - **Are there pixels?** Is each page a photograph of paper? Only pixels can
 *   accept a reading (CLAUDE.md, the one rule), so this decides whether the
 *   propose/accept loop has anything to accept with.
 * - **What text does the file carry, and where did it come from?** None, a
 *   layer somebody's OCR produced (`converted`), or characters a person typed
 *   or a compositor set (`typeset`). A converted layer is made of words shaped
 *   exactly like right ones and passes every measure of word shape — which is
 *   how 81,743 words were stamped confidence 100 on a book that needed 350
 *   corrections — so the default is `converted` and `typeset` needs positive
 *   evidence. The safe error costs a free damage sweep; the other error cost
 *   a book.
 * - **Is there a second digitisation?** A reading that shares no blind spot
 *   with ours: the OCR layer archive.org put under its scan, a Gutenberg text.
 *   `@core/witness` compares against one where it exists.
 *
 * `how` says whether the shape was **measured** off the file or **declared**
 * by a person, because a shelf holds books whose file cannot be measured
 * here: a scan too large for the shelf to hold, a collection built from
 * thirty readings of thirty sources. A declaration carries its reason in
 * `evidence` the way a measurement carries its numbers.
 *
 * Pure: measurements in, a shape out. Reading the measurements off a PDF is
 * the platform's job (`looksScanned`) and the shelf script's
 * (`scripts/shape.mjs`); both hand their numbers here.
 */
/** Where the characters the file carries came from. */
export type TextLayer =
  /** No usable text: the page is pixels, or nothing. */
  | 'none'
  /** Somebody's OCR — of the pixels beside it, or of paper nobody has. */
  | 'converted'
  /** Characters a person typed or a compositor set. No conversion damage to sweep. */
  | 'typeset'

/** What kind of file the book arrived as. */
export type Container = 'pdf' | 'epub' | 'collection'

export interface BookShape {
  /** Every page is a photograph of paper, and a crop of it is evidence. */
  pixels: boolean
  textLayer: TextLayer
  /**
   * A second digitisation exists that shares no blind spot with ours.
   *
   * True by construction for a scan carrying an OCR layer — the layer is
   * archive.org's or Google's reading, not this app's — and false for a text
   * layer with no pixels unless somebody has found one (a Gutenberg text of
   * the same edition) and declared it.
   */
  externalText: boolean
  container: Container
  /** Measured off the file, or declared by a person with a reason. */
  how: 'measured' | 'declared'
  /** The numbers behind a measurement, or the reason behind a declaration. */
  evidence: string[]
}

/** One sampled page, as the platform measures it. */
export interface PageSample {
  /** Index in the file. */
  page: number
  /** Share of the page the largest image drawn on it covers. */
  coverage: number
  /**
   * Whether that makes the page a photograph, decided where the coverage was
   * measured (`SCANNED_COVERAGE` in `coverage.ts`). Carried rather than
   * re-derived so this file imports nothing but types and can be loaded by
   * plain Node, which strips types and resolves no extensionless import.
   */
  scanned: boolean
  /** Characters of embedded text on the page, whoever produced them. */
  text: number
}

/** A PDF, as sampled across the book. */
export interface PdfMeasurement {
  pages: number
  samples: PageSample[]
  producer: string | null
  creator: string | null
}

/**
 * Characters per page below which a text layer is furniture rather than text.
 *
 * The same floor recon uses to decide whether the file's own words are worth
 * reading straight out (`textPerPage > 200`). A Google Books scan carries
 * three thousand characters of boilerplate on its first page and none on
 * the rest, so the question is asked per page and answered by the majority,
 * not by the mean — the mean said that book had a text layer.
 */
export const TEXT_LAYER_FLOOR = 200

/**
 * Producers that only a typesetting pipeline writes.
 *
 * Deliberately short. Word, Acrobat, Ghostscript and a print driver are what
 * an OCR'd typescript gets printed through as well, so they are evidence of
 * nothing — _Patterns_ Vol. I says `Acrobat PDFWriter … Microsoft Word` and
 * needed 350 word corrections. A compositor or a digital-text publisher is
 * evidence that a person set the characters.
 */
const TYPESET_PRODUCER =
  /\b(pdfTeX|XeTeX|LuaTeX|LaTeX|InDesign|QuarkXPress|Scribus|Standard Ebooks|Project Gutenberg)\b/iu

/** This app's own export, handed back as a source. Named so it cannot pass quietly. */
const OWN_EXPORT = /Public-Domain Book Formatter/iu

/**
 * A PDF's shape, from what was sampled of it.
 *
 * Both majorities are over the sampled pages: a book is a scan when most
 * sampled pages are a photograph, and it carries a text layer when most
 * sampled pages have more than the floor on them. A scanned book often opens
 * with a typed title page and closes with a library slip, and neither may
 * decide for the other three hundred leaves.
 */
export function shapeOfPdf(m: PdfMeasurement): BookShape {
  const sampled = m.samples.length
  const scanned = m.samples.filter((s) => s.scanned).length
  const withText = m.samples.filter((s) => s.text > TEXT_LAYER_FLOOR).length
  const pixels = sampled > 0 && scanned * 2 > sampled
  const hasLayer = sampled > 0 && withText * 2 > sampled

  const evidence = [
    `${scanned} of ${sampled} sampled leaves are a photograph`,
    `${withText} of ${sampled} sampled leaves carry more than ${TEXT_LAYER_FLOOR} characters of text`
  ]
  if (m.producer) evidence.push(`producer: ${m.producer}`)
  if (m.creator) evidence.push(`creator: ${m.creator}`)

  const stamp = `${m.producer ?? ''} ${m.creator ?? ''}`
  if (OWN_EXPORT.test(stamp)) {
    evidence.push(
      'this file is an export of this app, not a source — the scan is what a book is read from'
    )
  }

  let textLayer: TextLayer = 'none'
  if (hasLayer) {
    // Nobody types text under a photograph: a layer beneath pixels is OCR.
    // Without pixels the origin cannot be read off the file, so a compositor
    // has to be named before the characters are taken as set by a person.
    textLayer =
      !pixels && TYPESET_PRODUCER.test(stamp) && !OWN_EXPORT.test(stamp) ? 'typeset' : 'converted'
  }

  return {
    pixels,
    textLayer,
    externalText: pixels && textLayer !== 'none',
    container: 'pdf',
    how: 'measured',
    evidence
  }
}

/** What an EPUB's package says about who made its text. */
export interface EpubOrigin {
  publisher: string | null
  /** Anything else the package says that might name the digitiser. */
  notes?: readonly (string | null)[]
}

/**
 * An EPUB's shape.
 *
 * Never pixels. A Standard Ebooks or Gutenberg file is text people typed and
 * proofread; an archive.org EPUB is their OCR with the pictures left out, and
 * an EPUB from anywhere else is taken the same way until somebody says
 * otherwise — the same default as a PDF, for the same reason.
 */
export function shapeOfEpub(origin: EpubOrigin): BookShape {
  const stamp = [origin.publisher, ...(origin.notes ?? [])].filter(Boolean).join(' ')
  const typeset = TYPESET_PRODUCER.test(stamp)
  const evidence = [
    'an EPUB: no page images anywhere in it',
    origin.publisher ? `publisher: ${origin.publisher}` : 'no publisher named'
  ]
  return {
    pixels: false,
    textLayer: typeset ? 'typeset' : 'converted',
    externalText: false,
    container: 'epub',
    how: 'measured',
    evidence
  }
}

/**
 * A shape a person states, with the reason.
 *
 * For the books no measurement here can reach: a scan the shelf refuses for
 * size, a collection assembled from many readings. The reason is required
 * because a declaration with none is indistinguishable from a guess, and it
 * is kept in the same field a measurement keeps its numbers in so the two
 * read alike on the ledger.
 */
export function declaredShape(
  shape: Omit<BookShape, 'how' | 'evidence'>,
  because: string
): BookShape {
  if (!because.trim()) throw new Error('A declared shape needs a reason.')
  return { ...shape, how: 'declared', evidence: [because.trim()] }
}

const TEXT_LAYERS: readonly TextLayer[] = ['none', 'converted', 'typeset']
const CONTAINERS: readonly Container[] = ['pdf', 'epub', 'collection']

/**
 * Read a shape back off a stored record, or nothing.
 *
 * Strict: a shape with a field nothing recognises would route the book down
 * a path no code takes, which is worse than no shape because it stops the
 * finish check asking for one.
 */
export function parseShape(raw: unknown): BookShape | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const textLayer = TEXT_LAYERS.find((t) => t === r['textLayer'])
  const container = CONTAINERS.find((c) => c === r['container'])
  const how = r['how'] === 'measured' || r['how'] === 'declared' ? r['how'] : null
  if (
    typeof r['pixels'] !== 'boolean' ||
    typeof r['externalText'] !== 'boolean' ||
    !textLayer ||
    !container ||
    !how
  ) {
    return null
  }
  const evidence = Array.isArray(r['evidence'])
    ? r['evidence'].filter((e): e is string => typeof e === 'string')
    : []
  return {
    pixels: r['pixels'],
    textLayer,
    externalText: r['externalText'],
    container,
    how,
    evidence
  }
}

/** One line a person can read on a ledger or a card. */
export function describeShape(s: BookShape): string {
  const what = s.pixels
    ? s.textLayer === 'none'
      ? 'photographed leaves with no text layer'
      : "photographed leaves with somebody's OCR laid under them"
    : s.textLayer === 'typeset'
      ? 'typeset text, no page images'
      : s.textLayer === 'converted'
        ? "somebody's OCR with no page images behind it"
        : 'neither pixels nor text'
  const container = s.container === 'pdf' ? '' : ` (${s.container})`
  return `${what}${container}, ${s.how}`
}
