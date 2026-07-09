/**
 * FlagNavContext — the "which flag is active" cursor for jump-to-next-flag.
 *
 * This is deliberately split out of the big ReviewContext. The active-flag index
 * is consumed by only two components (the ControlBar's "Next flag" button and
 * the FlagPanel's active-row highlight), so keeping it here means changing it
 * re-renders *only those two*, not the whole review tree — the source/output
 * panes never subscribe. (Children passed through as `children` keep their
 * identity across provider re-renders, so React skips re-rendering them.)
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface FlagNavValue {
  /** Index into project.flags of the active flag, or -1 when none. */
  activeIndex: number
  setActiveIndex: (index: number) => void
}

const FlagNavContext = createContext<FlagNavValue | null>(null)

export function FlagNavProvider({ children }: { children: ReactNode }): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(-1)
  const value = useMemo(() => ({ activeIndex, setActiveIndex }), [activeIndex])
  return <FlagNavContext.Provider value={value}>{children}</FlagNavContext.Provider>
}

/** Access the active-flag cursor. Throws if used outside the provider. */
export function useFlagNav(): FlagNavValue {
  const ctx = useContext(FlagNavContext)
  if (!ctx) throw new Error('useFlagNav must be used within a FlagNavProvider')
  return ctx
}
