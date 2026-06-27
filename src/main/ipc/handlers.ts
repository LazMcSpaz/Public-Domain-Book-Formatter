/**
 * Registers every IPC handler the renderer can invoke. Each handler delegates to
 * the core engine / pipeline / tooling modules and is wrapped so that thrown
 * errors propagate cleanly across the bridge (ipcMain.handle rejects the
 * renderer's invoke promise with the error message).
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import { BrowserWindow, dialog, ipcMain, webContents } from 'electron'
import type {
  ExportResult,
  KdpValidationReport,
  ProjectFile,
  StyleProfile
} from '@core/model'
import {
  IpcChannel,
  type DependencyStatus,
  type FileDialogFilter,
  type PipelineProgress,
  type PipelineResult
} from '@shared/ipc-types'
import { loadProject, saveProject } from '@core/project'
import { runPipeline } from '@pipeline'
import { detectDependencies } from '@tooling/deps/detect'
import { allowProjectRoot, mimeForPath, resolveProjectImage } from '../asset-access'
import {
  deleteStyleProfile,
  listStyleProfiles,
  saveStyleProfile
} from '../profile-store'
import { exportProject, validateProject } from '../export'

/**
 * Wrap a handler so any thrown error is logged in the main process and then
 * re-thrown — ipcMain serializes it back to the renderer's rejected promise.
 */
function guard<Args extends unknown[], Result>(
  channel: string,
  handler: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    try {
      return await handler(...args)
    } catch (error) {
      console.error(`[ipc] ${channel} failed:`, error)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }
}

/**
 * Derive the project DIRECTORY for a given source PDF: a `<name>.bookproj`
 * folder sitting alongside the PDF. The persistence layer treats a project as a
 * directory (manifest + assets/), so this must be a dir, not a file.
 */
function projectPathForPdf(pdfPath: string): string {
  const { name } = parse(pdfPath)
  return join(dirname(pdfPath), `${name}.bookproj`)
}

/** Wire every IpcChannel to its handler. Call once, after app is ready. */
export function registerIpcHandlers(): void {
  ipcMain.handle(
    IpcChannel.OpenProject,
    guard(IpcChannel.OpenProject, (_event, projectPath: string): Promise<ProjectFile> => {
      allowProjectRoot(projectPath)
      return loadProject(projectPath)
    })
  )

  ipcMain.handle(
    IpcChannel.SaveProject,
    guard(
      IpcChannel.SaveProject,
      (_event, projectPath: string, project: ProjectFile): Promise<void> => {
        return saveProject(projectPath, project)
      }
    )
  )

  ipcMain.handle(
    IpcChannel.GetDependencies,
    guard(IpcChannel.GetDependencies, (): Promise<DependencyStatus[]> => {
      return detectDependencies()
    })
  )

  ipcMain.handle(
    IpcChannel.OpenFileDialog,
    guard(
      IpcChannel.OpenFileDialog,
      async (_event, filters?: FileDialogFilter[]): Promise<string | null> => {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: filters ?? [{ name: 'PDF', extensions: ['pdf'] }]
        })
        return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
      }
    )
  )

  ipcMain.handle(
    IpcChannel.OpenFolderDialog,
    guard(IpcChannel.OpenFolderDialog, async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
    })
  )

  ipcMain.handle(
    IpcChannel.GetPageImage,
    guard(
      IpcChannel.GetPageImage,
      async (_event, projectPath: string, imagePath: string): Promise<string> => {
        const abs = resolveProjectImage(projectPath, imagePath)
        if (!abs) {
          throw new Error(`Refusing to read image outside project: ${imagePath}`)
        }
        allowProjectRoot(projectPath)
        const bytes = await readFile(abs)
        const mime = mimeForPath(abs) ?? 'application/octet-stream'
        return `data:${mime};base64,${bytes.toString('base64')}`
      }
    )
  )

  ipcMain.handle(
    IpcChannel.RunPipeline,
    guard(
      IpcChannel.RunPipeline,
      (event, pdfPath: string): Promise<PipelineResult> => {
        const projectPath = projectPathForPdf(pdfPath)
        allowProjectRoot(projectPath)
        // Prefer the window that issued the request; fall back to the focused
        // window so progress always reaches a live renderer.
        const sender = webContents.fromId(event.sender.id) ?? null
        return runPipeline({
          pdfPath,
          projectPath,
          onProgress: (progress: PipelineProgress) => {
            const target = sender ?? BrowserWindow.getFocusedWindow()?.webContents ?? null
            if (target && !target.isDestroyed()) {
              target.send(IpcChannel.PipelineProgress, progress)
            }
          }
        })
      }
    )
  )

  ipcMain.handle(
    IpcChannel.ListStyleProfiles,
    guard(IpcChannel.ListStyleProfiles, (): Promise<StyleProfile[]> => listStyleProfiles())
  )

  ipcMain.handle(
    IpcChannel.SaveStyleProfile,
    guard(IpcChannel.SaveStyleProfile, (_event, profile: StyleProfile): Promise<void> =>
      saveStyleProfile(profile)
    )
  )

  ipcMain.handle(
    IpcChannel.DeleteStyleProfile,
    guard(IpcChannel.DeleteStyleProfile, (_event, id: string): Promise<void> =>
      deleteStyleProfile(id)
    )
  )

  ipcMain.handle(
    IpcChannel.ExportPdf,
    guard(IpcChannel.ExportPdf, (_event, projectPath: string): Promise<ExportResult> => {
      allowProjectRoot(projectPath)
      return exportProject(projectPath)
    })
  )

  ipcMain.handle(
    IpcChannel.ValidateExport,
    guard(
      IpcChannel.ValidateExport,
      (_event, projectPath: string): Promise<KdpValidationReport> => {
        allowProjectRoot(projectPath)
        return validateProject(projectPath)
      }
    )
  )
}
