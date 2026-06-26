/**
 * The typed contract between the Electron main process and the renderer.
 *
 * The preload script exposes `BridgeApi` on `window.api` via contextBridge; the
 * main process implements the handlers. Both sides import these types so the
 * boundary stays type-safe. Channel name constants live in `IpcChannel` so the
 * string is defined exactly once.
 */
import type { ProjectFile } from '@core/model'

/** IPC channel names — single source of truth for both ends of the bridge. */
export const IpcChannel = {
  OpenProject: 'project:open',
  SaveProject: 'project:save',
  RunPipeline: 'pipeline:run',
  PipelineProgress: 'pipeline:progress',
  GetDependencies: 'deps:get'
} as const

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel]

/**
 * Presence/version status of one required system tool (Tesseract, OCRmyPDF,
 * Pandoc, XeLaTeX, pdftoppm). Foundation for the install wizard (SPEC §12 #21)
 * and KDP export validation (SPEC §10). Produced by the tooling dependency
 * detector and surfaced to the renderer over IPC.
 */
export interface DependencyStatus {
  /** Canonical tool id, e.g. "tesseract". */
  name: string
  found: boolean
  /** Resolved absolute path to the binary, if found. */
  path: string | null
  /** Parsed version string, if detected. */
  version: string | null
  /** Whether the detected version satisfies the declared minimum. */
  meetsMinimum: boolean
}

/** Progress event emitted by the pipeline runner as stages advance (SPEC §3). */
export interface PipelineProgress {
  /** Stage name, e.g. "ocr". */
  stage: string
  /** Zero-based index of the current stage. */
  index: number
  /** Total stage count. */
  total: number
  /** Optional human-readable detail. */
  message?: string
}

/** Result handed back to the renderer when a pipeline run completes. */
export interface PipelineResult {
  projectPath: string
  pageCount: number
}

/**
 * The API surface exposed to the renderer on `window.api`. Every method is async
 * (it crosses the process boundary). Progress is delivered via a subscription
 * that returns an unsubscribe function.
 */
export interface BridgeApi {
  /** Load a project manifest from disk (SPEC §9 save/resume). */
  openProject(projectPath: string): Promise<ProjectFile>
  /** Persist a project manifest to disk (atomic write). */
  saveProject(projectPath: string, project: ProjectFile): Promise<void>
  /** Run the full processing pipeline on a source PDF (SPEC §3). */
  runPipeline(pdfPath: string): Promise<PipelineResult>
  /** Subscribe to pipeline progress; returns an unsubscribe function. */
  onPipelineProgress(listener: (progress: PipelineProgress) => void): () => void
  /** Report presence/versions of required system tools (SPEC §2 note). */
  getDependencies(): Promise<DependencyStatus[]>
}

declare global {
  interface Window {
    api: BridgeApi
  }
}
