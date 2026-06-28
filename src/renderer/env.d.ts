/// <reference types="vite/client" />

/**
 * Renderer-side ambient typings. `window.api` is declared by
 * `@shared/ipc-types` (it augments the global `Window`). This file adds the
 * Vite client types and the electron-vite renderer URL env var so importing
 * `?` assets and reading `import.meta.env` is typed.
 */
interface ImportMetaEnv {
  /** Injected by electron-vite in development; absent in production builds. */
  readonly ELECTRON_RENDERER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
