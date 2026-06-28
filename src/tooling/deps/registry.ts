/**
 * The required system tools (SPEC §2 tool chain; install wizard SPEC §12 #21).
 *
 * Each spec says how to probe a binary for its version and how to extract a
 * semver-ish string from the (often chatty) `--version` banner. `minVersion` is
 * left `null` where a hard floor isn't justified yet — detection still reports
 * the parsed version, it just won't gate on it.
 */

/** How to detect and version-check one external tool. */
export interface ToolSpec {
  /** Canonical id surfaced in `DependencyStatus.name`. */
  name: string
  /** Executable name (resolved on PATH). */
  bin: string
  /** Args that make the tool print its version. */
  versionArgs: string[]
  /** Regex whose first capture group is a `x.y[.z]` version string. */
  versionRegex: RegExp
  /** Minimum acceptable version, or null to not gate on version. */
  minVersion: string | null
}

/**
 * The five tools the pipeline shells out to. Version banners vary in format, so
 * each regex is tuned to its tool's `--version` output:
 *  - tesseract: `tesseract 5.3.0` (first line).
 *  - ocrmypdf: `15.4.0` (prints bare version).
 *  - pandoc: `pandoc 3.1.11` (first line).
 *  - xelatex: `XeTeX 3.141592653-2.6-0.999996 (TeX Live 2023)`.
 *  - pdftoppm: `pdftoppm version 23.08.0` (from poppler-utils; banner on stderr).
 */
export const REQUIRED_TOOLS: ToolSpec[] = [
  {
    name: 'tesseract',
    bin: 'tesseract',
    versionArgs: ['--version'],
    versionRegex: /tesseract\s+v?(\d+\.\d+(?:\.\d+)?)/i,
    minVersion: '4.0.0'
  },
  {
    name: 'ocrmypdf',
    bin: 'ocrmypdf',
    versionArgs: ['--version'],
    versionRegex: /(\d+\.\d+(?:\.\d+)?)/,
    minVersion: '13.0.0'
  },
  {
    name: 'pandoc',
    bin: 'pandoc',
    versionArgs: ['--version'],
    versionRegex: /pandoc(?:\.exe)?\s+v?(\d+\.\d+(?:\.\d+)?)/i,
    minVersion: '2.11.0'
  },
  {
    name: 'xelatex',
    bin: 'xelatex',
    versionArgs: ['--version'],
    // XeTeX reports its own engine version, not a TeX Live year; capture it.
    versionRegex: /XeTeX\s+(\d+\.\d+(?:\.\d+)?)/i,
    minVersion: null
  },
  {
    name: 'pdftoppm',
    bin: 'pdftoppm',
    versionArgs: ['-v'],
    versionRegex: /pdftoppm\s+version\s+(\d+\.\d+(?:\.\d+)?)/i,
    minVersion: null
  }
]
