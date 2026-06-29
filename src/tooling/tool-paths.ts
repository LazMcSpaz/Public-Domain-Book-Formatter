/**
 * Tool-path resolution for a clean, self-contained install (SPEC §12 #21).
 *
 * For a one-click install we ship portable copies of the external tools INSIDE
 * the app, so a fresh machine needs nothing else installed. This module decides,
 * for a given tool name, whether to use a bundled binary or fall back to one on
 * the system PATH:
 *
 *   1. an explicit override dir (`PDBF_BIN_DIR`), then
 *   2. the bundled dir next to the packaged app (`<resources>/bin/<os>`), then
 *   3. the bare command name (let the OS resolve it on PATH).
 *
 * Resolution is pure and injectable (platform / resources path / fs-exists are
 * parameters) so it unit-tests deterministically with no real filesystem.
 */
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** Per-OS subfolder of the bundled `bin` directory. */
export function platformDir(platform: NodeJS.Platform): 'win' | 'mac' | 'linux' {
  if (platform === 'win32') return 'win'
  if (platform === 'darwin') return 'mac'
  return 'linux'
}

/** The on-disk filename for a tool on a given platform (`.exe` on Windows). */
export function binFileName(name: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${name}.exe` : name
}

/**
 * Per-tool bundled layout overrides, relative to `bin/<os>/`. Most tools sit
 * directly in that folder, but some must keep their distribution tree intact —
 * notably XeLaTeX, which is shipped as a TinyTeX install and must run from inside
 * it. Keyed by tool name, then platform.
 */
const BUNDLED_LAYOUT: Record<string, Partial<Record<NodeJS.Platform, string>>> = {
  xelatex: {
    win32: 'tinytex/bin/windows/xelatex.exe',
    darwin: 'tinytex/bin/universal-darwin/xelatex',
    linux: 'tinytex/bin/x86_64-linux/xelatex'
  }
}

/** Relative path of a tool within `bin/<os>/` (override or plain filename). */
export function bundledRelPath(name: string, platform: NodeJS.Platform): string {
  return BUNDLED_LAYOUT[name]?.[platform] ?? binFileName(name, platform)
}

/** Inputs for resolution; defaults read from the real process/runtime. */
export interface ResolveEnv {
  platform: NodeJS.Platform
  /** Electron's `process.resourcesPath` in a packaged app, else null. */
  resourcesPath: string | null
  /** `PDBF_BIN_DIR` override, or null. */
  binDirOverride: string | null
  /** Existence check (injectable for tests). */
  exists: (p: string) => boolean
}

function defaultEnv(): ResolveEnv {
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : null
  const override = process.env.PDBF_BIN_DIR
  return {
    platform: process.platform,
    resourcesPath,
    binDirOverride: override && override.length > 0 ? override : null,
    exists: existsSync
  }
}

/**
 * Resolve a tool name to an absolute bundled path when one exists, otherwise the
 * bare name (PATH fallback). An input that is already a path is returned as-is.
 */
export function resolveToolPath(name: string, env: ResolveEnv = defaultEnv()): string {
  // Already a path (absolute or contains a separator) — caller knows best.
  if (isAbsolute(name) || name.includes('/') || name.includes('\\')) return name

  const rel = bundledRelPath(name, env.platform)
  const roots: string[] = []
  if (env.binDirOverride) roots.push(env.binDirOverride)
  if (env.resourcesPath) roots.push(join(env.resourcesPath, 'bin', platformDir(env.platform)))

  for (const root of roots) {
    const candidate = join(root, rel)
    if (env.exists(candidate)) return candidate
  }
  return name
}

/** Whether a tool resolves to a bundled binary (vs. falling back to PATH). */
export function isBundled(name: string, env: ResolveEnv = defaultEnv()): boolean {
  const resolved = resolveToolPath(name, env)
  return resolved !== name
}
