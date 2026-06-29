# Testing Guide

Two layers: **automated checks** (run anywhere, no system tools) and a
**manual end-to-end pass** (needs a real machine with a display and the OCR/
typesetting toolchain). See [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for what
each layer actually exercises.

---

## 1. Automated checks (any machine, no system tools)

```bash
npm install            # add ELECTRON_SKIP_BINARY_DOWNLOAD=1 if the Electron CDN is blocked
npm run format:check   # prettier
npm run lint           # eslint
npm run typecheck      # tsc --noEmit, whole tree
npm test               # vitest — 228 tests
npm run build          # electron-vite bundles main/preload/renderer
```

All five should pass. This is exactly what CI runs
(`.github/workflows/ci.yml`). If you only run one thing, run `npm test`.

---

## 2. Manual end-to-end pass (real machine)

This is the part that can't be done in the sandbox. You need the system tools
the app orchestrates.

### 2a. Install the toolchain

| Tool                           | Purpose           | macOS (brew)                        | Debian/Ubuntu (apt)                 | Windows             |
| ------------------------------ | ----------------- | ----------------------------------- | ----------------------------------- | ------------------- |
| **Node 22**                    | run/build the app | `brew install node@22`              | nodesource                          | nodejs.org / winget |
| **Tesseract** + `eng` data     | OCR               | `brew install tesseract`            | `tesseract-ocr`                     | choco/scoop         |
| **Poppler** (pdftoppm/pdfinfo) | page extraction   | `brew install poppler`              | `poppler-utils`                     | choco/scoop         |
| **Pandoc**                     | Markdown → LaTeX  | `brew install pandoc`               | `pandoc`                            | choco/scoop         |
| **TeX Live** + **XeLaTeX**     | typesetting       | `brew install --cask mactex-no-gui` | `texlive-xetex texlive-fonts-extra` | install-tl          |
| **librsvg** (`rsvg-convert`)   | ornament SVG→PDF  | `brew install librsvg`              | `librsvg2-bin`                      | choco/scoop         |
| **OCRmyPDF** _(optional)_      | deskew/preprocess | `brew install ocrmypdf`             | `ocrmypdf`                          | pip                 |

Fonts: the shipped default profiles use **EB Garamond** and **Linux Libertine**.
Install them (or pick installed fonts in the Design tab) so XeLaTeX can embed
them. macOS: `brew install --cask font-eb-garamond`; Linux:
`fonts-ebgaramond fonts-linuxlibertine`.

Confirm everything resolves:

```bash
tesseract --version && pdftoppm -v && pandoc -v && xelatex --version && rsvg-convert --version
```

### 2b. Get a sample input

Any public-domain scanned PDF works. Good sources: Internet Archive
(archive.org "PDF" download of a scanned old book) or a Google-Books/HathiTrust
public-domain scan. Pick something short (20–60 pages) with at least one
illustration and clear chapter headings so every feature gets exercised.

### 2c. Launch

```bash
npm install          # if not already
npm run dev          # launches the Electron app
```

On first run, if any **required** tool is missing the **Setup Wizard** appears
(Tesseract / Poppler / Pandoc / XeLaTeX status). Install what's flagged, hit
"Re-check", then "Continue".

### 2d. Walk the flow and verify

1. **Import** — "Import PDF…", pick your sample. The Loading view shows pipeline
   stages (extract → ocr → image-detect → cleanup → structure → markdown).
   - ✅ Completes without error and lands in the Review view.
   - A `<name>.bookproj` directory is created next to the PDF (manifest + assets).

2. **Review (read + sync)** — the source scan (left) and formatted text (right).
   - ✅ Hovering a word highlights its counterpart on the other side.
   - ✅ Scrolling one pane tracks the other.
   - ✅ Toggle "confidence tint" — low-confidence OCR words tint; off by default.
   - ✅ Hovering a flagged/low-confidence word shows the cropped source pixels.
   - ✅ "Next flag" jumps through flags; the Flag panel shows real OCR numbers vs
     labeled heuristics (no fake percentages).

3. **Edit + find/replace** — fix a word inline in the right pane; add a
   find-replace rule and "Apply all"; run "Scan suspicious characters".
   - ✅ Edits stick; Save (or Ctrl+S) persists; reopening the project restores them.

4. **Tagging** — select a passage, right-click, assign a type (try **heading**,
   **blockquote**, and a **footnote**: select the note, then its in-text ref).
   - ✅ Tag decorations appear; the Structure panel lists tags.
   - ✅ Confirm a heading → it appears in the live TOC preview.

5. **Images** — find an auto-detected region on a page (dashed marker).
   - ✅ Accept it → "Edit image…" opens the editor.
   - ✅ Crop (drag on the image or numeric), rotate/straighten, levels/curves/
     threshold/grayscale/despeckle, and best-effort background removal all update
     the live preview.
   - ✅ The DPI badge warns when the placed image is under 300 DPI.
   - ✅ Save → reopen → edits are preserved (non-destructive; original re-derived).

6. **Design (style/profile)** — Design tab: set trim size, margins, fonts,
   running heads, page numbers, ornaments. "Save as profile", then "Apply to
   book". Reopen a _different_ project and confirm the saved profile is available
   (profiles live in the app's userData dir, reusable across books).

7. **Front matter** — fill title/author + ISBN/edition/imprint/copyright.

8. **Export (the payoff)** — Export tab → "Export KDP PDF".
   - ✅ Produces a PDF in `<bookproj>/build/book.pdf`.
   - ✅ The validation report shows font/trim/gutter/DPI checks and the **final
     page count** (you need it for the cover spine).
   - ✅ Open the PDF: correct trim size, embedded fonts, running heads flipping
     verso/recto, a generated TOC with edition page numbers, ornaments placed,
     front matter present.

### 2e. The real proof

Even a perfect digital file needs a physical KDP proof (gutter swallow, tight
margins, light fonts, muddy images only show on paper). Upload `book.pdf` as a
KDP interior and order one proof. The DPI warnings + validation reduce proof
cycles but don't eliminate them (SPEC §10).

---

## 3. Packaging the Windows installer

Not buildable on Linux/macOS. On a Windows runner (or the CI `package-windows`
job, triggered by a `v*` tag or manual dispatch):

```powershell
pwsh scripts/fetch-win-tools.ps1   # downloads the bundled tools into resources/bin/win
npm run dist:win                   # electron-vite build + electron-builder NSIS → release/*.exe
```

The installer now bundles the **app + the system tools** (Tesseract, Poppler,
Pandoc, TinyTeX) so end users install nothing else — see
[`docs/INSTALL.md`](./INSTALL.md) for the end-user flow and how bundling works.
The `fetch-win-tools.ps1` URLs/versions are pinned and may need bumping; that
script can only be validated on a real Windows runner.

---

## Known limits (by design, this build)

- No automated UI tests (no headless display here); §2 is manual.
- Curves/crop are in the image editor; advanced masking for background removal is
  best-effort, as labeled.
- Pandoc receives the body via a temp file; very large books haven't been
  performance-tuned.
