/**
 * The cover studio's pieces: the question groups, the picture's file field, the press's mark, banking a look, and the preview with
 * its checks. Split out of `CoverStudio.tsx`, which holds the state.
 */
import type { ReactNode } from 'react'
import type { CoverDocument } from '@core/cover'
import { downloadPdf } from '../platform/browser/download'
import type { CoverPreview } from '../platform/browser/cover-preview'

/**
 * Which groups are open on arrival.
 *
 * The sheet, the look, the words and the choice of picture are the decisions
 * that make a cover; the palette, the ornament and the back-cover copy are
 * refinements of those, and putting all seven on screen at
 * once turns an interview into the panel of forty fields the design gate exists
 * not to be. The refinements are one click away and nothing is hidden: a
 * `details` element is open to a page search and to a screen reader.
 */
const OPEN_GROUPS: ReadonlySet<string> = new Set([
  'group-sheet',
  'group-look',
  'group-words',
  'group-art'
])

const GROUP_TITLE: Readonly<Record<string, string>> = {
  'group-palette': 'The colours',
  'group-ornament': 'Rules and ornament',
  'group-back': 'The back cover'
}

export function CoverGroup({ id, children }: { id: string; children: ReactNode }): JSX.Element {
  if (OPEN_GROUPS.has(id)) return <section className="q-group">{children}</section>
  return (
    <details className="q-group">
      <summary>{GROUP_TITLE[id] ?? 'More'}</summary>
      {children}
    </details>
  )
}

/**
 * What a downloaded file is called.
 *
 * The suffix carries the *kind* as well as the extension, because a PNG of the
 * front cover and the cover file itself end up in the same downloads folder and
 * only the name distinguishes them. Uploading the wrong one to KDP is a
 * rejection at best.
 */
export function fileName(doc: CoverDocument, suffix: string): string {
  const slug =
    doc.content.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'cover'
  return `${slug}-${suffix}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The editor's own picture: what it needs, and the file chooser. */
export function UploadField(props: {
  frame: { width: number; height: number } | null
  needed: { width: number; height: number } | null
  artError: string | null
  onUpload: (file: File) => Promise<void>
  onError: (text: string) => void
}): JSX.Element {
  const { frame, needed, artError, onUpload, onError } = props
  return (
    <div className="q">
      <span className="prompt">The file</span>
      <div className="help">
        {needed && frame
          ? `It prints across ${frame.width.toFixed(2)} × ${frame.height.toFixed(2)} in, so it wants about ${needed.width} × ${needed.height} pixels to hit 300 DPI.`
          : null}
      </div>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          onUpload(file).catch((error: unknown) => {
            onError(`That file could not be read: ${message(error)}`)
          })
        }}
      />
      {artError ? <div className="help warn">{artError}</div> : null}
    </div>
  )
}

/** The press's mark, supplied once and banked with the look. */
export function PressMarkField(props: {
  fileName: string | null
  onFile: (file: File) => Promise<void>
  onError: (text: string) => void
  onRemove: () => void
}): JSX.Element {
  return (
    <section className="q">
      <span className="prompt">The press's mark</span>
      <div className="help">
        Printed at the foot of the spine, in the accent colour. SVG or PNG — it is rendered at the
        size it prints, so vector stays sharp on a fold this narrow. It is banked with the look,
        because a colophon device belongs to the publisher rather than to a book.
      </div>
      <input
        type="file"
        accept="image/svg+xml,image/png,image/*"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          props.onFile(file).catch((error: unknown) => {
            props.onError(`That mark could not be read: ${message(error)}`)
          })
        }}
      />
      {props.fileName ? (
        <div className="help">
          Using {props.fileName}.{' '}
          <button type="button" className="linkish" onClick={props.onRemove}>
            Remove it
          </button>
        </div>
      ) : null}
    </section>
  )
}

/** Banking the look for the rest of a set. */
export function BankField(props: {
  lookName: string
  setLookName: (name: string) => void
  savedNote: string | null
  onBank: () => Promise<void>
}): JSX.Element {
  return (
    <section className="q">
      <span className="prompt">Keep this look for the rest of the set</span>
      <div className="help">
        Banks the arrangement, the palette, the faces and the ornament — and nothing about this
        book. The next volume is then one question instead of ten.
      </div>
      <input
        type="text"
        value={props.lookName}
        placeholder="Blackthorn plain covers"
        onChange={(e) => props.setLookName(e.target.value)}
      />
      <div className="actions">
        <button type="button" onClick={() => void props.onBank()}>
          Bank this look
        </button>
      </div>
      {props.savedNote ? <div className="help">{props.savedNote}</div> : null}
    </section>
  )
}

/** The cover itself, rendered from the PDF the button downloads, with its checks. */
export function PreviewPane(props: {
  doc: CoverDocument
  preview: CoverPreview | null
  rendering: boolean
  renderError: string | null
  credit: string | null
  frontBusy: boolean
  frontNote: string | null
  onFront: () => Promise<void>
}): JSX.Element {
  const { doc, preview, rendering, renderError, credit, frontBusy, frontNote } = props
  return (
    <aside className="cover-preview">
      {renderError ? (
        <div className="help warn">{renderError}</div>
      ) : preview ? (
        <>
          <img
            src={preview.url}
            alt="The whole flat cover — back, spine and front"
            className={rendering ? 'stale' : ''}
          />
          <div className="help">
            Back, spine, front. This picture is the PDF the button below downloads, rendered from
            its own bytes.
          </div>
          {credit ? <div className="help">{credit}</div> : null}
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => downloadPdf(preview.bytes, fileName(doc, 'cover.pdf'))}
            >
              Download the cover
            </button>
            <button type="button" disabled={frontBusy} onClick={() => void props.onFront()}>
              {frontBusy ? 'Rendering the front…' : 'Front cover as a picture'}
            </button>
          </div>
          {frontNote ? <div className="help">{frontNote}</div> : null}
          {preview.pdf.missingImages.length > 0 ? (
            <div className="help warn">
              The picture was placed but its pixels never arrived, so nothing was drawn there.
            </div>
          ) : null}
          <ul className="checks">
            {preview.validation.checks.map((check) => (
              <li key={check.id} className={check.level}>
                <span className="level">{check.level}</span>
                <span className="check-label">{check.label}</span>
                <span className="check-detail">{check.detail}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="help">Composing…</div>
      )}
    </aside>
  )
}
