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
      '@shared': resolve(__dirname, 'src/shared'),
      '@platform': resolve(__dirname, 'src/platform')
    }
  },
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true },
  server: { port: 5173 }
})
