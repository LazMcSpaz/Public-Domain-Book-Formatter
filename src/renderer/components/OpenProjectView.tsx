/**
 * OpenProjectView — the warm landing screen: import a source PDF (runs the
 * pipeline) or reopen an existing project directory. Presentational; all
 * orchestration lives in App.tsx via these props.
 *
 * Keep this prop contract — App.tsx depends on it.
 */
import './OpenProjectView.css'

export interface OpenProjectViewProps {
  /** A pipeline run / project open is in flight. */
  busy: boolean
  /** Last error message, if any. */
  error: string | null
  /** Import a new source PDF and run the pipeline. */
  onPickPdf: () => void
  /** Open an existing `.bookproj` directory. */
  onOpenExisting: () => void
}

export function OpenProjectView({
  busy,
  error,
  onPickPdf,
  onOpenExisting
}: OpenProjectViewProps): JSX.Element {
  return (
    <div className="open-project">
      <div className="open-project-card">
        <div className="open-project-mark" aria-hidden="true">
          ❦
        </div>
        <h1>Public-Domain Book Reprint Tool</h1>
        <p className="open-project-tagline">
          Turn an old scan into a print-ready KDP interior. Open a book to begin your side-by-side
          review pass.
        </p>

        <div className="open-project-actions">
          <button
            type="button"
            className="open-project-primary"
            onClick={onPickPdf}
            disabled={busy}
          >
            Import PDF…
          </button>
          <button type="button" onClick={onOpenExisting} disabled={busy}>
            Open existing project…
          </button>
        </div>

        <p className="open-project-hint">
          Importing a PDF runs OCR, cleanup, and layout — this can take a few minutes.
        </p>

        {error ? (
          <p className="error open-project-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
