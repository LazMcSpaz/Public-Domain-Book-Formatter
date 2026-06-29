# Installing the app

## For most people (Windows): one download, one install

1. Download **`Public-Domain Book Reprint Tool-Setup-<version>.exe`** from the
   project's Releases page.
2. Double-click it and follow the wizard (you can choose the install location).
3. Launch it from the Start menu or desktop shortcut. That's it — the OCR, PDF,
   and typesetting tools are bundled inside, so there's nothing else to install.

The first time it opens it does a quick self-check. On a normal install you'll go
straight to the app. If something is somehow missing, a Setup screen tells you
exactly what and links to a fix — but that's the exception, not the rule.

> **One real-world caveat:** turning a book into the final print PDF uses a
> typesetting engine that the installer ships in a compact form (TinyTeX). The
> first export may take a moment the first time it needs a font or package. This
> is normal.

## How "bundled" works (for the curious / for developers)

The app prefers tool copies shipped inside it, under
`<install folder>/resources/bin/<os>/`, and only falls back to anything you have
installed system-wide. The logic is in `src/tooling/tool-paths.ts`. You can point
the app at a custom tool folder by setting the `PDBF_BIN_DIR` environment
variable.

The bundled Windows tools are assembled at packaging time by
`scripts/fetch-win-tools.ps1` (run by the `package-windows` CI job): Tesseract
(OCR), Poppler (PDF page rendering), Pandoc, and TinyTeX (XeLaTeX). They are not
committed to the repo because they're large.

## Building the installer yourself (Windows machine or CI)

```powershell
npm ci
pwsh scripts/fetch-win-tools.ps1   # downloads the bundled tools into resources/bin/win
npm run dist:win                   # builds the app and the NSIS installer in release/
```

In CI this happens automatically when you push a tag like `v1.0.0` (or trigger
the `package-windows` workflow manually); the finished `.exe` is uploaded as a
build artifact.

## Running from source (developers, any OS)

If you want to run the app without building an installer, you'll need the tools
on your PATH (or in `PDBF_BIN_DIR`). See **[docs/TESTING.md](./TESTING.md) §2a**
for the per-OS install commands, then:

```bash
npm install
npm run dev
```

## macOS / Linux installers

Not built yet. The app and its bundled-tools mechanism are cross-platform; adding
a macOS `.dmg` / Linux `AppImage` target means adding those targets to
`electron-builder.yml` and an analogous fetch script for
`resources/bin/mac` / `resources/bin/linux`. For now, run from source on those
platforms.
