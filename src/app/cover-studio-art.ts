/**
 * The cover studio's picture: a plate the app already cut, a file of the
 * editor's own, one made with Replicate, or none. Split out of
 * `CoverStudio.tsx`, which asks the questions and shows the cover.
 *
 * The picture is kept as bytes here rather than in the document: the same
 * split the interior uses, and the reason a `CoverDocument` stays serializable
 * and small enough to bank.
 */
import { useCallback, useEffect, useState } from 'react'
import type { Answers } from '@core/wizard'
import {
  buildArtPrompt,
  checkResolution,
  requiredPixels,
  SUGGESTED_ART_MODELS,
  type ArtBrief,
  type CoverDocument,
  type CoverInterviewState,
  type PlateOffer
} from '@core/cover'
import type { Rect } from '@core/cover'
import { loadReplicateToken } from '../platform/browser/settings'
import { canReachReplicate, generateCoverArt } from '../platform/browser/replicate'

type SetDoc = (update: (base: CoverDocument) => CoverDocument) => void

/** What the art hook is given. */
export interface CoverArtInput {
  answers: Answers
  source: CoverInterviewState['artSource'] | ''
  doc: CoverDocument
  setDoc: SetDoc
  /** Where a picture would print, or null for an arrangement with none. */
  frame: Rect | null
  plateSource: { offers: PlateOffer[]; bytes: Map<string, Uint8Array> }
}

/** The document's art, pointed at a picture or at none. */
function withArt(base: CoverDocument, art: CoverDocument['content']['art']): CoverDocument {
  return { ...base, content: { ...base.content, art } }
}

export function useCoverArt(input: CoverArtInput) {
  const { answers, source, doc, setDoc, frame, plateSource } = input
  const [artBytes, setArtBytes] = useState<Map<string, Uint8Array>>(new Map())
  const [token, setToken] = useState(() => loadReplicateToken())
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [genNotes, setGenNotes] = useState<string[]>([])
  /**
   * Why the picture the user chose is not on the cover.
   *
   * A file that fails to decode used to leave the studio looking exactly as it
   * did before the upload, which reads as "nothing happened" and sends someone
   * to click the same broken file again.
   */
  const [artError, setArtError] = useState<string | null>(null)

  // Ask Replicate once whether a browser may talk to it at all, and only when
  // there is a token to ask with. See `platform/browser/replicate`: this is
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

  // --- choosing a plate the app already cut ------------------------------
  const chosenPlate = typeof answers['cover-plate'] === 'string' ? answers['cover-plate'] : ''
  useEffect(() => {
    if (source !== 'plate' || !chosenPlate) return
    const offer = plateSource.offers.find((p) => p.id === chosenPlate)
    const bytes = plateSource.bytes.get(chosenPlate)
    if (!offer || !bytes) return
    setArtBytes(new Map([[offer.id, bytes]]))
    setDoc((base) =>
      withArt(base, {
        id: offer.id,
        sourceWidthPx: offer.widthPx,
        sourceHeightPx: offer.heightPx,
        provenance: { kind: 'plate', pageIndex: offer.pageIndex, caption: offer.caption },
        ops: [],
        fit: 'cover'
      })
    )
  }, [source, chosenPlate, plateSource, setDoc])

  useEffect(() => {
    if (source !== 'none') return
    setArtBytes(new Map())
    setDoc((base) =>
      withArt(base, {
        id: null,
        sourceWidthPx: 0,
        sourceHeightPx: 0,
        provenance: null,
        ops: [],
        fit: 'cover'
      })
    )
  }, [source, setDoc])

  const onUpload = useCallback(
    async (file: File) => {
      setArtError(null)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer]))
      // Read out of the bitmap *now*, into plain numbers. A React state updater
      // runs later, during a render, and by then `bitmap.close()` in the
      // `finally` below has zeroed the bitmap's own width and height. Reading
      // them from inside the updater produced a cover carrying a picture with no
      // dimensions, which composes to no picture at all and warns that none was
      // chosen: every visible symptom pointing away from the cause.
      const widthPx = bitmap.width
      const heightPx = bitmap.height
      const id = `upload-${file.name}`
      try {
        // PNG only into the writer, so anything else is re-encoded once, here,
        // at its own size, never scaled, which would invent resolution.
        const canvas = document.createElement('canvas')
        canvas.width = widthPx
        canvas.height = heightPx
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        ctx.drawImage(bitmap, 0, 0)
        const blob: Blob = await new Promise((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('could not encode'))),
            'image/png'
          )
        })
        const png = new Uint8Array(await blob.arrayBuffer())
        setArtBytes(new Map([[id, png]]))
        setDoc((base) =>
          withArt(base, {
            id,
            sourceWidthPx: widthPx,
            sourceHeightPx: heightPx,
            provenance: { kind: 'upload', fileName: file.name },
            ops: [],
            fit: 'cover'
          })
        )
      } finally {
        bitmap.close()
      }
    },
    [setDoc]
  )

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
      setDoc((base) =>
        withArt(base, {
          id,
          sourceWidthPx: art.widthPx,
          sourceHeightPx: art.heightPx,
          provenance: { kind: 'generated', model: art.model, prompt: art.prompt, seed: art.seed },
          ops: [],
          fit: 'cover'
        })
      )
    } catch (error) {
      setGenError(error instanceof Error ? error.message : String(error))
    } finally {
      setGenerating(null)
    }
  }, [answers, doc.content.title, doc.look.palette, frame, modelSlug, token, setDoc])

  return {
    artBytes,
    artError,
    setArtError,
    onUpload,
    token,
    setToken,
    reachable,
    generating,
    genError,
    genNotes,
    onGenerate,
    model,
    verdict,
    needed
  }
}
