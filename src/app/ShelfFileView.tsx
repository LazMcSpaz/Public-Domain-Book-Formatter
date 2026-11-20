/**
 * A file from the shelf, opened in a plain reading view inside the Workroom:
 * a Markdown sheet as text with headings and lists, a JSON file laid out as
 * an outline, plain text as it is, a picture as a picture. Never a raw GitHub
 * page. Read through the shelf connection (`getText`, `getBytes`), so every
 * read is the shelf's current copy.
 */
import { useEffect, useMemo, useState } from 'react'
import { linkLabel, type ShelfConfig } from '@core/sync'
import { linkOpens, markdownBlocks } from '@core/work'
import { getBytes, getText } from '../platform/browser/shelf'
import { MarkdownView } from './MarkdownView'

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
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
  const parsed = useMemo((): { ok: true; value: unknown } | { ok: false } => {
    try {
      return { ok: true, value: JSON.parse(text) as unknown }
    } catch {
      return { ok: false }
    }
  }, [text])
  if (!parsed.ok) {
    return (
      <>
        <p className="wr-warn">This file does not read as JSON; here it is as written.</p>
        <pre className="wr-pre">{text}</pre>
      </>
    )
  }
  // Built by plain calls, not components, so the count is spent in order
  // before the note under it is decided.
  const budget = { left: MAX_VALUES }
  const tree = outline(parsed.value, budget)
  return (
    <div className="wr-json">
      {tree}
      {budget.left < 0 ? (
        <p className="wr-quiet">The rest of this file is too long to show here.</p>
      ) : null}
    </div>
  )
}

/** A JSON value as an outline: names in small capitals, lists numbered, text as text. */
function outline(value: unknown, budget: { left: number }): JSX.Element | null {
  if (--budget.left < 0) return null
  if (value === null) return <span className="wr-json-none">none</span>
  if (typeof value === 'string') return <span className="wr-json-text">{value}</span>
  if (typeof value === 'boolean')
    return <span className="wr-json-plain">{value ? 'yes' : 'no'}</span>
  if (typeof value === 'number') return <span className="wr-json-plain">{value}</span>
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="wr-json-none">(empty list)</span>
    return (
      <ol className="wr-json-list">
        {value.map((v, i) => (
          <li key={i}>{outline(v, budget)}</li>
        ))}
      </ol>
    )
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return <span className="wr-json-none">(nothing)</span>
  return (
    <dl className="wr-json-obj">
      {entries.map(([k, v]) => (
        <div key={k} className="wr-json-row">
          <dt>{k}</dt>
          <dd>{outline(v, budget)}</dd>
        </div>
      ))}
    </dl>
  )
}
