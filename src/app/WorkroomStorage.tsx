/**
 * Settings' line for the Workroom's copy of the status notes on this device:
 * how many there are and their size, and a button to forget them. A copy of
 * what is on the shelf, so forgetting it asks nothing: the Workroom reads the
 * notes from the shelf again the next time it opens.
 */
import { useCallback, useEffect, useState } from 'react'
import { deviceNotesSize, forgetDeviceNotes } from '../platform/browser/note-store'
import { formatBytes } from '../platform/browser/settings'

export function WorkroomStorage({ onNote }: { onNote: (note: string) => void }): JSX.Element {
  const [size, setSize] = useState<{ notes: number; bytes: number } | null>(null)
  const measure = useCallback(async () => setSize(await deviceNotesSize()), [])
  useEffect(() => {
    void measure()
  }, [measure])

  return (
    <div data-storage="workroom-notes">
      <p className="help">
        {size === null
          ? 'The Workroom keeps no notes on this device.'
          : size.notes === 0
            ? 'The Workroom keeps no notes on this device yet.'
            : `The Workroom keeps ${size.notes} status note${size.notes === 1 ? '' : 's'} on this ` +
              `device (${formatBytes(size.bytes)}), so it opens without fetching them again.`}
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={!size || size.notes === 0}
          onClick={() => {
            void (async () => {
              const n = await forgetDeviceNotes()
              await measure()
              onNote(
                `Forgot ${n} Workroom note${n === 1 ? '' : 's'} on this device. ` +
                  'The Workroom reads them from the shelf again next time.'
              )
            })()
          }}
        >
          Forget the Workroom’s notes
        </button>
      </div>
    </div>
  )
}
