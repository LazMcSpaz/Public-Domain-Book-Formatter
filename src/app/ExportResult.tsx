/**
 * The finished edition.
 *
 * Its own component because two things render it — the real flow and the dev
 * gate preview — and a screen this far down the flow is the easiest one to let
 * silently rot.
 *
 * The PDF is the whole deliverable: the layout engine set these pages and
 * pdf-lib wrote them, both in this tab, so there is nothing left for the user
 * to run and nothing else to download.
 *
 * `note` is the honest failure path. When the interior could not be built there
 * is now no fallback to offer, so saying exactly what went wrong is the only
 * useful thing this screen can do.
 */
import type { BuildExportResult } from '@core/export'
import { downloadPdf } from '../platform/browser/download'

export interface ExportResultProps {
  result: BuildExportResult
  pdf: { bytes: Uint8Array; pageCount: number } | null
  /** Why there's no PDF, when there isn't one. */
  note: string | null
}

export function ExportResult({ result, pdf, note }: ExportResultProps): JSX.Element {
  return (
    <div className="result">
      <div className="q">
        <span className="prompt">
          {pdf ? 'Your interior is ready' : 'The interior could not be built'}
        </span>
        {note ? <div className="help">{note}</div> : null}
        {pdf ? (
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => downloadPdf(pdf.bytes, result.fileName)}
            >
              Download the PDF — {pdf.pageCount} pages
            </button>
          </div>
        ) : null}
      </div>

      {result.notes.length > 0 ? (
        <div className="q">
          <span className="prompt">Worth knowing</span>
          <ul className="notes">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="q">
        <span className="prompt">Checked against KDP’s rules</span>
        <div className="help">
          Your cover needs the final page count for its spine
          {pdf ? `: ${pdf.pageCount} pages.` : ', which the interior would have told you.'}
        </div>
        <ul className="checks">
          {result.validation.checks.map((check) => (
            <li key={check.id} className={check.level}>
              <span className="level">{check.level}</span>
              <span className="check-label">{check.label}</span>
              <span className="check-detail">{check.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
