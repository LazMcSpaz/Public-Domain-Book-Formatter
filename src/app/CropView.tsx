/**
 * A query's crop, shown big enough to read on a phone.
 *
 * A crop is cut at 300 DPI across the full width of the lines, about 1,900
 * pixels. Drawn the width of a phone screen that is a fifth of its size, and
 * book type comes out about eight points tall: the owner's "too little to
 * judge from", with the crop itself not the only fault. So a crop is drawn at
 * **reading size**, about 120 screen pixels to an inch of paper (book type at
 * about 18 points), in a frame that scrolls sideways when the lines are wider
 * than the screen. A crop that carries a note of where its passage is
 * (`readCropNote`, written by `drive.mjs querycrops`) opens scrolled to it;
 * one cut before there were notes opens at the left margin.
 *
 * Wider screens draw it the width of the frame, as before, whenever that is
 * already at least reading size. The full-size view (the lightbox) is one
 * press away either way.
 */
import { useEffect, useRef, useState } from 'react'
import { boxAround, readCropNote, type CropNote } from '@core/queries'

/** Screen pixels to an inch of paper: book type at about 18 points. */
export const READING_PX_PER_INCH = 120

export function CropView({
  src,
  alt,
  dpi,
  onOpen
}: {
  /** A URL this tab can read: the crop's object URL. */
  src: string
  alt: string
  /** The resolution the crop was cut at, when the crop carries no note saying so. */
  dpi: number
  onOpen?: () => void
}): JSX.Element {
  const frame = useRef<HTMLDivElement>(null)
  const [note, setNote] = useState<CropNote | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [overflows, setOverflows] = useState(false)

  // The note is in the crop's own bytes, which this tab already holds.
  useEffect(() => {
    let live = true
    setNote(null)
    fetch(src)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        if (live) setNote(readCropNote(new Uint8Array(buffer)))
      })
      .catch(() => {
        // No note is the ordinary case for an older crop.
      })
    return () => {
      live = false
    }
  }, [src])

  const readingWidth = natural ? natural.width * (READING_PX_PER_INCH / (note?.dpi ?? dpi)) : null

  // Once both the picture and its note are in: scroll to the passage.
  useEffect(() => {
    const box = frame.current
    const img = box?.querySelector('img')
    if (!box || !img || !natural) return
    setOverflows(box.scrollWidth > box.clientWidth + 1)
    if (!note || note.passage.length === 0) return
    const passage = boxAround(note.passage)
    const scale = img.clientWidth / natural.width
    box.scrollLeft = Math.max(0, ((passage.x0 + passage.x1) / 2) * scale - box.clientWidth / 2)
    box.scrollTop = Math.max(0, ((passage.y0 + passage.y1) / 2) * scale - box.clientHeight / 2)
  }, [note, natural, readingWidth])

  return (
    <div className="crop-view">
      <div
        className="crop-frame"
        ref={frame}
        data-passage-marked={note?.passage.length ? 'yes' : 'no'}
      >
        <img
          src={src}
          alt={alt}
          style={readingWidth ? { width: `max(100%, ${Math.round(readingWidth)}px)` } : undefined}
          onLoad={(e) =>
            setNatural({
              width: e.currentTarget.naturalWidth,
              height: e.currentTarget.naturalHeight
            })
          }
        />
      </div>
      <div className="crop-view-bar">
        {overflows ? <small>Swipe sideways to read the whole line.</small> : <span />}
        {onOpen ? (
          <button type="button" className="crop-view-open" onClick={onOpen}>
            ⤢ Full size
          </button>
        ) : null}
      </div>
    </div>
  )
}
