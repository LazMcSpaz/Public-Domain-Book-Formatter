/**
 * Project schema and migration (SPEC §9).
 *
 * Pure: the shape of a saved project and how older manifests upgrade to it.
 * *Storing* a project is platform work and lives in `@platform/*` — in the
 * browser that's OPFS/IndexedDB rather than a filesystem path.
 */
export { CURRENT_SCHEMA_VERSION, createEmptyProject, migrate } from './project-file'
