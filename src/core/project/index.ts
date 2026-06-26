/**
 * Public surface of the project persistence submodule (SPEC §9).
 */
export {
  CURRENT_SCHEMA_VERSION,
  createEmptyProject,
  migrate,
} from './project-file'
export {
  saveProject,
  loadProject,
  manifestPath,
  assetsPath,
} from './persistence'
