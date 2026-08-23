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
 *
 * `savedNote` is the opposite case and kept separate from it: something went
 * *right* that changed state the user cannot see — the publisher's details were
 * written back onto a banked look. Silently updating saved settings is the kind
 * of helpfulness that becomes a surprise three books later.
 */
import type { BuildExportResult } from '@core/export'
import type { BankFile } from '@core/harvest'
import { downloadPdf, downloadText } from '../platform/browser/download'
import { PageBrowser } from './PageBrowser'

export interface ExportResultProps {
  result: BuildExportResult
  pdf: { bytes: Uint8Array; pageCount: number } | null
  /** Why there's no PDF, when there isn't one. */
  note: string | null
  /** What was written back to a banked look, when anything was. */
  savedNote?: string | null
  /**
   * The fact bank harvested from this book, as files to keep.
   *
   * Offered here and nowhere else, well below the PDF: this is not part of the
   * edition and must never look like it is. The app's job ends at writing a
   * good file — consolidating a shelf of them is a separate tool for when there
   * is a shelf.
   */
  bank?: { files: BankFile[]; count: number } | null
  /**
   * Open the cover studio with everything this screen already knows.
   *
   * Offered here because this is the one moment the page count is a *measured*
   * fact rather than a guess, and the page count is the spine. Sending the user
   * away with a number to write down was the old answer, and the number is the
   * commonest thing to get wrong.
   */
  onComposeCover?: () => void
}

export function ExportResult({
  result,
  pdf,
  note,
  savedNote,
  bank,
  onComposeCover
}: ExportResultProps): JSX.Element {
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
        {savedNote ? <div className="help">{savedNote}</div> : null}
      </div>

      {pdf ? (
        <details className="q leafing">
          <summary>Look through the finished book</summary>
          <div className="help">
            Any page of it. The design gate previews four leaves, which answers questions about the
            look but never shows you the page your note actually landed on.
          </div>
          <PageBrowser bytes={pdf.bytes} pageCount={pdf.pageCount} />
        </details>
      ) : null}

      {bank && bank.count > 0 ? (
        <div className="q">
          <span className="prompt">What this book is worth remembering</span>
          <div className="help">
            {bank.count} entr{bank.count === 1 ? 'y' : 'ies'} — what the book attests, each with the
            words to prove it and the leaf it came from. Nothing to do with the printed edition; it
            is for writing from later. The Markdown is to read; the JSONL is the same entries one
            per line, so a shelf of these can be merged by a script.
          </div>
          <div className="actions">
            {bank.files.map((file) => (
              <button
                key={file.fileName}
                type="button"
                onClick={() => downloadText(file.contents, file.fileName, file.mimeType)}
              >
                {file.fileName.endsWith('.md') ? 'Download the notes' : 'Download the data file'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

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
        {pdf && onComposeCover ? (
          <div className="actions">
            <button type="button" onClick={onComposeCover}>
              Compose the cover — {pdf.pageCount} pages of spine
            </button>
          </div>
        ) : null}
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
