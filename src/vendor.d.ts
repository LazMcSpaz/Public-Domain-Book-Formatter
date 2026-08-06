/**
 * Ambient declarations for dependencies that ship no types.
 *
 * Kept at the root of `src` rather than beside a consumer because these are
 * facts about the dependency, not about the module that happens to import it.
 */

/**
 * Liang hyphenation patterns for en-US — the same ones TeX uses. A plain data
 * module (`module.exports = {...}`) with no types of its own; the shape below
 * is the one `tex-linebreak`'s `createHyphenator` consumes.
 */
declare module 'hyphenation.en-us' {
  const patterns: {
    id: string[]
    leftmin: number
    rightmin: number
    patterns: Record<string, string>
    exceptions?: string
  }
  export default patterns
}
