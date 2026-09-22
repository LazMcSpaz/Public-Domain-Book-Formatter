import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Hosted under /<repo>/ on GitHub Pages; '/' for local dev and other hosts.
const base = process.env.PUBLIC_BASE ?? '/'

export default defineConfig({
  base,
  root: 'src/app',
  publicDir: resolve(__dirname, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@platform': resolve(__dirname, 'src/platform')
    }
  },
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true },
  // The second reader's runtime is served as the package ships it. Vite's
  // pre-bundling rewrites ONNX Runtime's wasm glue and it then fails to find
  // a backend (`no available backend found … K is not a function`); and a
  // pre-bundled `ppu-paddle-ocr` would carry a second copy of the runtime,
  // with the wasm path set on the wrong one.
  optimizeDeps: { exclude: ['onnxruntime-web', 'ppu-paddle-ocr'] },
  server: { port: 5173 }
})
