/**
 * Electron main-process entry point.
 *
 * Creates the application BrowserWindow with security best practices
 * (contextIsolation on, nodeIntegration off, sandbox on), loads the renderer
 * (electron-vite dev server when available, otherwise the built HTML), wires
 * standard window lifecycle behaviour, and registers all IPC handlers.
 */
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc/handlers'

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
