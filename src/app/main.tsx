import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { prepareInstall } from '../platform/browser/install'
import { forgetOldNoteCopy } from '../platform/browser/note-store'
import { CoverStudio } from './CoverStudio'
import { NewerVersionNotice } from './NewerVersionNotice'
import { Settings } from './Settings'
import { applyTheme, readTheme } from './theme'
import { Workroom } from './Workroom'
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

  // The Workroom: what the agents are doing, read live from the shelf. Its own
  // address, so it can be added to the Home Screen; a questions link in it
  // leaves for `#book=…&at=queries`, which mounts the app afresh to land there.
  if (hash.startsWith('#workroom')) {
    return <Workroom onClose={() => (window.location.hash = '')} />
  }

  // The cover arm. A route of its own rather than a stage of the wizard,
  // because a cover is wanted for books this app never set — and the export
  // screen links in here with the measured page count already in hand.
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

// The ground is chosen before the first paint, so a light preference never
// flashes dark on the way in.
applyTheme(readTheme())

// Asked for once, at start-up, and never awaited: an app that waited on a
// service worker to draw its first screen would be an app that does not open
// when the worker cannot be registered.
void prepareInstall()

// The first Workroom kept its notes in `localStorage`, where they could crowd
// out the shelf's token; they live in a database of their own now
// (`note-store.ts`).
forgetOldNoteCopy()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NewerVersionNotice />
    <Root />
  </StrictMode>
)
