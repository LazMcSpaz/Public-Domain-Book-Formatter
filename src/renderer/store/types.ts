/**
 * Shared state shapes for the review instrument (SPEC §4).
 *
 * A single `ReviewState` lives in `ReviewContext` (useReducer). Every pane and
 * panel reads from it and dispatches `ReviewAction`s, so source/output sync,
 * flags, edits, and reading prefs all stay coherent across the UI.
 */
import type { CoordinateIndex, Flag, FindReplaceRule, ProjectFile } from '@core/model'

/** Reading-comfort settings for the panes — independent of final typesetting. */
export interface ReadingPrefs {
  /** Body font size in px (14–22). */
  fontSize: number
  /** Line-height multiplier (1.2–2.0). */
  lineSpacing: number
  /** Max line length in ch (50–100). */
  lineLength: number
  /** Source pane width as a percentage of the split (30–70). */
  leftPaneWidthPct: number
  /** Confidence tinting on/off — OFF by default (SPEC §4). */
  confidenceTint: boolean
}

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  fontSize: 17,
  lineSpacing: 1.6,
  lineLength: 70,
  leftPaneWidthPct: 50,
  confidenceTint: false
}

/** The currently-hovered token, shared so both panes can highlight it. */
export interface HoverState {
  /** Token under the cursor, or null. Drives the highlight on both sides. */
  tokenId: string | null
  /** Set when the hover originated in the source pane. */
  sourcePageIndex: number | null
  /** Set when the hover originated in the output pane (char offset). */
  outputOffset: number | null
}

export const EMPTY_HOVER: HoverState = {
  tokenId: null,
  sourcePageIndex: null,
  outputOffset: null
}

/** Whole-app review state. */
export interface ReviewState {
  /** Loaded project manifest, or null before a project is opened. */
  project: ProjectFile | null
  /** Directory the project lives in (needed for image asset paths + saving). */
  projectPath: string | null
  /** Lookup index built from `project.coordinateMap`; null until a project loads. */
  coordinateMap: CoordinateIndex | null
  readingPrefs: ReadingPrefs
  hover: HoverState
  /** Index into `project.flags` for jump-to-next-flag; -1 = none active. */
  activeFlagIndex: number
  /** Token ids whose text was edited (lose confidence/hover-sync until re-OCR). */
  dirtyTokenIds: ReadonlySet<string>
  /** True when there are unsaved changes. */
  isDirty: boolean
}

/** Actions the reducer understands. */
export type ReviewAction =
  | { type: 'SET_PROJECT'; project: ProjectFile; projectPath: string }
  | { type: 'CLOSE_PROJECT' }
  | { type: 'SET_MARKDOWN'; markdown: string; dirtyTokenIds?: string[] }
  | { type: 'SET_HOVER'; hover: HoverState }
  | { type: 'CLEAR_HOVER' }
  | { type: 'SET_READING_PREFS'; prefs: Partial<ReadingPrefs> }
  | { type: 'TOGGLE_TINT' }
  | { type: 'SET_ACTIVE_FLAG'; index: number }
  | { type: 'SET_FLAGS'; flags: Flag[] }
  | { type: 'SET_FIND_REPLACE'; rules: FindReplaceRule[] }
  /** Shallow-merge a patch into the loaded project (tags, config, etc.). */
  | { type: 'PATCH_PROJECT'; patch: Partial<ProjectFile> }
  | { type: 'MARK_SAVED' }
