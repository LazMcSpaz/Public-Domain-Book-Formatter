/**
 * Pipeline runner (SPEC §3 processing pipeline).
 *
 * Builds a `PipelineContext`, runs the ordered stages, emits `PipelineProgress`
 * before and after each stage, honors cancellation between stages, then
 * persists the accumulated results into the project directory as a
 * `ProjectFile` and returns a `PipelineResult`.
 *
 * Integration contract (consumed by the Electron main process):
 *   import { runPipeline } from '@pipeline'
 */
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { PipelineProgress, PipelineResult } from '@shared/ipc-types'
import { createEmptyProject, saveProject } from '@core/project'
import { runCommand, type CommandRunner } from '@tooling/process'
import type { PipelineContext, Stage } from './stage'
import { extractStage } from './stages/extract'
import { ocrStage } from './stages/ocr'
import { imageDetectStage } from './stages/image-detect'
import { cleanupStage } from './stages/cleanup'
import { structureStage } from './stages/structure'
import { markdownStage } from './stages/markdown'

/** Default stage order (SPEC §3): extract → ocr → image-detect → cleanup → structure → markdown. */
export const DEFAULT_STAGES: Stage[] = [
  extractStage,
  ocrStage,
  imageDetectStage,
  cleanupStage,
  structureStage,
  markdownStage,
]

export interface RunPipelineOptions {
  pdfPath: string
  projectPath: string
  onProgress?: (p: PipelineProgress) => void
  /** Injectable command runner (default `runCommand`). */
  run?: CommandRunner
  /** Cancellation signal; the run stops between stages when aborted. */
  signal?: AbortSignal
  /** Override the stage list (used by tests for hermetic runs). */
  stages?: Stage[]
}

function makeWorkDir(projectPath: string): string {
  // Prefer a project-local assets work dir; fall back to OS tmp if needed.
  const base = projectPath
    ? path.join(projectPath, 'assets', 'work')
    : path.join(os.tmpdir(), 'pdbf-')
  return `${base}-${randomBytes(4).toString('hex')}`
}

/**
 * Run the full processing pipeline on a source PDF. Emits progress before and
 * after each stage, throws `Error('Pipeline aborted')` if the signal fires
 * between stages, persists results, and returns `{ projectPath, pageCount }`.
 */
export async function runPipeline(
  opts: RunPipelineOptions,
): Promise<PipelineResult> {
  const stages = opts.stages ?? DEFAULT_STAGES
  const run = opts.run ?? runCommand

  const workDir = makeWorkDir(opts.projectPath)
  await fs.mkdir(workDir, { recursive: true })

  const ctx: PipelineContext = {
    pdfPath: opts.pdfPath,
    projectPath: opts.projectPath,
    workDir,
    run,
    signal: opts.signal,
  }

  const total = stages.length
  for (let i = 0; i < stages.length; i++) {
    if (opts.signal?.aborted) {
      throw new Error('Pipeline aborted')
    }
    const stage = stages[i]!

    opts.onProgress?.({
      stage: stage.name,
      index: i,
      total,
      message: `starting ${stage.name}`,
    })

    await stage.run(ctx)

    opts.onProgress?.({
      stage: stage.name,
      index: i,
      total,
      message: `finished ${stage.name}`,
    })
  }

  if (opts.signal?.aborted) {
    throw new Error('Pipeline aborted')
  }

  const pageCount = ctx.document?.pageCount ?? ctx.pages?.length ?? 0

  // Persist results into the project (SPEC §9). May be skipped when no project
  // path is provided (e.g. some hermetic tests pass an empty string).
  if (opts.projectPath) {
    const project = createEmptyProject({
      pdfPath: opts.pdfPath,
      pageCount,
    })
    project.pages = ctx.pages ?? []
    project.coordinateMap = ctx.coordinateMap ?? []
    project.flags = ctx.flags ?? []
    await saveProject(opts.projectPath, project)
  }

  return { projectPath: opts.projectPath, pageCount }
}
