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
import { validRepo, type ShelfConfig } from '@core/sync'
import { validSession } from '@core/control'
import { checkShelf } from '../platform/browser/shelf'
import { pushStoredBook } from '../platform/browser/shelf-save'
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
  clearShelf,
  shelfReady,
  controlConfig,
  loadControl,
  saveControl,
  type ControlSettings,
  loadApiKey,
  loadShelf,
  loadPrefs,
  maskApiKey,
  saveApiKey,
  saveShelf,
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
  const [shelf, setShelf] = useState<ShelfConfig>(() => loadShelf())
  const [shelfToken, setShelfToken] = useState('')
  const [shelfNote, setShelfNote] = useState<string | null>(null)
  const [shelfChecking, setShelfChecking] = useState(false)
  const [control, setControl] = useState<ControlSettings>(() => loadControl())
  const [controlToken, setControlToken] = useState('')
  const [controlNote, setControlNote] = useState<string | null>(null)
  /** Which book is being sent, so its button can say so and the rest wait. */
  const [sending, setSending] = useState<string | null>(null)
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

          {/* --- the shelf ------------------------------------------------ */}
          <section>
            <h2>Your shelf</h2>
            <p className="help">
              A repository of your own where books are kept whole — the transcription, every
              correction, the notes and introduction, the pictures, the fact bank and the design.
              Saved on its own whenever something is finished, so picking a book up on another
              device loses nothing. Like the API key, the token is stored only in this browser and
              sent only to GitHub; it is never written into a book file.
            </p>
            <p className="help">
              Use a <b>fine-grained</b> token with access to that repository alone and one
              permission: <b>Contents: Read and write</b>. Keep the repository <b>private</b> — your
              notes and introduction are the part of a reprint that is yours.
            </p>
            <label>
              Repository
              <input
                type="text"
                placeholder="owner/name"
                value={shelf.repo}
                onChange={(e) => setShelf({ ...shelf, repo: e.target.value })}
              />
            </label>
            <label>
              Branch
              <input
                type="text"
                placeholder="main"
                value={shelf.branch}
                onChange={(e) => setShelf({ ...shelf, branch: e.target.value })}
              />
            </label>
            {shelf.token ? (
              <p>
                Token stored: <code>{maskApiKey(shelf.token)}</code>
              </p>
            ) : (
              <p className="help">No token stored, so nothing is saved to a shelf yet.</p>
            )}
            <label>
              Token
              <input
                type="password"
                placeholder={shelf.token ? 'Replace with a different token' : 'github_pat_…'}
                value={shelfToken}
                onChange={(e) => setShelfToken(e.target.value)}
              />
            </label>
            {shelfNote ? <p className="help">{shelfNote}</p> : null}
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={shelfChecking || !validRepo(shelf.repo)}
                onClick={() => {
                  const next: ShelfConfig = {
                    ...shelf,
                    branch: shelf.branch.trim() || 'main',
                    token: shelfToken.trim() || shelf.token
                  }
                  setShelfChecking(true)
                  setShelfNote(null)
                  void checkShelf(next)
                    .then((info) => {
                      saveShelf(next)
                      setShelf(next)
                      setShelfToken('')
                      // Said plainly, because the first save is what publishes
                      // it and there is no taking a git history back.
                      setShelfNote(
                        info.private
                          ? `Connected to ${info.repo} — private, so what you save stays yours. ` +
                              'Books will be written there as you finish them.'
                          : `Connected to ${info.repo} — but it is PUBLIC. Anything saved there, ` +
                              'including your notes and introduction, becomes world-readable and ' +
                              'stays in the history for good. Make it private before saving a book.'
                      )
                    })
                    .catch((err: unknown) => {
                      setShelfNote(err instanceof Error ? err.message : String(err))
                    })
                    .finally(() => setShelfChecking(false))
                }}
              >
                {shelfChecking ? 'Checking…' : 'Connect'}
              </button>
              {shelf.token ? (
                <button
                  type="button"
                  onClick={() => {
                    clearShelf()
                    setShelf({ repo: '', branch: 'main', token: '' })
                    setShelfNote(
                      'Shelf forgotten on this device. Nothing in the repository changed.'
                    )
                  }}
                >
                  Forget this shelf
                </button>
              ) : null}
            </div>
          </section>

          {/* --- letting something else drive ------------------------------ */}
          <section>
            <h2>Letting something else drive</h2>
            <p className="help">
              A controller elsewhere — an assistant you are talking to, a script — can read the
              question on screen and answer it, through a repository you own. Commands are picked up
              from <code>control/&lt;session&gt;/inbox.json</code> and answered in{' '}
              <code>outbox.json</code> beside it. Off unless you turn it on.
            </p>
            <p className="help">
              <b>It cannot spend your money.</b> Every paid step in this app stops at a button that
              names a price, and nothing here can press that button — a controller can reach the
              quote and report the number to you, and the decision stays yours. The one place the
              app spends without quoting first, re-reading a leaf you marked at the uncertainty
              gate, is refused outright. Nor can it read or set your API key.
            </p>
            <p className="help">
              Every command and every snapshot of what is on screen lands in that repository's
              history, which cannot be taken back. Use a <b>private</b> one. It may be your shelf;
              leave the repository and token below blank to use it, or name a different one.
            </p>
            <label>
              Session name
              <input
                type="text"
                placeholder="laptop-1"
                value={control.session}
                onChange={(e) => setControl({ ...control, session: e.target.value })}
              />
            </label>
            <label>
              Repository
              <input
                type="text"
                placeholder={shelf.repo ? `${shelf.repo} (your shelf)` : 'owner/name'}
                value={control.repo}
                onChange={(e) => setControl({ ...control, repo: e.target.value })}
              />
            </label>
            <label>
              Token
              <input
                type="password"
                placeholder={
                  control.token ? 'Replace with a different token' : "blank — use the shelf's"
                }
                value={controlToken}
                onChange={(e) => setControlToken(e.target.value)}
              />
            </label>
            {controlNote ? <p className="help">{controlNote}</p> : null}
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={!validSession(control.session.trim())}
                onClick={() => {
                  const next: ControlSettings = {
                    ...control,
                    enabled: true,
                    session: control.session.trim(),
                    token: controlToken.trim() || control.token
                  }
                  const merged = controlConfig(next, loadShelf())
                  if (!merged.repo || !merged.token) {
                    setControlNote(
                      'No repository or token to use — set one here, or connect a shelf above.'
                    )
                    return
                  }
                  saveControl(next)
                  setControl(next)
                  setControlToken('')
                  setControlNote(
                    `On. Commands will be read from ${merged.repo}, in ` +
                      `control/${next.session}/inbox.json. The book screen says so while it is ` +
                      'running, and has a stop button.'
                  )
                }}
              >
                Turn it on
              </button>
              {control.enabled ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...control, enabled: false }
                    saveControl(next)
                    setControl(next)
                    setControlNote('Off. Nothing is read from the repository until you turn it on.')
                  }}
                >
                  Turn it off
                </button>
              ) : null}
            </div>
            {!validSession(control.session.trim()) && control.session.trim().length > 0 ? (
              <p className="help">
                A session name is lower-case letters, digits and hyphens — it becomes a path in the
                repository.
              </p>
            ) : null}
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
                      {/* First, and the only one here that does not destroy
                          something. A book read before there was a shelf to
                          send it to has no other way up: the automatic save
                          happens once, when the reading ends, and connecting a
                          repository afterwards does not go back for it. */}
                      <button
                        type="button"
                        className="primary"
                        disabled={sending !== null || !shelfReady(shelf)}
                        onClick={() => {
                          void (async () => {
                            setSending(run.key)
                            setNote(null)
                            try {
                              const result = await pushStoredBook(shelf, run.key)
                              setNote(result.note)
                            } catch (err) {
                              setNote(
                                `Could not send “${run.fileName}” to the shelf: ` +
                                  `${err instanceof Error ? err.message : String(err)}. ` +
                                  'Nothing on this device changed.'
                              )
                            } finally {
                              setSending(null)
                            }
                          })()
                        }}
                      >
                        {sending === run.key ? 'Sending…' : 'Send to the shelf'}
                      </button>
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
            <p className="help">
              {shelfReady(shelf)
                ? 'Sending a book to the shelf copies the whole record to your repository — the ' +
                  'reading, every correction, the notes and the fact bank — and the scan with it ' +
                  'when this device still has one. A book whose scan is not kept still goes up: ' +
                  'enough to open it anywhere, not enough to check a word against the page. ' +
                  'Sending the same book twice replaces it rather than adding a second copy.'
                : 'Connect a shelf above and each book here can be sent to it. Books read before ' +
                  'a shelf was connected are not sent automatically — this is how they get there.'}
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
