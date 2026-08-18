/**
 * Settings — the other half of "design by interview".
 *
 * The interview does the bulk of the work up front so nobody has to know what a
 * gutter is before they can start. It was never meant to be the *only* way in:
 * `design-interview.ts` has always said the detailed controls "stay available
 * behind *anything you'd change?* but are never the front door". This is that
 * door, and it holds three kinds of thing the flow cannot:
 *
 * - **decisions already made**, so they can be changed — the API key, whether
 *   scans are kept, which model to reach for by default;
 * - **the detailed style controls**, including five fields no question ever set,
 *   so they sat at their shipped values for every book ever made;
 * - **data management**, which is not a question at all — what is stored, what
 *   it costs, and how to be rid of it.
 *
 * Questions are reused rather than reinvented: the style editor emits
 * `Question[]` and `QuestionView` renders it, so a field added in
 * `@core/style/editable` needs no code here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnswerValue, Answers } from '@core/wizard'
import { QuestionView } from './QuestionView'
import { BODY_FONTS } from '@core/design'
import {
  applyStyleAnswers,
  defaultStyleProfile,
  describeSavedProfile,
  newSavedProfile,
  styleQuestions,
  type SavedStyleProfile
} from '@core/style'
import type { StyleProfile } from '@core/model'
import { describeAge, type SavedRunSummary } from '@core/project'
import {
  deleteAllSourceFiles,
  deleteProfile,
  deleteRecon,
  deleteRun,
  deleteSourceFile,
  deleteAllRecons,
  deleteAnnotationCheckpoint,
  listProfiles,
  listRuns,
  saveProfile,
  storedFileSizes,
  storedReconSizes
} from '../platform/browser/run-store'
import {
  clearApiKey,
  clearReviewProgress,
  formatBytes,
  loadApiKey,
  loadPrefs,
  maskApiKey,
  saveApiKey,
  savePrefs,
  storageEstimate,
  type AppPrefs
} from '../platform/browser/settings'

/** The shipped defaults, edited here, apply to every book that starts fresh. */
const DEFAULT_LOOK_ID = 'shipped-default'

export interface SettingsProps {
  onClose: () => void
}

export function Settings({ onClose }: SettingsProps): JSX.Element {
  const [prefs, setPrefs] = useState<AppPrefs>(() => loadPrefs())
  const [apiKey, setKey] = useState(() => loadApiKey())
  const [keyDraft, setKeyDraft] = useState('')
  const [runs, setRuns] = useState<SavedRunSummary[]>([])
  const [sizes, setSizes] = useState<Map<string, number>>(new Map())
  /**
   * What the *readings* of the scans take up.
   *
   * Kept apart from the scans themselves because they answer different
   * questions: a scan is reopened without the file picker, a reading is the ten
   * minutes of OCR that does not have to run again. Someone reclaiming space
   * should be able to see which of the two is costing them.
   */
  const [readSizes, setReadSizes] = useState<Map<string, number>>(new Map())
  const [profiles, setProfiles] = useState<SavedStyleProfile[]>([])
  const [estimate, setEstimate] = useState<{ quota: number; usage: number } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [styleAnswers, setStyleAnswers] = useState<Answers>({})
  const [note, setNote] = useState<string | null>(null)
  /**
   * A pending destructive action, held until it is confirmed.
   *
   * Only the irreversible ones ask. Removing a scan costs a trip to the file
   * picker and does not, because a confirmation on everything teaches people to
   * dismiss confirmations — which is how the one that mattered gets clicked
   * through.
   */
  const [pending, setPending] = useState<{
    prompt: string
    detail: string
    run: () => Promise<void>
  } | null>(null)

  const refresh = useCallback(async () => {
    setRuns(await listRuns())
    setSizes(await storedFileSizes())
    setReadSizes(await storedReconSizes())
    setProfiles(await listProfiles())
    setEstimate(await storageEstimate())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const update = useCallback((patch: Partial<AppPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  /** The look being edited: a banked one, or the shipped defaults. */
  const editingProfile: StyleProfile | null = useMemo(() => {
    if (editing === null) return null
    if (editing === DEFAULT_LOOK_ID) return loadDefaultLook()
    return profiles.find((p) => p.id === editing)?.style ?? null
  }, [editing, profiles])

  const questions = useMemo(
    () =>
      editingProfile
        ? styleQuestions(editingProfile, {
            families: BODY_FONTS.map((f) => ({
              value: f.family,
              label: f.label,
              description: f.note
            }))
          })
        : [],
    [editingProfile]
  )

  const saveStyle = useCallback(async () => {
    if (!editingProfile || editing === null) return
    const next = applyStyleAnswers(editingProfile, styleAnswers)
    if (editing === DEFAULT_LOOK_ID) {
      saveDefaultLook(next)
      setNote('Saved. New books start from this look.')
    } else {
      const existing = profiles.find((p) => p.id === editing)
      if (existing) {
        await saveProfile(
          newSavedProfile({
            id: existing.id,
            name: existing.name,
            style: next,
            imprint: existing.imprint
          })
        )
        setNote(`Saved “${existing.name}”.`)
      }
    }
    setEditing(null)
    setStyleAnswers({})
    await refresh()
  }, [editing, editingProfile, styleAnswers, profiles, refresh])

  const totalScans = [...sizes.values()].reduce((a, b) => a + b, 0)
  const totalReadings = [...readSizes.values()].reduce((a, b) => a + b, 0)

  return (
    <div className="settings">
      <div className="settings-head">
        <h1>Settings</h1>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>

      {note ? <p className="help">{note}</p> : null}

      {pending ? (
        <div className="confirm">
          <p>
            <strong>{pending.prompt}</strong>
          </p>
          <p className="help">{pending.detail}</p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                void (async () => {
                  await pending.run()
                  setPending(null)
                  await refresh()
                })()
              }}
            >
              Yes, do it
            </button>
            <button type="button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* --- the style editor, when one is open --------------------------- */}
      {editingProfile ? (
        <section>
          <h2>
            {editing === DEFAULT_LOOK_ID
              ? 'The look new books start from'
              : `Editing “${profiles.find((p) => p.id === editing)?.name ?? ''}”`}
          </h2>
          <p className="help">
            These are the controls the interview sets for you. Changing one here changes it for
            every book that uses this look — not for books already finished.
          </p>
          {questions.map((q) => (
            <QuestionView
              key={q.id}
              question={q}
              value={styleAnswers[q.id]}
              onChange={(v: AnswerValue) => setStyleAnswers((a) => ({ ...a, [q.id]: v }))}
            />
          ))}
          <div className="actions">
            <button type="button" className="primary" onClick={() => void saveStyle()}>
              Save this look
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setStyleAnswers({})
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <>
          {/* --- looks ---------------------------------------------------- */}
          <section>
            <h2>Looks</h2>
            <p className="help">
              A look is the reusable half of a design — trim, typefaces, margins, running heads,
              ornaments. Nothing about a particular book is kept in one.
            </p>
            <ul className="notes">
              <li>
                <strong>Shipped default</strong> — what a book starts from when you don’t reuse a
                look.
                <div className="actions">
                  <button type="button" onClick={() => setEditing(DEFAULT_LOOK_ID)}>
                    Edit
                  </button>
                </div>
              </li>
              {profiles.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong> — {describeSavedProfile(p)}
                  <div className="actions">
                    <button type="button" onClick={() => setEditing(p.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPending({
                          prompt: `Delete the look “${p.name}”?`,
                          detail:
                            'Books already made with it keep their design. Nothing else here ' +
                            'changes, but the look itself cannot be brought back.',
                          run: async () => {
                            await deleteProfile(p.id)
                            setNote(`Deleted “${p.name}”.`)
                          }
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* --- the API key ---------------------------------------------- */}
          <section>
            <h2>Anthropic API key</h2>
            <p className="help">
              Stored only in this browser and sent straight to Anthropic. There is no server here to
              proxy through, and it is never saved into a book.
            </p>
            {apiKey ? (
              <p>
                Currently set: <code>{maskApiKey(apiKey)}</code>
              </p>
            ) : (
              <p className="help">No key stored. You will be asked for one before a paid run.</p>
            )}
            <input
              type="password"
              placeholder={apiKey ? 'Replace with a different key' : 'sk-ant-…'}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={keyDraft.trim().length === 0}
                onClick={() => {
                  saveApiKey(keyDraft)
                  setKey(keyDraft.trim())
                  setKeyDraft('')
                  setNote('Key saved.')
                }}
              >
                Save key
              </button>
              {apiKey ? (
                <button
                  type="button"
                  onClick={() => {
                    clearApiKey()
                    setKey('')
                    setNote('Key removed from this browser.')
                  }}
                >
                  Remove key
                </button>
              ) : null}
            </div>
          </section>

          {/* --- run defaults --------------------------------------------- */}
          <section>
            <h2>Reading defaults</h2>
            <p className="help">
              What the transcribe step starts from. You can still change either for a particular
              book.
            </p>
            <label>
              Model
              <select value={prefs.modelId} onChange={(e) => update({ modelId: e.target.value })}>
                <option value="claude-opus-5">Opus — highest quality</option>
                <option value="claude-sonnet-5">Sonnet — balanced</option>
                <option value="claude-haiku-4-5-20251001">Haiku — cheapest</option>
              </select>
            </label>
            <label>
              Page image sent to the model
              <select
                value={String(prefs.imageLongEdge)}
                onChange={(e) => update({ imageLongEdge: Number(e.target.value) })}
              >
                <option value="1092">Smaller — 1092px, cheapest</option>
                <option value="1568">Standard — 1568px</option>
                <option value="2000">Larger — 2000px, best on damaged scans</option>
              </select>
            </label>
            <p className="help">
              The main lever on what a book costs: the image is most of what you pay for per page.
              Smaller is cheaper and weaker on faint or damaged print.
            </p>
          </section>

          {/* --- storage --------------------------------------------------- */}
          <section>
            <h2>Storage on this device</h2>
            {estimate ? (
              <p className="help">
                Using {formatBytes(estimate.usage)} of about {formatBytes(estimate.quota)} this
                browser allows. Scans account for {formatBytes(totalScans)} of it, and the readings
                of them for {formatBytes(totalReadings)}.
              </p>
            ) : (
              <p className="help">This browser will not say how much room it allows.</p>
            )}

            <label>
              <input
                type="checkbox"
                checked={prefs.keepScans !== false}
                onChange={(e) => update({ keepScans: e.target.checked })}
              />{' '}
              Keep scans, so a book reopens without the file picker
            </label>
            <div className="actions">
              <button
                type="button"
                onClick={() =>
                  setPending({
                    prompt: 'Remove every stored scan?',
                    detail:
                      'The transcriptions stay — this only frees the space the PDFs take. You ' +
                      'will be asked to choose the file again when you reopen a book.',
                    run: async () => {
                      const n = await deleteAllSourceFiles()
                      setNote(`Removed ${n} stored scan(s). The transcriptions are untouched.`)
                    }
                  })
                }
              >
                Remove every stored scan
              </button>
              <button
                type="button"
                onClick={() =>
                  setPending({
                    prompt: 'Remove every stored reading?',
                    detail:
                      'The transcriptions and the scans stay. Reopening a book will render ' +
                      'and re-read it, which costs nothing but time.',
                    run: async () => {
                      const n = await deleteAllRecons()
                      setNote(`Removed ${n} stored reading(s). Nothing paid for was touched.`)
                    }
                  })
                }
              >
                Remove every stored reading
              </button>
            </div>

            <h3>Books</h3>
            {runs.length === 0 ? (
              <p className="help">Nothing stored yet.</p>
            ) : (
              <ul className="notes">
                {runs.map((run) => (
                  <li key={run.key}>
                    <strong>{run.fileName}</strong> — {run.pageCount} page
                    {run.pageCount === 1 ? '' : 's'}
                    {run.complete ? '' : ', stopped partway'} · {describeAge(run.savedAt)}
                    {sizes.has(run.key)
                      ? ` · scan ${formatBytes(sizes.get(run.key) ?? 0)}`
                      : ' · scan not kept'}
                    <div className="actions">
                      {sizes.has(run.key) ? (
                        <button
                          type="button"
                          onClick={() => {
                            void (async () => {
                              await deleteSourceFile(run.key)
                              setNote(`Removed the scan of “${run.fileName}”.`)
                              await refresh()
                            })()
                          }}
                        >
                          Remove the scan
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          setPending({
                            prompt: `Delete the transcription of “${run.fileName}”?`,
                            detail:
                              `${run.pageCount} page(s) that were paid for. This cannot be ` +
                              'undone, and reading the book again would cost the same as the ' +
                              'first time. Corrections made at the proof step go with it.',
                            run: async () => {
                              await deleteRun(run.key)
                              // The verdicts belong to the transcription they
                              // were made against. Leaving them behind would
                              // put someone's old "looks fine" onto a re-read
                              // of the same file.
                              clearReviewProgress(run.key)
                              await deleteSourceFile(run.key)
                              // And the reading of it, which is the same size
                              // as the scan and useful for nothing else.
                              await deleteRecon(run.key)
                              // Notes bought against a transcription that is
                              // being deleted quote a book this device will no
                              // longer have.
                              await deleteAnnotationCheckpoint(run.key)
                              setNote(`Deleted the transcription of “${run.fileName}”.`)
                            }
                          })
                        }
                      >
                        Delete the transcription
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="help">
              Deleting a transcription cannot be undone, and it is the one thing here you paid for.
              Removing a scan only costs you the file picker.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

/* --- the shipped default look, once it has been edited ------------------- */

const DEFAULT_LOOK_STORAGE = 'pdbf.defaultLook'

/**
 * The starting look, as edited.
 *
 * Kept in `localStorage` beside the other preferences rather than in the
 * profile store: it is not a *banked* look — it has no name and cannot be
 * deleted — it is what this device means by "no look chosen". Falls back to the
 * shipped values, so a browser that has never been here behaves as it always
 * did.
 */
export function loadDefaultLook(): StyleProfile {
  try {
    const raw = localStorage.getItem(DEFAULT_LOOK_STORAGE)
    if (!raw) return defaultStyleProfile()
    return { ...defaultStyleProfile(), ...(JSON.parse(raw) as Partial<StyleProfile>) }
  } catch {
    return defaultStyleProfile()
  }
}

export function saveDefaultLook(profile: StyleProfile): void {
  try {
    localStorage.setItem(DEFAULT_LOOK_STORAGE, JSON.stringify(profile))
  } catch {
    // Storage refused; the look stays as shipped, which is a working book.
  }
}
