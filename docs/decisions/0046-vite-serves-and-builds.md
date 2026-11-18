# 0046: Vite serves the app in development and builds it

Status: inherited · Date: 2026-11-18

## Decision

Vite 5 (`^5.4.11`) with `@vitejs/plugin-react` is the development server (`npm run dev`, port 5173) and the build tool (`npm run build`, output in `dist/`, published to GitHub Pages under `/Public-Domain-Book-Formatter/`). The path aliases `@core` and `@platform` are defined in `tsconfig.json`, `vite.config.ts` and `vitest.config.ts`. The driver loads core modules into its browser through Vite's `/@fs/` route.

## Why (plain English)

It serves TypeScript and React straight to the browser while developing and produces plain static files for a host with no server (0001).

## What we gave up

No alternative was recorded. One known cost: in this container Vite's file watcher and its in-memory cache have served stale code for hours after an edit.

## Rule for agents

Change the three alias definitions together. Keep `onnxruntime-web` and `ppu-paddle-ocr` out of pre-bundling (0043). After editing `src/core`, kill and restart Vite (and `drive.mjs serve`), then confirm what is served by fetching the module through `/@fs/` with a cache-busting `?v=` parameter. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 15, 658–682, 1478–1486, 1849–1851; vite.config.ts; .github/workflows/deploy.yml.
