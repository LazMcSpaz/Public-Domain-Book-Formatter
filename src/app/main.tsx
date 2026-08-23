import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CoverStudio } from './CoverStudio'
import { Settings } from './Settings'
import './styles.css'

/**
 * `#preview` opens the dev-only gate preview.
 *
 * The `import.meta.env.DEV` test is the *only* thing guarding the dynamic
 * import, and it compiles to a literal `false` in a production build — so the
 * bundler drops this branch and the preview module never ships. Folding a
 * runtime condition (the hash) in here instead would defeat that.
 */
const DevPreview = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import('./DevPreview')).DevPreview }))
  : null

function Root(): JSX.Element {
  // Driven by the hash rather than decided once at load, so typing the hash in
  // the address bar switches views instead of silently doing nothing.
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Settings ships in production, unlike the preview below — it holds the only
  // way to change an API key or reclaim storage, so it cannot be a dev tool.
  if (hash.startsWith('#settings')) {
    return <Settings onClose={() => (window.location.hash = '')} />
  }

  // The cover arm. A route of its own rather than a stage of the wizard,
  // because a cover is wanted for books this app never set — and the export
  // screen links in here with the measured page count already in hand, so the
  // book that *was* set here pays nothing for the independence.
  if (hash.startsWith('#cover')) {
    return <CoverStudio onClose={() => (window.location.hash = '')} />
  }

  if (DevPreview && hash.startsWith('#preview')) {
    return (
      <Suspense fallback={null}>
        <DevPreview />
      </Suspense>
    )
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
