# Bundled tool binaries

For a clean, one-click install the app ships portable copies of the external
tools here, so a fresh machine needs nothing else installed. At runtime the app
resolves each tool from `<resources>/bin/<os>/` first (see
`src/tooling/tool-paths.ts`), falling back to the system PATH if a bundle is
absent.

Layout (populated at packaging time, **not** committed — these are large):

```
resources/bin/
  win/    tesseract.exe, pdftoppm.exe (+poppler dlls), pandoc.exe, xelatex.exe (+ TinyTeX tree)
  mac/    tesseract, pdftoppm, pandoc, xelatex …
  linux/  tesseract, pdftoppm, pandoc, xelatex …
```

The Windows set is fetched by `scripts/fetch-win-tools.ps1`, run by the
`package-windows` CI job before `electron-builder`. macOS/Linux bundles can be
populated by an analogous script when those targets are added.

If this folder is empty (e.g. a dev checkout), the app still works as long as the
tools are installed on the system PATH; the first-run Setup screen reports which
are missing.
