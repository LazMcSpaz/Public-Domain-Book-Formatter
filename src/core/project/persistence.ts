/**
 * Project persistence (SPEC §9 — save/resume).
 *
 * A project is stored as a directory: a `project.json` manifest plus an
 * `assets/` dir for page images. Saves are atomic (write to a temp file in the
 * same directory, then rename) so a crash mid-write can never corrupt the
 * existing manifest.
 */
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ProjectFile } from '@core/model'
import { migrate } from './project-file'

const MANIFEST_NAME = 'project.json'
const ASSETS_DIR = 'assets'

/** Absolute path to the manifest file inside a project directory. */
export function manifestPath(projectPath: string): string {
  return path.join(projectPath, MANIFEST_NAME)
}

/** Absolute path to the assets directory inside a project directory. */
export function assetsPath(projectPath: string): string {
  return path.join(projectPath, ASSETS_DIR)
}

/**
 * Atomically persist a project to `projectPath` (a DIRECTORY). Creates the
 * project dir and `assets/` if missing, writes the manifest to a sibling temp
 * file, then renames it over `project.json`.
 */
export async function saveProject(projectPath: string, project: ProjectFile): Promise<void> {
  await fs.mkdir(projectPath, { recursive: true })
  await fs.mkdir(assetsPath(projectPath), { recursive: true })

  const json = JSON.stringify(project, null, 2)
  const target = manifestPath(projectPath)
  const tmp = path.join(projectPath, `.${MANIFEST_NAME}.${randomBytes(6).toString('hex')}.tmp`)

  try {
    await fs.writeFile(tmp, json, 'utf8')
    await fs.rename(tmp, target)
  } catch (err) {
    // Best-effort cleanup of the temp file on failure; ignore if already gone.
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * Load a project from `projectPath` (a DIRECTORY): read `project.json`, parse,
 * and run it through `migrate` so older manifests open cleanly.
 */
export async function loadProject(projectPath: string): Promise<ProjectFile> {
  const raw = await fs.readFile(manifestPath(projectPath), 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid project file: ${manifestPath(projectPath)} is not valid JSON.`)
  }
  return migrate(parsed)
}
