/**
 * A Markdown sheet drawn plainly, from core's blocks (`markdownBlocks`):
 * headings, paragraphs, lists, quotes, tables and code, as React elements.
 * Nothing in a sheet is ever handed to the page as HTML. A link to another
 * file on the shelf opens it the Workroom's way; a web link opens in a new
 * tab; anything else is shown as its words.
 */
import { Fragment } from 'react'
import { isWebLink, shelfLinkFrom, type MdBlock, type Span } from '@core/work'

export function MarkdownView({
  blocks,
  from,
  openPath
}: {
  blocks: readonly MdBlock[]
  /** The sheet's own path, which relative links are read from. */
  from: string
  openPath: (path: string) => void
}): JSX.Element {
  const spans = (list: readonly Span[]): JSX.Element[] =>
    list.map((s, i) => {
      switch (s.kind) {
        case 'text':
          return <Fragment key={i}>{s.text}</Fragment>
        case 'code':
          return <code key={i}>{s.text}</code>
        case 'strong':
          return <strong key={i}>{spans(s.spans)}</strong>
        case 'em':
          return <em key={i}>{spans(s.spans)}</em>
        case 'link': {
          const onShelf = shelfLinkFrom(from, s.href)
          if (onShelf) {
            return (
              <button
                key={i}
                type="button"
                className="wr-inline-link"
                title={onShelf}
                onClick={() => openPath(onShelf)}
              >
                {spans(s.spans)}
              </button>
            )
          }
          if (isWebLink(s.href)) {
            return (
              <a key={i} href={s.href} target="_blank" rel="noopener noreferrer">
                {spans(s.spans)}
              </a>
            )
          }
          return <Fragment key={i}>{spans(s.spans)}</Fragment>
        }
      }
    })

  const block = (b: MdBlock, i: number): JSX.Element => {
    switch (b.kind) {
      case 'heading': {
        const level = Math.min(6, b.level + 1)
        const Tag = `h${level}` as 'h2'
        return <Tag key={i}>{spans(b.spans)}</Tag>
      }
      case 'paragraph':
        return <p key={i}>{spans(b.spans)}</p>
      case 'rule':
        return <hr key={i} />
      case 'code':
        return <pre key={i}>{b.text}</pre>
      case 'quote':
        return <blockquote key={i}>{b.blocks.map(block)}</blockquote>
      case 'list': {
        const items = b.items.map((item, j) => (
          <li key={j} style={{ marginLeft: `${item.depth * 1.4}em` }}>
            {item.check === null ? null : item.check ? '☑ ' : '☐ '}
            {spans(item.spans)}
          </li>
        ))
        return b.ordered ? (
          <ol key={i} start={b.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        )
      }
      case 'table':
        return (
          <div key={i} className="wr-table-wrap">
            <table>
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j}>{spans(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, j) => (
                      <td key={j}>{spans(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    }
  }

  return <div className="wr-md">{blocks.map(block)}</div>
}
