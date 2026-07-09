/**
 * Shared state shapes for the review instrument (SPEC §4).
 *
 * A single `ReviewState` lives in `ReviewContext` (useReducer). Every pane and
 * panel reads from it and dispatches `ReviewAction`s, so source/output sync,
 * flags, edits, and reading prefs all stay coherent across the UI.
 */
import type {
  CoordinateIndex,
  Flag,
  FindReplaceRule,
  FrontMatterFields,
  ImageEditOp,
  ProjectFile,
  SourcePage,
  StructuralTag
} from '@core/model'

/** Which top-level screen of the review window is showing. */
export type ActiveView = 'review' | 'style' | 'export'

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

/** Whole-app review state. */
export interface ReviewState {
  /** Loaded project manifest, or null before a project is opened. */
  project: ProjectFile | null
  /** Directory the project lives in (needed for image asset paths + saving). */
  projectPath: string | null
  /** Lookup index built from `project.coordinateMap`; null until a project loads. */
  coordinateMap: CoordinateIndex | null
  readingPrefs: ReadingPrefs
  /** Token ids whose text was edited (lose confidence/hover-sync until re-OCR). */
  dirtyTokenIds: ReadonlySet<string>
  /** Currently-selected structural tag (for highlight / panel focus); null = none. */
  activeTagId: string | null
  /** Region open in the image editor, or null when the editor is closed. */
  activeImageRegion: { pageIndex: number; regionId: string } | null
  /** Which top-level screen is showing (review / style editor / export). */
  activeView: ActiveView
  /** True when there are unsaved changes. */
  isDirty: boolean
}

/** Actions the reducer understands. */
export type ReviewAction =
  | { type: 'SET_PROJECT'; project: ProjectFile; projectPath: string }
  | { type: 'CLOSE_PROJECT' }
  | { type: 'SET_MARKDOWN'; markdown: string; dirtyTokenIds?: string[] }
  | { type: 'SET_READING_PREFS'; prefs: Partial<ReadingPrefs> }
  | { type: 'TOGGLE_TINT' }
  | { type: 'SET_FLAGS'; flags: Flag[] }
  | { type: 'SET_FIND_REPLACE'; rules: FindReplaceRule[] }
  /** Shallow-merge a patch into the loaded project (tags, config, etc.). */
  | { type: 'PATCH_PROJECT'; patch: Partial<ProjectFile> }
  | { type: 'MARK_SAVED' }
  // --- Phase 3: structural tagging (SPEC §5) ---
  | { type: 'ADD_TAG'; tag: StructuralTag }
  | { type: 'REMOVE_TAG'; id: string }
  | { type: 'UPDATE_TAG'; id: string; patch: Partial<Omit<StructuralTag, 'id'>> }
  | { type: 'SET_ACTIVE_TAG'; id: string | null }
  // --- Phase 3: images (SPEC §6) ---
  | { type: 'SET_REGION_ACCEPTED'; pageIndex: number; regionId: string; accepted: boolean | null }
  | { type: 'SET_PAGES'; pages: SourcePage[] }
  | { type: 'SET_IMAGE_EDITS'; regionId: string; ops: ImageEditOp[] }
  | { type: 'OPEN_IMAGE_EDITOR'; pageIndex: number; regionId: string }
  | { type: 'CLOSE_IMAGE_EDITOR' }
  // --- Phase 4: style profile, front matter, navigation (SPEC §7) ---
  | { type: 'SET_STYLE_PROFILE'; styleProfileId: string | null }
  | { type: 'PATCH_FRONT_MATTER'; patch: Partial<FrontMatterFields> }
  | { type: 'SET_ACTIVE_VIEW'; view: ActiveView }
