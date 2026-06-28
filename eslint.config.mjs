// Flat ESLint config. Type-aware linting for the TS sources, React-hooks rules
// for the renderer, and Prettier last to disable stylistic conflicts.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', '*.config.js']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      // The compiler already enforces unused-vars (noUnusedLocals); allow the
      // underscore-prefix escape hatch used across the codebase.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Effects in App/ImageEditor intentionally narrow their deps; warn, don't fail.
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  prettier
)
