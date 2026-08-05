import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@platform': resolve(__dirname, 'src/platform')
    }
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' }
})
