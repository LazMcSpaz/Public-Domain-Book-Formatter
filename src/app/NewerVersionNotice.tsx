/**
 * The band that asks the owner to reload this page when a newer version of
 * the app, opened in another tab or window, has raised the device's database
 * (`onNewerAppOpened` in `run-store.ts`). This page has already let go of the
 * database so the other could go ahead; reloading brings it up to the same
 * version. Shown on every screen, above everything, until the page reloads.
 */
import { useEffect, useState } from 'react'
import { onNewerAppOpened } from '../platform/browser/run-store'

export function NewerVersionNotice(): JSX.Element | null {
  const [shown, setShown] = useState(false)
  useEffect(() => onNewerAppOpened(() => setShown(true)), [])
  if (!shown) return null
  return (
    <div className="newer-version" role="alert" data-newer-version="">
      <p>
        A newer version of the app has been opened in another tab or window. Reload this page before
        you carry on, so both are the same version.
      </p>
      <button type="button" className="primary" onClick={() => window.location.reload()}>
        Reload this page
      </button>
    </div>
  )
}
