/** Dependency-detection public surface (SPEC §2; §12 #21). */
export type { ToolSpec } from './registry'
export { REQUIRED_TOOLS } from './registry'
export { detectTool, detectDependencies, compareVersions } from './detect'
