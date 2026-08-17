/**
 * Books that are already digital.
 *
 * The rest of this app exists because a scan has to be *read* — rendered,
 * OCR'd, and then read again by a model against the pixels, which is the one
 * step that costs money. An EPUB has been through all of that already: a person
 * typed the text and marked up its structure, and both are simply there.
 *
 * So an EPUB skips the whole recovery half of the pipeline and joins the flow
 * at the structure gate, with nothing spent. What it gains from the rest of the
 * app is everything after that point — the proofing workbench, the editor's own
 * notes and introduction, the fact bank, the design interview, and a typeset
 * PDF that meets KDP's rules. Which is the actual product.
 */
export { readZipDirectory, payloadRange, resolveInZip, type ZipEntry } from './zip'
export {
  element,
  find,
  findAll,
  textOf,
  collapse,
  walk,
  text,
  type EpubElement,
  type EpubNode,
  type EpubText
} from './tree'
export { blocksFromDocument, type EpubContent, type EpubImage } from './content'
export { parsePackage, type EpubPackage } from './opf'
