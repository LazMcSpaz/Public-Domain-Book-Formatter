/**
 * Build a `local-asset://` URL for a project page image. The custom protocol
 * (registered in the main process) resolves `root` + `path` to a file on disk
 * and serves it only if it is an image inside an allowed project directory.
 *
 * Use this in <img src=...> for displaying page scans. For pixel-level work
 * (canvas crops in the source-image-on-hover popover) use
 * `window.api.getPageImage`, which returns a base64 data URL instead.
 */
export function assetUrl(projectPath: string, imagePath: string): string {
  const root = encodeURIComponent(projectPath)
  const path = encodeURIComponent(imagePath)
  return `local-asset://img/?root=${root}&path=${path}`
}
