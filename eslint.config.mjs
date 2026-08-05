import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  {
    // Vendored third-party assets, build output, and generated screenshots are
    // not ours to lint.
    ignores: ['dist/**', 'public/**', 'screenshots/**', 'node_modules/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // App and platform code runs in the browser.
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  },
  {
    // Tests and build scripts run in Node.
    files: ['test/**/*.ts', 'scripts/**/*.mjs', '*.config.ts', '*.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  }
)
