/**
 * Image-engine surface for the renderer. The pure op functions now live in
 * `@core/image` (so the export process can reuse the same op stack); `raster.ts`
 * is the renderer-only bridge to the DOM `ImageData`/canvas. Re-exported
 * together so existing `./engine` imports keep working unchanged.
 */
export * from '@core/image'
export * from './raster'
