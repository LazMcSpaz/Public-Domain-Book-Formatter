/**
 * Registers every IPC handler the renderer can invoke. Each handler delegates to
 * the core engine / pipeline / tooling modules and is wrapped so that thrown
 * errors propagate cleanly across the bridge (ipcMain.handle rejects the
 * renderer's invoke promise with the error message).
 */
import { dirname, join, parse } from 'node:path'
import { BrowserWindow, ipcMain, webContents } from 'electron'
import type { ProjectFile } from '@core/model'
import {
  IpcChannel,
  type DependencyStatus,
  type PipelineProgress,
  type PipelineResult
} from '@shared/ipc-types'
import { loadProject, saveProject } from '@core/project'
import { runPipeline } from '@pipeline'
import { detectDependencies } from '@tooling/deps/detect'

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
 * Derive the project manifest path for a given source PDF: a `project.json`
 * sitting alongside the PDF, named after it.
 */
function projectPathForPdf(pdfPath: string): string {
  const { name } = parse(pdfPath)
  return join(dirname(pdfPath), `${name}.project.json`)
}

/** Wire every IpcChannel to its handler. Call once, after app is ready. */
export function registerIpcHandlers(): void {
  ipcMain.handle(
    IpcChannel.OpenProject,
    guard(IpcChannel.OpenProject, (_event, projectPath: string): Promise<ProjectFile> => {
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
    IpcChannel.RunPipeline,
    guard(
      IpcChannel.RunPipeline,
      (event, pdfPath: string): Promise<PipelineResult> => {
        const projectPath = projectPathForPdf(pdfPath)
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
}
