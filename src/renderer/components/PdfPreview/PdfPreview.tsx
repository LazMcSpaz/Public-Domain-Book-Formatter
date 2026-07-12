/**
 * PdfPreview — an in-app preview of the formatted interior (SPEC §7/§10).
 *
 * There is no way to preview the *real* typeset look without running the actual
 * pipeline (Pandoc + XeLaTeX), so "preview" here means: build the PDF and show
 * it inline. "Generate preview" typesets the current project, then the built
 * `build/book.pdf` is read back as a data URL and embedded. On mount we also try
 * to load any PDF from a previous build so the user isn't staring at a blank
 * pane. Self-contained: reads projectPath from the store.
 */
import { useCallback, useEffect, useState } from 'react'
import { useReview } from '../../store/ReviewContext'
import './PdfPreview.css'

export function PdfPreview(): JSX.Element {
  const { state } = useReview()
  const projectPath = state.projectPath

  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)

  // Load an existing build on mount / when the project changes.
  useEffect(() => {
    let cancelled = false
    if (!projectPath) {
      setDataUrl(null)
      return
    }
    void window.api
      .getExportPdf(projectPath)
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  const onGenerate = useCallback(async () => {
    if (!projectPath) return
    setBuilding(true)
    setError(null)
    try {
      const result = await window.api.exportPdf(projectPath)
      setPageCount(result.pageCount)
      const url = await window.api.getExportPdf(projectPath)
      setDataUrl(url)
      if (!url) setError('The build finished but no PDF was produced — check the toolchain.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBuilding(false)
    }
  }, [projectPath])

  return (
    <section className="pdf-preview">
      <div className="pp-head">
        <div>
          <h3>Preview</h3>
          <p className="pp-sub">
            Typesets the book and shows the real formatted PDF.
            {pageCount !== null ? ` ${pageCount} pages.` : ''}
          </p>
        </div>
        <button
          type="button"
          className="pp-generate"
          onClick={() => void onGenerate()}
          disabled={!projectPath || building}
        >
          {building ? 'Building…' : dataUrl ? 'Rebuild preview' : 'Generate preview'}
        </button>
      </div>

      {error ? <p className="error pp-error">{error}</p> : null}

      <div className="pp-frame-wrap">
        {dataUrl ? (
          <iframe className="pp-frame" title="Formatted PDF preview" src={dataUrl} />
        ) : (
          <div className="pp-empty">
            {building
              ? 'Typesetting the interior — this can take a few seconds…'
              : 'No preview yet. Click “Generate preview” to typeset and view the PDF.'}
          </div>
        )}
      </div>
    </section>
  )
}
