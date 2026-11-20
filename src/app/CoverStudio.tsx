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
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnswerValue, Answers, Question } from '@core/wizard'
import { defaultAnswers, groupQuestions } from '@core/wizard'
import {
  applyCoverLook,
  artFrame,
  coverFromAnswers,
  coverFromInterior,
  coverQuestions,
  defaultCover,
  describeGeometry,
  describeProvenance,
  coverGeometry,
  MAX_ICON_WIDTH_PX,
  newSavedCoverLook,
  type CoverDocument,
  type CoverInterviewState,
  type PlateOffer,
  type SavedCoverLook
} from '@core/cover'
import { fixedWidthMeasurer } from '@core/layout'
import { QuestionView } from './QuestionView'
import { downloadPng } from '../platform/browser/download'
import { renderFrontCover } from '../platform/browser/cover-preview'
import { listCoverLooks, saveCoverLook } from '../platform/browser/cover-looks'
import { readMarkFile } from '../platform/browser/press-mark'
import { coverHandoffPlates, takeCoverHandoffFacts } from './cover-handoff'
import { useCoverArt } from './cover-studio-art'
import { useCoverPreview } from './cover-studio-preview'
import {
  BankField,
  CoverGroup,
  fileName,
  GenerateField,
  PressMarkField,
  PreviewPane,
  UploadField
} from './CoverStudioParts'

/**
 * How wide a downloaded front cover is rendered, in DPI across the trim.
 *
 * Computed from the trim rather than fixed in pixels, so a 5×8 and an 8.5×11
 * both come out at the same density instead of the same size. 300 is print
 * standard, which this is not — it is a picture of the front, and the number is
 * reported rather than implied. Very wide trims meet `MAX_ICON_WIDTH_PX` first
 * and come out a little softer, which the note says.
 */
const FRONT_PNG_DPI = 300

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
  const [lookName, setLookName] = useState('')
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [frontNote, setFrontNote] = useState<string | null>(null)
  const [frontBusy, setFrontBusy] = useState(false)

  useEffect(() => {
    void listCoverLooks().then(setBanked)
  }, [])

  const source = (
    typeof answers['cover-art-source'] === 'string' ? answers['cover-art-source'] : ''
  ) as CoverInterviewState['artSource'] | ''
  const frame = useMemo(() => artFrame(doc, fixedWidthMeasurer()), [doc])
  const art = useCoverArt({ answers, source, doc, setDoc, frame, plateSource })
  const { artBytes, token, reachable } = art

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
  const { preview, rendering, renderError } = useCoverPreview(
    doc,
    artBytes,
    handoff?.pageCountMeasured ?? false
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

  // The front panel on its own, as a picture. The other button hands over the
  // printable sheet; this one is the book as it looks in a hand, which is what
  // anything that *lists* books needs and what the flat sheet cannot be cropped
  // into by eye without cutting into the bleed or the fold.
  const downloadFront = useCallback(async () => {
    setFrontBusy(true)
    setFrontNote(null)
    try {
      const asked = Math.round((geometry?.trim.widthIn ?? 6) * FRONT_PNG_DPI)
      const front = await renderFrontCover(doc, { images: artBytes, widthPx: asked })
      downloadPng(front.bytes, fileName(doc, 'front.png'))
      setFrontNote(
        `${front.widthPx} × ${front.heightPx} px, ${Math.round(front.dpi)} DPI across the ` +
          `printed front${asked > MAX_ICON_WIDTH_PX ? ' (capped)' : ''}. A picture of the ` +
          `cover, not a cover file.`
      )
    } catch (error) {
      setFrontNote(error instanceof Error ? error.message : String(error))
    } finally {
      setFrontBusy(false)
    }
  }, [doc, artBytes, geometry])

  /**
   * The press's mark, supplied once and banked with the look.
   *
   * Read into a data URL rather than kept as a file handle: the mark has to
   * travel with the look to every later book, and a `File` does not survive a
   * refresh, let alone a different device.
   */
  const { setArtError } = art
  const onMarkFile = useCallback(
    async (file: File) => {
      setArtError(null)
      const mark = await readMarkFile(file)
      setDoc((base) => ({ ...base, look: { ...base.look, pressMark: mark } }))
    },
    [setArtError]
  )

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
                <UploadField
                  frame={frame}
                  needed={art.needed}
                  artError={art.artError}
                  onUpload={art.onUpload}
                  onError={setArtError}
                />
              ) : null}

              {group.id === 'group-generate' && source === 'generated' ? (
                <GenerateField
                  token={token}
                  setToken={art.setToken}
                  reachable={reachable}
                  verdict={art.verdict}
                  needed={art.needed}
                  model={art.model}
                  generating={art.generating}
                  genError={art.genError}
                  genNotes={art.genNotes}
                  onGenerate={art.onGenerate}
                />
              ) : null}
            </CoverGroup>
          ))}

          <PressMarkField
            fileName={doc.look.pressMark?.fileName ?? null}
            onFile={onMarkFile}
            onError={setArtError}
            onRemove={() =>
              setDoc((base) => ({ ...base, look: { ...base.look, pressMark: null } }))
            }
          />

          <BankField
            lookName={lookName}
            setLookName={setLookName}
            savedNote={savedNote}
            onBank={onBank}
          />
        </div>

        <PreviewPane
          doc={doc}
          preview={preview}
          rendering={rendering}
          renderError={renderError}
          credit={credit}
          frontBusy={frontBusy}
          frontNote={frontNote}
          onFront={downloadFront}
        />
      </div>
    </div>
  )
}

export type { PlateOffer }
