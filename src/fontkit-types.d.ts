/**
 * Two fontkit members its bundled `fontkit.d.ts` omits. Both are real, public
 * and documented upstream; the shipped declarations are simply incomplete.
 *
 * `Glyph.name` is what makes a font failure diagnosable. The width bug that
 * `test/fonts-coverage.test.ts` exists to catch is invisible as a glyph id —
 * "glyph 1516 has no width" says nothing — but reads as `f.rf` the moment the
 * name is available, which names the feature to switch off.
 *
 * `Font.variationAxes` is empty on a static font and populated on a variable
 * one. That distinction matters here because a variable font embeds happily and
 * then prints as whatever instance the reader guesses, so it has to be caught
 * at the door rather than on paper.
 *
 * Its own file, not `vendor.d.ts`: this has to *augment* the module's existing
 * declarations, which requires a file TypeScript treats as a module — hence the
 * import below. `vendor.d.ts` is a script, and a `declare module` there would
 * silently replace fontkit's types rather than extend them.
 */
import '@pdf-lib/fontkit'

declare module '@pdf-lib/fontkit' {
  interface Glyph {
    name?: string
  }
  interface Font {
    variationAxes: Record<string, { name: string; min: number; default: number; max: number }>
  }
}
