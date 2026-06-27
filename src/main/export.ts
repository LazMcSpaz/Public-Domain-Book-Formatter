/**
 * Export orchestration entry points used by the IPC layer (SPEC §10).
 *
 * STEP 0 STUB: these resolve the project and return a minimal report so the
 * export UI is functional during development. At integration they are wired to
 * the real assembler (Markdown → Pandoc → LaTeX document → XeLaTeX → validate),
 * which lives in the tooling/export layer and depends on a present TeX toolchain.
 */
import type { ExportResult, KdpValidationReport } from '@core/model'
import { loadProject } from '@core/project'

export async function validateProject(projectPath: string): Promise<KdpValidationReport> {
  const project = await loadProject(projectPath)
  const pageCount = project.source.pageCount
  return {
    checks: [
      {
        id: 'pipeline',
        label: 'Export pipeline',
        level: 'warn',
        detail: 'Full KDP validation is wired at integration; this is a placeholder.'
      }
    ],
    pageCount,
    ready: false
  }
}

export async function exportProject(projectPath: string): Promise<ExportResult> {
  const validation = await validateProject(projectPath)
  return { pdfPath: null, pageCount: validation.pageCount, validation }
}
