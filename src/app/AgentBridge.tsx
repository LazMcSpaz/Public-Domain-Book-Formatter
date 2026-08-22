/**
 * Being driven from somewhere else, visibly.
 *
 * The app can be operated by a controller that is not in the room — see
 * `platform/browser/control` for how the commands get here and `@core/control`
 * for what a controller is and is not allowed to do. This is the part the
 * person watching sees.
 *
 * That it is *seen* is the whole design of this file. An app that can be
 * operated remotely and shows no sign of it is indistinguishable from one that
 * has been taken over, and the person whose API key and whose book this is has
 * to be able to tell at a glance that something else is pressing the buttons,
 * what it pressed last, and how to make it stop. So the panel is always on
 * screen while the bridge is live, it names the last command and its outcome,
 * and stopping is one button that takes effect before the next poll.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { POLL_MS, pollOnce, type ControlConfig } from '../platform/browser/control'
import type { AgentSurface } from './agent-surface'

export interface AgentBridgeProps {
  config: ControlConfig
  surface: AgentSurface
  onStop: () => void
}

export function AgentBridge({ config, surface, onStop }: AgentBridgeProps): JSX.Element {
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [handled, setHandled] = useState(0)
  const [checking, setChecking] = useState(false)

  // The loop reads these rather than closing over them, so a re-render never
  // leaves a poll in flight talking to a stale gate or an old repository.
  const configRef = useRef(config)
  configRef.current = config
  const surfaceRef = useRef(surface)
  surfaceRef.current = surface

  const poll = useCallback(async (): Promise<void> => {
    setChecking(true)
    try {
      const result = await pollOnce(configRef.current, surfaceRef.current)
      if (result.handled > 0) {
        setHandled((n) => n + result.handled)
        setNote(result.note ?? `${result.handled} command(s)`)
      }
      setError(null)
    } catch (err) {
      // Reported and retried rather than fatal: a rate limit, a dropped
      // connection or a token that expired mid-book should not take the panel
      // down, and the person watching needs to know why nothing is happening.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      if (!live) return
      await poll()
      if (live) timer = setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [poll])

  return (
    <div className="agent-bridge" role="status" aria-live="polite">
      <div className="agent-bridge-head">
        <b>Being driven remotely</b>
        <span className="hint">
          session <code>{config.session}</code> in <code>{config.repo}</code>
        </span>
      </div>
      <div className="hint">
        Commands are read from that repository and answered there. Nothing here can approve a cost —
        a price on screen always waits for you.
      </div>
      <div className="agent-bridge-status">
        <span>{checking ? 'checking…' : `${handled} command${handled === 1 ? '' : 's'} run`}</span>
        {note ? <span className="agent-bridge-note">{note}</span> : null}
      </div>
      {error ? <div className="agent-bridge-error">{error}</div> : null}
      <div className="actions">
        <button type="button" className="ghost" onClick={onStop}>
          Stop letting it drive
        </button>
      </div>
    </div>
  )
}
