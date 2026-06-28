/**
 * ProfileManager — the saved-profile bank (SPEC §7, state 3). Lists profiles
 * persisted in the app-level store, lets the user save the current working
 * profile as a new bank entry, rename/delete entries, load one back into the
 * editor, and *apply* one to the open book (which dispatches SET_STYLE_PROFILE
 * and persists the project so the choice survives a reload).
 */
import { useCallback, useState } from 'react'
import type { StyleProfile } from '@core/model'
import { useReview } from '../../store/ReviewContext'

/** Reasonably-unique profile id (crypto.randomUUID where available). */
function newProfileId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return `style_${c.randomUUID()}`
  return `style_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

interface ProfileManagerProps {
  /** The current in-editor working profile (drives "Save as profile"). */
  working: StyleProfile
  /** Saved profiles loaded from the store. */
  saved: StyleProfile[]
  /** Id applied to the open book, or null (shipped default). */
  appliedId: string | null
  /** Re-fetch saved profiles after a mutation. */
  onRefresh: () => Promise<StyleProfile[]>
  /** Load a saved profile back into the editor. */
  onLoadWorking: (profile: StyleProfile) => void
  /** Dispatch the applied-profile selection into review state. */
  onApply: (id: string | null) => void
}

export function ProfileManager({
  working,
  saved,
  appliedId,
  onRefresh,
  onLoadWorking,
  onApply
}: ProfileManagerProps): JSX.Element {
  const { state } = useReview()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const onSaveAs = useCallback(() => {
    const name = newName.trim() || working.name || 'Untitled profile'
    void run(async () => {
      const profile: StyleProfile = { ...working, id: newProfileId(), name }
      await window.api.saveStyleProfile(profile)
      setNewName('')
      await onRefresh()
    })
  }, [newName, working, run, onRefresh])

  const onRename = useCallback(
    (profile: StyleProfile) => {
      const next = window.prompt('Rename profile', profile.name)
      if (next == null) return
      const name = next.trim()
      if (!name || name === profile.name) return
      void run(async () => {
        await window.api.saveStyleProfile({ ...profile, name })
        await onRefresh()
      })
    },
    [run, onRefresh]
  )

  const onDelete = useCallback(
    (profile: StyleProfile) => {
      void run(async () => {
        await window.api.deleteStyleProfile(profile.id)
        await onRefresh()
        // If the deleted profile was applied, fall back to the shipped default.
        if (appliedId === profile.id) onApply(null)
      })
    },
    [run, onRefresh, appliedId, onApply]
  )

  const onApplyToBook = useCallback(
    (id: string | null) => {
      onApply(id)
      const project = state.project
      const projectPath = state.projectPath
      if (!project || !projectPath) return
      // Persist the applied profile so the choice survives a reload (SPEC §9).
      void run(async () => {
        await window.api.saveProject(projectPath, {
          ...project,
          styleProfileId: id
        })
      })
    },
    [onApply, state.project, state.projectPath, run]
  )

  const canApplyToBook = state.project != null && state.projectPath != null

  return (
    <aside className="profile-manager">
      <header className="pm-header">
        <h3>Profiles</h3>
        <span className="pm-applied">Applied: {appliedId ? appliedId : 'shipped default'}</span>
      </header>

      <div className="pm-saveas">
        <input
          type="text"
          placeholder={working.name || 'Profile name'}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="button" onClick={onSaveAs} disabled={busy}>
          Save as profile
        </button>
      </div>

      {error ? <p className="error pm-error">{error}</p> : null}

      {saved.length === 0 ? (
        <p className="panel-empty">No saved profiles yet.</p>
      ) : (
        <ul className="pm-list">
          {saved.map((p) => (
            <li key={p.id} className={`pm-item${p.id === appliedId ? ' pm-item-applied' : ''}`}>
              <div className="pm-item-main">
                <span className="pm-item-name">{p.name}</span>
                <span className="pm-item-meta">
                  {p.trimSize.replace('x', '×')} · {p.bodyFont} {p.bodyFontSize}pt
                </span>
              </div>
              <div className="pm-item-actions">
                <button
                  type="button"
                  onClick={() => onApplyToBook(p.id)}
                  disabled={busy || !canApplyToBook}
                  title={
                    canApplyToBook ? 'Apply this profile to the open book' : 'Open a book to apply'
                  }
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => onLoadWorking(p)}
                  disabled={busy}
                  title="Load into the editor"
                >
                  Edit
                </button>
                <button type="button" onClick={() => onRename(p)} disabled={busy}>
                  Rename
                </button>
                <button
                  type="button"
                  className="pm-delete"
                  onClick={() => onDelete(p)}
                  disabled={busy}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="pm-footer">
        <button
          type="button"
          onClick={() => onApplyToBook(null)}
          disabled={busy || !canApplyToBook || appliedId === null}
          title="Revert the book to the shipped default look"
        >
          Use shipped default
        </button>
      </div>
    </aside>
  )
}
