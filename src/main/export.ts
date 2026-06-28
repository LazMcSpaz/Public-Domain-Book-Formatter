/**
 * Export orchestration entry points used by the IPC layer (SPEC §10).
 *
 * `exportProject` runs the full assembler (Markdown → Pandoc → LaTeX document →
 * XeLaTeX → KDP validation); it requires a present TeX toolchain and surfaces a
 * clear error to the renderer when one is missing. `validateProject` returns a
 * pre-render readiness estimate without invoking the toolchain.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportResult, KdpValidationReport, ProjectFile, StyleProfile } from '@core/model'
import { loadProject } from '@core/project'
import { resolveStyle, normalizeStyleProfile } from '@core/style'
import { validateKdp } from '@core/typeset'
import { assembleAndExport } from '@tooling/export'
import { listStyleProfiles } from './profile-store'

/** Resolve the effective style profile for a project (applied saved one, or default). */
async function resolveProfile(project: ProjectFile): Promise<StyleProfile> {
  const id = project.styleProfileId
  if (id) {
    const profiles = await listStyleProfiles()
    const found = profiles.find((p) => p.id === id)
    if (found) return resolveStyle(normalizeStyleProfile(found), project.config)
  }
  return resolveStyle(null, project.config)
}

export async function validateProject(projectPath: string): Promise<KdpValidationReport> {
  const project = await loadProject(projectPath)
  const profile = await resolveProfile(project)
  // Pre-render estimate: page count from the source until a real typeset run.
  return validateKdp({
    profile,
    pageCount: project.source.pageCount,
    images: [],
    warnings: [],
    fontsEmbedded: true
  })
}

export async function exportProject(projectPath: string): Promise<ExportResult> {
  const project = await loadProject(projectPath)
  const profile = await resolveProfile(project)
  const buildDir = join(projectPath, 'build')
  await mkdir(buildDir, { recursive: true })
  return assembleAndExport({ project, projectPath, profile, buildDir })
}
