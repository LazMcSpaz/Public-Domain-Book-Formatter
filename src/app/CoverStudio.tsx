/**
 * The cover studio.
 *
 * A standalone route (`#cover`) rather than a stage of the wizard, for one
 * reason: covers are wanted for books this app never set. A reprint whose
 * interior came from somewhere else still needs a KDP-legal sheet with the
 * right spine on it, and making that depend on running a scan through OCR
 * first would be an arbitrary toll. The export screen links straight in with
 * everything already known — the measured page count above all — so the book
 * that *was* set here pays no price for the arm being independent.
 *
 * The screen is the two halves of the app's philosophy side by side: the
 * interview on the left, and on the right the cover itself, rendered from the
 * PDF bytes that the download button hands over. Nothing on this screen is a
 * mock-up of the deliverable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnswerValue, Answers, Question } from '@core/wizard'
import { defaultAnswers, groupQuestions } from '@core/wizard'
import {
  applyCoverLook,
  artFrame,
  buildArtPrompt,
  checkResolution,
  coverFromAnswers,
  coverFromInterior,
  coverQuestions,
  defaultCover,
  describeGeometry,
  describeProvenance,
  coverGeometry,
  newSavedCoverLook,
  requiredPixels,
  SUGGESTED_ART_MODELS,
  type ArtBrief,
  type CoverDocument,
  type CoverInterviewState,
  type PlateOffer,
  type SavedCoverLook
} from '@core/cover'
import { fixedWidthMeasurer } from '@core/layout'
import { QuestionView } from './QuestionView'
import { downloadPdf } from '../platform/browser/download'
import {
  releaseCoverPreview,
  renderCoverPreview,
  type CoverPreview
} from '../platform/browser/cover-preview'
import { listCoverLooks, saveCoverLook } from '../platform/browser/run-store'
import { loadReplicateToken, saveReplicateToken } from '../platform/browser/settings'
import {
  canReachReplicate,
  forgetReplicateReach,
  generateCoverArt
} from '../platform/browser/replicate'
import { readMarkFile } from '../platform/browser/press-mark'
import { coverHandoffPlates, takeCoverHandoffFacts } from './cover-handoff'

/**
 * The preview is re-rendered on a pause, not on a keystroke.
 *
 * Writing a PDF and rasterising it is a few hundred milliseconds; doing that
 * per character typed into the blurb would make the field unusable. Long enough
 * to finish a word, short enough that it feels live.
 */
const PREVIEW_DEBOUNCE_MS = 400

/**
 * Which groups are open on arrival.
 *
 * The sheet, the look, the words and the choice of picture are the decisions
 * that make a cover; the palette, the ornament, the back-cover copy and the
 * generation brief are refinements of those, and putting all eight on screen at
 * once turns an interview into the panel of forty fields the design gate exists
 * not to be. The refinements are one click away and nothing is hidden — a
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
  'group-back': 'The back cover',
  'group-generate': 'Making a picture'
}

function CoverGroup({ id, children }: { id: string; children: React.ReactNode }): JSX.Element {
  if (OPEN_GROUPS.has(id)) return <section className="q-group">{children}</section>
  return (
    <details className="q-group">
      <summary>{GROUP_TITLE[id] ?? 'More'}</summary>
      {children}
    </details>
  )
}

function fileName(doc: CoverDocument): string {
  const slug =
    doc.content.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'cover'
  return `${slug}-cover.pdf`
}

export function CoverStudio({ onClose }: { onClose: () => void }): JSX.Element {
  const handoff = useMemo(() => takeCoverHandoffFacts(), [])
  const plateSource = useMemo(() => coverHandoffPlates(), [])

  const [doc, setDoc] = useState<CoverDocument>(() =>
    handoff
      ? coverFromInterior({
          trimSize: handoff.trimSize,
          pageCount: handoff.pageCount,
          title: handoff.title,
          author: handoff.author,
          imprint: handoff.imprint
        })
      : defaultCover()
  )
  const [answers, setAnswers] = useState<Answers>({})
  const [banked, setBanked] = useState<SavedCoverLook[]>([])
  const [preview, setPreview] = useState<CoverPreview | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  // The cover's picture, kept as bytes here rather than in the document — the
  // same split the interior uses, and the reason a `CoverDocument` stays
  // serializable and small enough to bank.
  const [artBytes, setArtBytes] = useState<Map<string, Uint8Array>>(new Map())

  const [token, setToken] = useState(() => loadReplicateToken())
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [genNotes, setGenNotes] = useState<string[]>([])
  const [lookName, setLookName] = useState('')
  const [savedNote, setSavedNote] = useState<string | null>(null)
  /**
   * Why the picture the user chose is not on the cover.
   *
   * A file that fails to decode used to leave the studio looking exactly as it
   * did before the upload, which reads as "nothing happened" and sends someone
   * to click the same broken file again.
   */
  const [artError, setArtError] = useState<string | null>(null)

  const previewRef = useRef<CoverPreview | null>(null)

  useEffect(() => {
    void listCoverLooks().then(setBanked)
  }, [])

  // Ask Replicate once whether a browser may talk to it at all, and only when
  // there is a token to ask with. See `platform/browser/replicate` — this is
  // the same probe-don't-assume treatment the batch API gets.
  useEffect(() => {
    if (!token.trim()) {
      setReachable(null)
      return
    }
    let live = true
    void canReachReplicate(token).then((ok) => {
      if (live) setReachable(ok)
    })
    return () => {
      live = false
    }
  }, [token])

  const source = (
    typeof answers['cover-art-source'] === 'string' ? answers['cover-art-source'] : ''
  ) as CoverInterviewState['artSource'] | ''

  const state: CoverInterviewState = useMemo(
    () => ({
      doc,
      pageCountMeasured: handoff?.pageCountMeasured ?? false,
      bankedLooks: banked,
      plates: plateSource.offers,
      hasReplicateToken: token.trim().length > 0,
      replicateAvailable: reachable,
      // What the user has already said about where the picture comes from, so
      // the interview can withdraw the questions that belong to the other
      // doors rather than showing a model chooser to someone with a file.
      ...(source ? { artSource: source } : {})
    }),
    [doc, handoff, banked, plateSource.offers, token, reachable, source]
  )

  const questions = useMemo(() => coverQuestions(state), [state])
  const groups = useMemo(() => groupQuestions(questions), [questions])

  // Seed any question that has appeared since the last answer was given, so a
  // newly-relevant question arrives at its recommendation rather than blank.
  useEffect(() => {
    setAnswers((current) => {
      const defaults = defaultAnswers(questions)
      let changed = false
      const next = { ...current }
      for (const [id, value] of Object.entries(defaults)) {
        if (!(id in next)) {
          next[id] = value
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [questions])

  const onAnswer = useCallback(
    (question: Question, value: AnswerValue) => {
      setAnswers((current) => {
        const next = { ...current, [question.id]: value }
        setDoc((base) => coverFromAnswers(base, next))
        return next
      })
    },
    [setDoc]
  )

  // Applying a banked look is its own action rather than an answer, because it
  // *replaces* the look wholesale and the answers on screen have to follow it.
  useEffect(() => {
    const chosen = answers['cover-banked']
    if (typeof chosen !== 'string' || !chosen) return
    const look = banked.find((b) => b.id === chosen)
    if (!look) return
    setDoc((base) => ({ ...base, look: applyCoverLook(look) }))
  }, [answers, banked])

  // --- the preview, which is the PDF ------------------------------------
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setRendering(true)
      setRenderError(null)
      renderCoverPreview(doc, {
        images: artBytes,
        pageCountMeasured: handoff?.pageCountMeasured ?? false,
        signal: controller.signal
      })
        .then((next) => {
          if (controller.signal.aborted) {
            releaseCoverPreview(next)
            return
          }
          releaseCoverPreview(previewRef.current)
          previewRef.current = next
          setPreview(next)
        })
        .catch((error: unknown) => {
          // A cancelled render is not a failure — the answer moved on. Anything
          // else is reported: a silently swallowed error leaves the last good
          // cover on screen looking current, which is the one thing a preview
          // must never do.
          if (controller.signal.aborted || (error as { name?: string }).name === 'AbortError') {
            return
          }
          setRenderError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setRendering(false)
        })
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [doc, artBytes, handoff])

  // The last preview outlives the effect that made it; revoke it on the way out.
  useEffect(
    () => () => {
      releaseCoverPreview(previewRef.current)
      previewRef.current = null
    },
    []
  )

  const geometry = useMemo(() => {
    try {
      return coverGeometry({
        trimSize: doc.trimSize,
        pageCount: doc.pageCount,
        paper: doc.paper
      })
    } catch {
      return null
    }
  }, [doc.trimSize, doc.pageCount, doc.paper])

  const frame = useMemo(() => artFrame(doc, fixedWidthMeasurer()), [doc])

  // --- choosing a plate the app already cut ------------------------------
  const chosenPlate = typeof answers['cover-plate'] === 'string' ? answers['cover-plate'] : ''
  useEffect(() => {
    if (source !== 'plate' || !chosenPlate) return
    const offer = plateSource.offers.find((p) => p.id === chosenPlate)
    const bytes = plateSource.bytes.get(chosenPlate)
    if (!offer || !bytes) return
    setArtBytes(new Map([[offer.id, bytes]]))
    setDoc((base) => ({
      ...base,
      content: {
        ...base.content,
        art: {
          id: offer.id,
          sourceWidthPx: offer.widthPx,
          sourceHeightPx: offer.heightPx,
          provenance: { kind: 'plate', pageIndex: offer.pageIndex, caption: offer.caption },
          ops: [],
          fit: 'cover'
        }
      }
    }))
  }, [source, chosenPlate, plateSource])

  useEffect(() => {
    if (source !== 'none') return
    setArtBytes(new Map())
    setDoc((base) => ({
      ...base,
      content: {
        ...base.content,
        art: {
          id: null,
          sourceWidthPx: 0,
          sourceHeightPx: 0,
          provenance: null,
          ops: [],
          fit: 'cover'
        }
      }
    }))
  }, [source])

  const onUpload = useCallback(async (file: File) => {
    setArtError(null)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer]))
    // Read out of the bitmap *now*, into plain numbers. A React state updater
    // runs later, during a render — and by then `bitmap.close()` in the
    // `finally` below has zeroed the bitmap's own width and height. Reading
    // them from inside the updater produced a cover carrying a picture with no
    // dimensions, which composes to no picture at all and warns that none was
    // chosen: every visible symptom pointing away from the cause.
    const widthPx = bitmap.width
    const heightPx = bitmap.height
    const id = `upload-${file.name}`
    try {
      // PNG only into the writer, so anything else is re-encoded once, here,
      // at its own size — never scaled, which would invent resolution.
      const canvas = document.createElement('canvas')
      canvas.width = widthPx
      canvas.height = heightPx
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.drawImage(bitmap, 0, 0)
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode'))), 'image/png')
      })
      const png = new Uint8Array(await blob.arrayBuffer())
      setArtBytes(new Map([[id, png]]))
      setDoc((base) => ({
        ...base,
        content: {
          ...base.content,
          art: {
            id,
            sourceWidthPx: widthPx,
            sourceHeightPx: heightPx,
            provenance: { kind: 'upload', fileName: file.name },
            ops: [],
            fit: 'cover'
          }
        }
      }))
    } finally {
      bitmap.close()
    }
  }, [])

  // --- making one --------------------------------------------------------
  const modelSlug =
    typeof answers['cover-art-model'] === 'string'
      ? answers['cover-art-model']
      : (SUGGESTED_ART_MODELS[0]?.slug ?? '')
  const model = SUGGESTED_ART_MODELS.find((m) => m.slug === modelSlug)
  const verdict = frame && model ? checkResolution(frame, model) : null
  const needed = frame ? requiredPixels(frame) : null

  const onGenerate = useCallback(async () => {
    if (!frame) return
    setGenError(null)
    setGenNotes([])
    setGenerating('asking')
    try {
      const brief = buildArtPrompt({
        brief: (typeof answers['cover-art-brief'] === 'string'
          ? answers['cover-art-brief']
          : 'ground') as ArtBrief,
        subject:
          typeof answers['cover-art-subject'] === 'string' ? answers['cover-art-subject'] : '',
        period: '',
        title: doc.content.title,
        palette: doc.look.palette,
        direction:
          typeof answers['cover-art-direction'] === 'string' ? answers['cover-art-direction'] : ''
      })
      const art = await generateCoverArt({
        token,
        model: modelSlug,
        prompt: brief.prompt,
        negative: brief.negative,
        frame,
        seed: null,
        onStatus: setGenerating
      })
      const id = `generated-${art.predictionId}`
      setArtBytes(new Map([[id, art.bytes]]))
      setGenNotes(art.notes)
      setDoc((base) => ({
        ...base,
        content: {
          ...base.content,
          art: {
            id,
            sourceWidthPx: art.widthPx,
            sourceHeightPx: art.heightPx,
            provenance: {
              kind: 'generated',
              model: art.model,
              prompt: art.prompt,
              seed: art.seed
            },
            ops: [],
            fit: 'cover'
          }
        }
      }))
    } catch (error) {
      setGenError(error instanceof Error ? error.message : String(error))
    } finally {
      setGenerating(null)
    }
  }, [answers, doc.content.title, doc.look.palette, frame, modelSlug, token])

  /**
   * The press's mark, supplied once and banked with the look.
   *
   * Read into a data URL rather than kept as a file handle: the mark has to
   * travel with the look to every later book, and a `File` does not survive a
   * refresh, let alone a different device.
   */
  const onMarkFile = useCallback(async (file: File) => {
    setArtError(null)
    const mark = await readMarkFile(file)
    setDoc((base) => ({ ...base, look: { ...base.look, pressMark: mark } }))
  }, [])

  const onBank = useCallback(async () => {
    const saved = newSavedCoverLook({
      name: lookName || doc.content.series || 'A cover look',
      look: doc.look
    })
    const ok = await saveCoverLook(saved)
    setSavedNote(
      ok
        ? `Banked as “${saved.name}”. It will be offered on the next book, carrying nothing about this one.`
        : 'The look could not be saved on this device.'
    )
    setBanked(await listCoverLooks())
  }, [doc.look, doc.content.series, lookName])

  const credit = describeProvenance(doc.content.art.provenance)

  return (
    <div className="cover-studio">
      <header className="cover-head">
        <h1>The cover</h1>
        <p className="help">
          {geometry
            ? describeGeometry(geometry)
            : 'Give the book a trim size the printer recognises.'}
        </p>
        <button type="button" onClick={onClose}>
          Back
        </button>
      </header>

      <div className="cover-body">
        <div className="cover-questions">
          {groups.map((group) => (
            <CoverGroup key={group.id} id={group.id}>
              {group.questions.map((question) => (
                <QuestionView
                  key={question.id}
                  question={question}
                  value={answers[question.id]}
                  onChange={(value) => onAnswer(question, value)}
                />
              ))}

              {group.id === 'group-art' && source === 'upload' ? (
                <div className="q">
                  <span className="prompt">The file</span>
                  <div className="help">
                    {needed
                      ? `It prints across ${frame!.width.toFixed(2)} × ${frame!.height.toFixed(2)} in, so it wants about ${needed.width} × ${needed.height} pixels to hit 300 DPI.`
                      : null}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      onUpload(file).catch((error: unknown) => {
                        setArtError(
                          `That file could not be read: ${error instanceof Error ? error.message : String(error)}`
                        )
                      })
                    }}
                  />
                  {artError ? <div className="help warn">{artError}</div> : null}
                </div>
              ) : null}

              {group.id === 'group-generate' && source === 'generated' ? (
                <div className="q">
                  <span className="prompt">Make it</span>
                  {!token.trim() ? (
                    <>
                      <div className="help">
                        A Replicate token, which stays in this browser and goes nowhere but
                        Replicate. It is never written into a book file.
                      </div>
                      <input
                        type="password"
                        placeholder="r8_…"
                        onChange={(e) => {
                          saveReplicateToken(e.target.value)
                          forgetReplicateReach()
                          setToken(e.target.value)
                        }}
                      />
                    </>
                  ) : null}

                  {reachable === false ? (
                    <div className="help warn">
                      This browser cannot reach Replicate — their API does not accept requests from
                      a web page, and this app has no server to route one through. Everything else
                      here still works: make the picture wherever you normally would and choose “a
                      picture of your own”.
                    </div>
                  ) : null}

                  {verdict && verdict.kind === 'short' ? (
                    <div className="help warn">{verdict.message}</div>
                  ) : verdict && needed ? (
                    <div className="help">
                      {model?.label} can reach the {needed.width} × {needed.height} pixels this
                      needs.
                    </div>
                  ) : null}

                  <div className="actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={!token.trim() || generating !== null || reachable === false}
                      onClick={() => void onGenerate()}
                    >
                      {generating ? `Working — ${generating}…` : 'Generate (this spends money)'}
                    </button>
                  </div>
                  {genError ? <div className="help warn">{genError}</div> : null}
                  {genNotes.map((note) => (
                    <div key={note} className="help">
                      {note}
                    </div>
                  ))}
                </div>
              ) : null}
            </CoverGroup>
          ))}

          <section className="q">
            <span className="prompt">The press's mark</span>
            <div className="help">
              Printed at the foot of the spine, in the accent colour. SVG or PNG — it is rendered at
              the size it prints, so vector stays sharp on a fold this narrow. It is banked with the
              look, because a colophon device belongs to the publisher rather than to a book.
            </div>
            <input
              type="file"
              accept="image/svg+xml,image/png,image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                onMarkFile(file).catch((error: unknown) => {
                  setArtError(
                    `That mark could not be read: ${error instanceof Error ? error.message : String(error)}`
                  )
                })
              }}
            />
            {doc.look.pressMark ? (
              <div className="help">
                Using {doc.look.pressMark.fileName}.{' '}
                <button
                  type="button"
                  className="linkish"
                  onClick={() =>
                    setDoc((base) => ({ ...base, look: { ...base.look, pressMark: null } }))
                  }
                >
                  Remove it
                </button>
              </div>
            ) : null}
          </section>

          <section className="q">
            <span className="prompt">Keep this look for the rest of the set</span>
            <div className="help">
              Banks the arrangement, the palette, the faces and the ornament — and nothing about
              this book. The next volume is then one question instead of ten.
            </div>
            <input
              type="text"
              value={lookName}
              placeholder="Blackthorn plain covers"
              onChange={(e) => setLookName(e.target.value)}
            />
            <div className="actions">
              <button type="button" onClick={() => void onBank()}>
                Bank this look
              </button>
            </div>
            {savedNote ? <div className="help">{savedNote}</div> : null}
          </section>
        </div>

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
                Back, spine, front. This picture is the PDF the button below downloads, rendered
                from its own bytes.
              </div>
              {credit ? <div className="help">{credit}</div> : null}
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => downloadPdf(preview.bytes, fileName(doc))}
                >
                  Download the cover
                </button>
              </div>
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
      </div>
    </div>
  )
}

export type { PlateOffer }
