/**
 * What survived the LaTeX path: the honest export checks (SPEC §10).
 *
 * The document builder, the body emitter and the escaper are gone — the app
 * lays the book out itself now and pdf-lib writes it, so there is no TeX source
 * to build, nothing to escape, and no external engine to hand it to. The KDP
 * validation stayed and got *better*: the page count and the layout warnings it
 * reports are measured rather than estimated.
 */
export { validateKdp, minGutterForPageCount } from './kdp-validate'
export type { ValidateKdpInput } from './kdp-validate'
