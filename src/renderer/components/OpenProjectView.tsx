/**
 * OpenProjectView — initial screen: import a source PDF (runs the pipeline) or
 * open an existing project directory. Presentational; all orchestration is in
 * App.tsx via these props.
 *
 * PLACEHOLDER (Phase 2 scaffold). Keep this prop contract when reimplementing.
 */
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
      <h1>Public-Domain Book Reprint Tool</h1>
      <p>Open a book to begin the review pass.</p>
      <div className="open-project-actions">
        <button type="button" onClick={onPickPdf} disabled={busy}>
          Import PDF…
        </button>
        <button type="button" onClick={onOpenExisting} disabled={busy}>
          Open existing project…
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}
