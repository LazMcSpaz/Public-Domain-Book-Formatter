/**
 * FrontMatter — the templated front/back-matter forms (SPEC §7). Two cards:
 *
 *  • Title page — title + author, which live on the per-book config and are
 *    patched via PATCH_PROJECT { config: { ... } }.
 *  • Copyright / edition page — ISBN, publication date, edition statement,
 *    imprint, copyright holder, and free-text notices, which live on
 *    project.frontMatter and are patched via PATCH_FRONT_MATTER.
 *
 * Self-contained: reads from useReview(), dispatches actions. No props.
 */
import { useCallback } from 'react'
import type { FrontMatterFields, PerBookConfig } from '@core/model'
import { useReview } from '../../store/ReviewContext'
import './FrontMatter.css'

export function FrontMatter(): JSX.Element {
  const { state, dispatch } = useReview()
  const project = state.project

  const patchConfig = useCallback(
    (patch: Partial<PerBookConfig>) => {
      if (!project) return
      dispatch({ type: 'PATCH_PROJECT', patch: { config: { ...project.config, ...patch } } })
    },
    [project, dispatch]
  )

  const patchFront = useCallback(
    (patch: Partial<FrontMatterFields>) => {
      dispatch({ type: 'PATCH_FRONT_MATTER', patch })
    },
    [dispatch]
  )

  if (!project) {
    return (
      <div className="front-matter">
        <p className="panel-empty">Open a book to edit its front matter.</p>
      </div>
    )
  }

  const config = project.config
  const fm = project.frontMatter
  const notices = fm.notices ?? []

  const setNotice = (index: number, value: string): void => {
    const next = notices.slice()
    next[index] = value
    patchFront({ notices: next })
  }

  const addNotice = (): void => {
    patchFront({ notices: [...notices, ''] })
  }

  const removeNotice = (index: number): void => {
    patchFront({ notices: notices.filter((_, i) => i !== index) })
  }

  return (
    <div className="front-matter">
      <header className="fm-header">
        <h2>Front matter</h2>
        <p className="fm-subhead">
          Fill in the templated title and copyright pages for this book.
        </p>
      </header>

      {/* --- Title page --- */}
      <section className="fm-card">
        <h3>Title page</h3>
        <label className="fm-field">
          <span className="fm-field-label">Title</span>
          <input
            type="text"
            value={config.title}
            onChange={(e) => patchConfig({ title: e.target.value })}
            placeholder="Book title"
          />
        </label>
        <label className="fm-field">
          <span className="fm-field-label">Author</span>
          <input
            type="text"
            value={config.author}
            onChange={(e) => patchConfig({ author: e.target.value })}
            placeholder="Author name"
          />
        </label>
      </section>

      {/* --- Copyright / edition page --- */}
      <section className="fm-card">
        <h3>Copyright &amp; edition page</h3>
        <div className="fm-grid">
          <label className="fm-field">
            <span className="fm-field-label">ISBN</span>
            <input
              type="text"
              value={fm.isbn ?? ''}
              onChange={(e) => patchFront({ isbn: e.target.value.trim() || null })}
              placeholder="978-…"
            />
          </label>
          <label className="fm-field">
            <span className="fm-field-label">Publication date</span>
            <input
              type="text"
              value={fm.publicationDate ?? ''}
              onChange={(e) =>
                patchFront({ publicationDate: e.target.value.trim() || null })
              }
              placeholder="e.g. 2026"
            />
          </label>
          <label className="fm-field">
            <span className="fm-field-label">Edition statement</span>
            <input
              type="text"
              value={fm.editionStatement ?? ''}
              onChange={(e) =>
                patchFront({ editionStatement: e.target.value.trim() || null })
              }
              placeholder="e.g. First reprint edition"
            />
          </label>
          <label className="fm-field">
            <span className="fm-field-label">Imprint</span>
            <input
              type="text"
              value={fm.imprint ?? ''}
              onChange={(e) => patchFront({ imprint: e.target.value.trim() || null })}
              placeholder="Imprint / publisher"
            />
          </label>
          <label className="fm-field">
            <span className="fm-field-label">Copyright holder</span>
            <input
              type="text"
              value={fm.copyrightHolder ?? ''}
              onChange={(e) =>
                patchFront({ copyrightHolder: e.target.value.trim() || null })
              }
              placeholder="© holder"
            />
          </label>
        </div>

        <div className="fm-notices">
          <div className="fm-notices-head">
            <span className="fm-field-label">Notices</span>
            <button type="button" onClick={addNotice}>
              + Notice
            </button>
          </div>
          {notices.length === 0 ? (
            <p className="panel-empty">No extra notices.</p>
          ) : (
            <ul className="fm-notice-list">
              {notices.map((notice, index) => (
                <li className="fm-notice-item" key={index}>
                  <input
                    type="text"
                    value={notice}
                    onChange={(e) => setNotice(index, e.target.value)}
                    placeholder="Free-text line for the copyright page"
                  />
                  <button
                    type="button"
                    className="fm-notice-remove"
                    onClick={() => removeNotice(index)}
                    title="Remove notice"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
