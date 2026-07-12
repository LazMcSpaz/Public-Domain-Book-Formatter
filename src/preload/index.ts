/**
 * Preload script: the only bridge between the sandboxed renderer and the main
 * process. Exposes an object implementing `BridgeApi` on `window.api` via
 * contextBridge. The renderer never touches Node or ipcRenderer directly.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ExportResult, KdpValidationReport, ProjectFile, StyleProfile } from '@core/model'
import {
  IpcChannel,
  type BridgeApi,
  type DependencyStatus,
  type FileDialogFilter,
  type PipelineProgress,
  type PipelineResult
} from '@shared/ipc-types'

const api: BridgeApi = {
  openProject(projectPath: string): Promise<ProjectFile> {
    return ipcRenderer.invoke(IpcChannel.OpenProject, projectPath)
  },

  saveProject(projectPath: string, project: ProjectFile): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.SaveProject, projectPath, project)
  },

  runPipeline(pdfPath: string): Promise<PipelineResult> {
    return ipcRenderer.invoke(IpcChannel.RunPipeline, pdfPath)
  },

  getDependencies(): Promise<DependencyStatus[]> {
    return ipcRenderer.invoke(IpcChannel.GetDependencies)
  },

  openFileDialog(filters?: FileDialogFilter[]): Promise<string | null> {
    return ipcRenderer.invoke(IpcChannel.OpenFileDialog, filters)
  },

  openFolderDialog(): Promise<string | null> {
    return ipcRenderer.invoke(IpcChannel.OpenFolderDialog)
  },

  getPageImage(projectPath: string, imagePath: string): Promise<string> {
    return ipcRenderer.invoke(IpcChannel.GetPageImage, projectPath, imagePath)
  },

  listStyleProfiles(): Promise<StyleProfile[]> {
    return ipcRenderer.invoke(IpcChannel.ListStyleProfiles)
  },

  saveStyleProfile(profile: StyleProfile): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.SaveStyleProfile, profile)
  },

  deleteStyleProfile(id: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.DeleteStyleProfile, id)
  },

  exportPdf(projectPath: string): Promise<ExportResult> {
    return ipcRenderer.invoke(IpcChannel.ExportPdf, projectPath)
  },

  validateExport(projectPath: string): Promise<KdpValidationReport> {
    return ipcRenderer.invoke(IpcChannel.ValidateExport, projectPath)
  },

  getExportPdf(projectPath: string): Promise<string | null> {
    return ipcRenderer.invoke(IpcChannel.GetExportPdf, projectPath)
  },

  onPipelineProgress(listener: (progress: PipelineProgress) => void): () => void {
    const subscription = (_event: IpcRendererEvent, progress: PipelineProgress): void => {
      listener(progress)
    }
    ipcRenderer.on(IpcChannel.PipelineProgress, subscription)
    return () => {
      ipcRenderer.removeListener(IpcChannel.PipelineProgress, subscription)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
