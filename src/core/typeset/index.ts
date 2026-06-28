/**
 * Public surface of the typesetting core (SPEC §7/§8/§10).
 */
export { buildLatexDocument, parseTrimSize } from './latex-document'
export type { LatexDocumentInput } from './latex-document'
export { validateKdp, minGutterForPageCount } from './kdp-validate'
export type { ValidateKdpInput } from './kdp-validate'
export { escapeLatex, escapeLatexValue } from './escape'
