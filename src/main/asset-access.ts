/**
 * Centralized, security-scoped access to project asset files (page images).
 *
 * Both the `getPageImage` IPC handler and the `local-asset://` protocol serve
 * files off disk, so the path-safety rules live here exactly once:
 *  - a requested image must resolve INSIDE a project directory that has been
 *    explicitly allowed (opened or produced by the pipeline this session), and
 *  - it must have a known image extension.
 *
 * This prevents a compromised renderer from reading arbitrary files via either
 * channel.
 */
import { existsSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'

/** MIME types for the page-image extensions we serve. */
export const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp'
}

/** Project directories the renderer is permitted to read assets from. */
const allowedRoots = new Set<string>()

/** Permit asset reads under `projectPath`. Call when a project is opened/run. */
export function allowProjectRoot(projectPath: string): void {
  if (projectPath) allowedRoots.add(resolve(projectPath))
}

function isUnderAllowedRoot(abs: string): boolean {
  for (const root of allowedRoots) {
    const rel = relative(root, abs)
    if (!rel.startsWith('..') && resolve(root, rel) === abs) return true
  }
  return false
}

export function mimeForPath(abs: string): string | null {
  return IMAGE_MIME[extname(abs).toLowerCase()] ?? null
}

/**
 * Resolve a project-relative image path to an absolute path, returning null
 * unless it stays inside `projectPath` and has an image extension.
 */
export function resolveProjectImage(projectPath: string, imagePath: string): string | null {
  const root = resolve(projectPath)
  const abs = resolve(root, imagePath)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || resolve(root, rel) !== abs) return null
  if (mimeForPath(abs) === null) return null
  return abs
}

/**
 * Whether an absolute path may be served (used by the `local-asset://`
 * protocol): it must be an existing image under an allowed project root.
 */
export function isAllowedImage(abs: string): boolean {
  return mimeForPath(abs) !== null && isUnderAllowedRoot(abs) && existsSync(abs)
}
