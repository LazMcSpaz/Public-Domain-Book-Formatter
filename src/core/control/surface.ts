/**
 * What every transport talks to: the shape of the one thing that carries out a
 * command (`useAgentSurface` in the app).
 *
 * Here, not beside the app's implementation, because both sides need it: the
 * app builds a surface, and the transports (`platform/browser/control.ts`, the
 * driver's `window.__pdbfAgent`) call one. The platform may not reach into the
 * app, so the contract between them lives in the protocol both already share.
 */
import type { GateView, Reply } from './protocol'

/** What a reply says, before the transport stamps it with the command's id. */
export type CommandOutcome = Omit<Reply, 'id' | 'at'>

export interface AgentSurface {
  view: () => GateView
  run: (raw: unknown) => Promise<CommandOutcome>
}
