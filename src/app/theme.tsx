import { useState } from 'react'

/**
 * The app's ground: dark by default, paper on request.
 *
 * Set as `data-theme` on the document root, where the tokens in `styles.css`
 * are read — the same place the reading view sets its own ground, which wins
 * over this while it is mounted. The choice is a per-device convenience and
 * lives in `localStorage`; losing it only means the default comes back.
 */
export type Theme = 'dark' | 'light'

const THEME_STORAGE = 'pdbf.theme'

export function readTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme
  try {
    window.localStorage.setItem(THEME_STORAGE, theme)
  } catch {
    /* a lost preference is not worth an error */
  }
}

export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to the ${next} theme`}
      onClick={() => {
        applyTheme(next)
        setTheme(next)
      }}
    >
      {theme === 'dark' ? '☀ Light' : '☾ Dark'}
    </button>
  )
}
