/**
 * Electron main-process entry point.
 *
 * Creates the application BrowserWindow with security best practices
 * (contextIsolation on, nodeIntegration off, sandbox on), loads the renderer
 * (electron-vite dev server when available, otherwise the built HTML), wires
 * standard window lifecycle behaviour, and registers all IPC handlers.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, protocol } from 'electron'
import { registerIpcHandlers } from './ipc/handlers'
import { isAllowedImage, mimeForPath, resolveProjectImage } from './asset-access'

/** Custom scheme used by the renderer to display project page images directly. */
const ASSET_SCHEME = 'local-asset'

// Must run before app `ready`: treat the scheme like a standard, secure origin
// so the renderer can load it from <img> under a strict CSP.
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

/**
 * Serve project page images to the renderer. The renderer references images as:
 *
 *   local-asset://img/?root=<enc(projectPath)>&path=<enc(relativeImagePath)>
 *
 * Main resolves `root` + `path` to an absolute file (rejecting `../` escapes)
 * and serves it only if it is an image inside an allowed project root. This
 * keeps the renderer from constructing absolute OS paths and centralizes the
 * safety checks in asset-access.ts.
 */
function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url)
    const root = url.searchParams.get('root')
    const relPath = url.searchParams.get('path')
    if (!root || !relPath) return new Response('Bad request', { status: 400 })

    const abs = resolveProjectImage(root, relPath)
    if (!abs || !isAllowedImage(abs)) {
      return new Response('Forbidden', { status: 403 })
    }
    const bytes = await readFile(abs)
    return new Response(bytes, {
      headers: { 'Content-Type': mimeForPath(abs) ?? 'application/octet-stream' }
    })
  })
}

/** Build the main application window. */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#fbfaf7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  // electron-vite injects the dev-server URL in development; in production we
  // load the file emitted into out/renderer.
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

void app.whenReady().then(() => {
  registerAssetProtocol()
  registerIpcHandlers()
  createWindow()

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS where apps stay active
// until the user explicitly quits with Cmd+Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
