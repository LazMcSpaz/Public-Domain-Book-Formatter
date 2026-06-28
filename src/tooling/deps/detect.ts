/**
 * System-dependency detection (SPEC §2 system-dependency note; SPEC §12 #21).
 *
 * The Electron main process imports `detectDependencies` to drive the install
 * wizard / KDP-export validation. Detection runs each tool's version command
 * through the injectable `CommandRunner`, so it is fully unit-testable with a
 * mock runner and NO binaries installed.
 */
import type { DependencyStatus } from '@shared/ipc-types'
import { runCommand, type CommandRunner } from '../process'
import { REQUIRED_TOOLS, type ToolSpec } from './registry'

/**
 * Compare two `x.y[.z]` versions. Missing patch components are treated as 0.
 * Returns -1 if `a < b`, 0 if equal, 1 if `a > b`. Non-numeric / missing
 * components are treated as 0 so it never throws on odd banners.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? (pa[i] as number) : 0
    const y = Number.isFinite(pb[i]) ? (pb[i] as number) : 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

/** Extract the version string from combined version-command output. */
function parseVersion(spec: ToolSpec, stdout: string, stderr: string): string | null {
  // Some tools (e.g. pdftoppm) print their banner to stderr; search both.
  const haystack = `${stdout}\n${stderr}`
  const m = spec.versionRegex.exec(haystack)
  return m && m[1] ? m[1] : null
}

/**
 * Detect a single tool: run its version command, parse the version, and check
 * it against `minVersion`. A spawn failure (binary not on PATH) or a non-zero
 * exit is treated as "not found". Uses the injected `run` (default
 * `runCommand`).
 */
export async function detectTool(
  spec: ToolSpec,
  run: CommandRunner = runCommand
): Promise<DependencyStatus> {
  const notFound: DependencyStatus = {
    name: spec.name,
    found: false,
    path: null,
    version: null,
    meetsMinimum: false
  }

  let stdout = ''
  let stderr = ''
  try {
    const result = await run(spec.bin, spec.versionArgs)
    if (result.code !== 0) return notFound
    stdout = result.stdout
    stderr = result.stderr
  } catch {
    // Spawn error (ENOENT etc.) — the binary isn't installed / not on PATH.
    return notFound
  }

  const version = parseVersion(spec, stdout, stderr)
  // The tool ran successfully, so it is present even if we couldn't parse a
  // version banner. `path` is left null: PATH resolution is the OS's job and we
  // don't shell `which`/`where` here (keeps it cross-platform and binary-free).
  const meetsMinimum =
    spec.minVersion === null
      ? true
      : version !== null && compareVersions(version, spec.minVersion) >= 0

  return {
    name: spec.name,
    found: true,
    path: null,
    version,
    meetsMinimum
  }
}

/**
 * Detect every required tool. THIS is the function the Electron main process
 * imports: `import { detectDependencies } from '@tooling/deps/detect'`.
 */
export async function detectDependencies(
  run: CommandRunner = runCommand
): Promise<DependencyStatus[]> {
  return Promise.all(REQUIRED_TOOLS.map((spec) => detectTool(spec, run)))
}
