/**
 * The typed contract between the Electron main process and the renderer.
 *
 * The preload script exposes `BridgeApi` on `window.api` via contextBridge; the
 * main process implements the handlers. Both sides import these types so the
 * boundary stays type-safe. Channel name constants live in `IpcChannel` so the
 * string is defined exactly once.
 */
import type { ExportResult, KdpValidationReport, ProjectFile, StyleProfile } from '@core/model'

/** IPC channel names — single source of truth for both ends of the bridge. */
export const IpcChannel = {
  OpenProject: 'project:open',
  SaveProject: 'project:save',
  RunPipeline: 'pipeline:run',
  PipelineProgress: 'pipeline:progress',
  GetDependencies: 'deps:get',
  /** Show a native open-file dialog (e.g. to pick a source PDF). */
  OpenFileDialog: 'dialog:openFile',
  /** Show a native open-folder dialog (e.g. to open an existing project dir). */
  OpenFolderDialog: 'dialog:openFolder',
  /** Read a project page image and return it as a base64 data URL. */
  GetPageImage: 'review:pageImage',
  /** List saved style profiles from the app userData store (SPEC §7). */
  ListStyleProfiles: 'style:list',
  /** Create/update a saved style profile. */
  SaveStyleProfile: 'style:save',
  /** Delete a saved style profile by id. */
  DeleteStyleProfile: 'style:delete',
  /** Assemble + typeset the project to a print-ready KDP PDF (SPEC §10). */
  ExportPdf: 'export:pdf',
  /** Compute the KDP validation report without rendering when possible. */
  ValidateExport: 'export:validate'
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

/** A file-type filter for the native open-file dialog. */
export interface FileDialogFilter {
  name: string
  extensions: string[]
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
  /** Show a native open-file dialog; resolves to the chosen path or null. */
  openFileDialog(filters?: FileDialogFilter[]): Promise<string | null>
  /** Show a native open-folder dialog; resolves to the chosen path or null. */
  openFolderDialog(): Promise<string | null>
  /**
   * Read a page image from a project's assets and return it as a base64 data
   * URL (used for canvas crops in the source-image-on-hover popover, SPEC §4).
   * `imagePath` is resolved relative to the project and validated to stay inside
   * the project directory.
   */
  getPageImage(projectPath: string, imagePath: string): Promise<string>
  /** List saved style profiles (SPEC §7 reusable looks). */
  listStyleProfiles(): Promise<StyleProfile[]>
  /** Persist a style profile to the app-level store. */
  saveStyleProfile(profile: StyleProfile): Promise<void>
  /** Delete a saved style profile by id. */
  deleteStyleProfile(id: string): Promise<void>
  /** Assemble + typeset the project to a KDP-ready interior PDF (SPEC §10). */
  exportPdf(projectPath: string): Promise<ExportResult>
  /** Compute the KDP validation report (SPEC §10) for the project. */
  validateExport(projectPath: string): Promise<KdpValidationReport>
}

declare global {
  interface Window {
    api: BridgeApi
  }
}
