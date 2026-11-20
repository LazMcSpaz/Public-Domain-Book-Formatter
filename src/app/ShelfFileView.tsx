/**
 * A file from the shelf, opened in a plain reading view inside the Workroom:
 * a Markdown sheet as text with headings and lists, a JSON file laid out as
 * an outline, plain text as it is, a picture as a picture. Never a raw GitHub
 * page. Read through the shelf connection (`getText`, `getBytes`), so every
 * read is the shelf's current copy.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { linkLabel, type ShelfConfig } from '@core/sync'
import { jsonOutline, linkOpens, markdownBlocks, type Outline, type OutlineNode } from '@core/work'
import { getBytes, getText } from '../platform/browser/shelf'
import { MarkdownView } from './MarkdownView'
import { useDialogFocus } from './dialog-focus'

type Loaded =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'failed'; why: string }
  | { state: 'text'; text: string }
  | { state: 'image'; url: string }

export function ShelfFileView({
  config,
  path,
  openPath,
  onClose
}: {
  config: ShelfConfig
  path: string
  openPath: (path: string) => void
  onClose: () => void
}): JSX.Element {
  const kind = linkOpens(path).kind
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  useEffect(() => {
    let live = true
    let url: string | null = null
    setLoaded({ state: 'loading' })
    if (kind === 'other') return
    void (async () => {
      try {
        if (kind === 'image') {
          const bytes = await getBytes(config, path)
          if (!live) return
          if (!bytes) return setLoaded({ state: 'missing' })
          url = URL.createObjectURL(new Blob([bytes as BlobPart]))
          setLoaded({ state: 'image', url })
        } else {
          const text = await getText(config, path)
          if (!live) return
          setLoaded(text === null ? { state: 'missing' } : { state: 'text', text })
        }
      } catch (err) {
        if (live)
          setLoaded({ state: 'failed', why: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [config, path, kind])

  const dialog = useRef<HTMLDivElement>(null)
  useDialogFocus(dialog, onClose)

  return (
    <div
      ref={dialog}
      tabIndex={-1}
      className="wr-overlay wr-overlay-file"
      role="dialog"
      aria-modal="true"
      aria-label={linkLabel(path)}
    >
      <div className="wr-backdrop" onClick={onClose} />
      <article className="wr-sheet wr-file" data-file={path}>
        <header className="wr-sheet-head">
          <div className="wr-sheet-title">
            <small>From the shelf</small>
            <h2>{linkLabel(path)}</h2>
            <code className="wr-file-path">{path}</code>
          </div>
          <button type="button" className="wr-close" onClick={onClose}>
            Close
          </button>
        </header>
        <FileBody kind={kind} loaded={loaded} path={path} openPath={openPath} />
      </article>
    </div>
  )
}

function FileBody({
  kind,
  loaded,
  path,
  openPath
}: {
  kind: ReturnType<typeof linkOpens>['kind']
  loaded: Loaded
  path: string
  openPath: (path: string) => void
}): JSX.Element {
  if (kind === 'other') {
    return (
      <p className="wr-quiet">
        This kind of file cannot be shown here. It is on the shelf at {path}; ask a session to open
        it for you.
      </p>
    )
  }
  if (loaded.state === 'loading') return <p className="wr-quiet">Reading it from the shelf…</p>
  if (loaded.state === 'missing') {
    return (
      <p className="wr-warn">
        This file is not on the shelf now. It may have been moved, or retired when its book was
        finished.
      </p>
    )
  }
  if (loaded.state === 'failed') return <p className="wr-warn">Could not read it: {loaded.why}</p>
  if (loaded.state === 'image') return <img className="wr-image" src={loaded.url} alt={path} />
  if (kind === 'markdown') return <SheetText text={loaded.text} path={path} openPath={openPath} />
  if (kind === 'json') return <JsonText text={loaded.text} />
  return <pre className="wr-pre">{loaded.text}</pre>
}

function SheetText({
  text,
  path,
  openPath
}: {
  text: string
  path: string
  openPath: (path: string) => void
}): JSX.Element {
  const blocks = useMemo(() => markdownBlocks(text), [text])
  return <MarkdownView blocks={blocks} from={path} openPath={openPath} />
}

/** How many values the outline shows before it says how many more there are. */
const MAX_VALUES = 3000

function JsonText({ text }: { text: string }): JSX.Element {
  const outlined = useMemo((): Outline | null => {
    try {
      return jsonOutline(JSON.parse(text) as unknown, MAX_VALUES)
    } catch {
      return null
    }
  }, [text])
  if (!outlined) {
    return (
      <>
        <p className="wr-warn">This file does not read as JSON; here it is as written.</p>
        <pre className="wr-pre">{text}</pre>
      </>
    )
  }
  return (
    <div className="wr-json">
      {outlined.root ? <OutlineView node={outlined.root} /> : null}
      {outlined.hidden > 0 ? (
        <p className="wr-quiet" data-hidden={outlined.hidden}>
          {outlined.hidden.toLocaleString()} more {outlined.hidden === 1 ? 'entry' : 'entries'} not
          shown: the file is too long to show in full here.
        </p>
      ) : null}
    </div>
  )
}

/** Core's outline of a JSON value: names in small capitals, lists numbered, text as text. */
function OutlineView({ node }: { node: OutlineNode }): JSX.Element {
  switch (node.kind) {
    case 'none':
      return <span className="wr-json-none">none</span>
    case 'text':
      return <span className="wr-json-text">{node.text}</span>
    case 'plain':
      return <span className="wr-json-plain">{node.text}</span>
    case 'list':
      if (node.items.length === 0) return <span className="wr-json-none">(empty list)</span>
      return (
        <ol className="wr-json-list">
          {node.items.map((item, i) => (
            <li key={i}>
              <OutlineView node={item} />
            </li>
          ))}
        </ol>
      )
    case 'fields':
      if (node.fields.length === 0) return <span className="wr-json-none">(nothing)</span>
      return (
        <dl className="wr-json-obj">
          {node.fields.map((f) => (
            <div key={f.name} className="wr-json-row">
              <dt>{f.name}</dt>
              <dd>
                <OutlineView node={f.value} />
              </dd>
            </div>
          ))}
        </dl>
      )
  }
}
