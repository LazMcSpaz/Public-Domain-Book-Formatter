/**
 * The finished edition.
 *
 * Its own component because two things render it — the real flow and the dev
 * gate preview — and a screen this far down the flow is the easiest one to let
 * silently rot.
 *
 * The PDF is the deliverable: the layout engine set these pages and pdf-lib
 * wrote them, both in this tab, so there is nothing left for the user to run.
 * The `.tex` stays as a secondary download during the transition, for anyone
 * who would rather typeset it themselves — it is on its way out, but a working
 * path out of the app should never disappear before its replacement is trusted.
 *
 * `note` is the honest failure path: if the interior could not be built, say
 * why and leave the `.tex` as the way forward rather than showing nothing.
 */
import type { BuildExportResult } from '@core/export'
import { downloadPdf, downloadText } from '../platform/browser/download'

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
          {pdf ? 'Your interior is ready' : 'Your typeset source is ready'}
        </span>
        {note ? <div className="help">{note}</div> : null}
        <div className="actions">
          {pdf ? (
            <button
              type="button"
              className="primary"
              onClick={() => downloadPdf(pdf.bytes, result.fileName.replace(/\.tex$/, '.pdf'))}
            >
              Download the PDF — {pdf.pageCount} pages
            </button>
          ) : null}
          <button
            type="button"
            className={pdf ? 'ghost' : 'primary'}
            onClick={() => downloadText(result.tex, result.fileName, 'application/x-tex')}
          >
            {pdf ? 'Or the LaTeX source' : `Download ${result.fileName}`}
          </button>
        </div>
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
          {pdf ? `: ${pdf.pageCount} pages.` : ', which the typeset PDF will tell you.'}
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
