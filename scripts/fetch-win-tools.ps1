<#
.SYNOPSIS
  Fetch portable Windows builds of the external tools into resources\bin\win so
  the installer is self-contained (SPEC §12 #21). Run on a Windows runner before
  electron-builder (see the package-windows CI job).

.NOTES
  Must run on Windows; cannot be validated in the Linux dev sandbox. Tool
  versions/URLs are pinned below and may need bumping over time. Pandoc and
  Poppler are required (hard fail). Tesseract and TinyTeX are best-effort: if one
  can't be fetched the build still succeeds and the app falls back to the
  first-run Setup screen for that tool. The app resolves these via
  src/tooling/tool-paths.ts:
    bin/win/tesseract.exe                       (+ tessdata\)
    bin/win/pdftoppm.exe                        (+ poppler DLLs)
    bin/win/pandoc.exe
    bin/win/tinytex\bin\windows\xelatex.exe     (+ the TinyTeX tree)
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'resources\bin\win'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) 'pdbf-tools'
New-Item -ItemType Directory -Force -Path $dest, $tmp | Out-Null

function Expand-Url($url, $name) {
  $zip = Join-Path $tmp "$name.zip"
  Write-Host "Downloading $name -> $url"
  Invoke-WebRequest -Uri $url -OutFile $zip
  $out = Join-Path $tmp $name
  Expand-Archive -Path $zip -DestinationPath $out -Force
  return $out
}

# ---------------------------------------------------------------------------
# Required: Pandoc (portable pandoc.exe in the release zip)
# ---------------------------------------------------------------------------
$pandocVer = '3.1.11'
$pandoc = Expand-Url "https://github.com/jgm/pandoc/releases/download/$pandocVer/pandoc-$pandocVer-windows-x86_64.zip" 'pandoc'
Copy-Item (Get-ChildItem -Recurse $pandoc -Filter 'pandoc.exe').FullName $dest -Force

# ---------------------------------------------------------------------------
# Required: Poppler (pdftoppm.exe + DLLs; oschwartz10612 build)
# ---------------------------------------------------------------------------
$popplerVer = '24.08.0-0'
$poppler = Expand-Url "https://github.com/oschwartz10612/poppler-windows/releases/download/v$popplerVer/Release-$popplerVer.zip" 'poppler'
Copy-Item (Join-Path $poppler 'poppler-*\Library\bin\*') $dest -Recurse -Force

# ---------------------------------------------------------------------------
# Best-effort: Tesseract (UB-Mannheim silent installer, then copy program dir)
# ---------------------------------------------------------------------------
try {
  $tessUrl = 'https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-5.3.3.20231005.exe'
  $tessExe = Join-Path $tmp 'tesseract-setup.exe'
  Invoke-WebRequest -Uri $tessUrl -OutFile $tessExe
  Start-Process -Wait -FilePath $tessExe -ArgumentList '/S'
  Copy-Item 'C:\Program Files\Tesseract-OCR\*' $dest -Recurse -Force
  Write-Host 'Tesseract bundled.'
} catch {
  Write-Warning "Tesseract bundling failed (app will guide the user to install it): $_"
}

# ---------------------------------------------------------------------------
# Best-effort: TinyTeX (small XeLaTeX distribution) — direct release ZIP.
# The scripted installer is flaky in CI, so we fetch the prebuilt bundle from
# rstudio/tinytex-releases, unzip it, and add the packages we typeset with.
# The zip extracts a "TinyTeX" folder; the resolver points xelatex at
# tinytex\bin\windows\xelatex.exe (Windows paths are case-insensitive).
# ---------------------------------------------------------------------------
try {
  $ttTag = 'v2024.12'
  $ttZip = Join-Path $tmp 'tinytex.zip'
  Invoke-WebRequest -Uri "https://github.com/rstudio/tinytex-releases/releases/download/$ttTag/TinyTeX-1-$ttTag.zip" -OutFile $ttZip
  Expand-Archive -Path $ttZip -DestinationPath (Join-Path $tmp 'tinytex') -Force
  $ttSrc = Join-Path $tmp 'tinytex\TinyTeX'
  Copy-Item $ttSrc (Join-Path $dest 'tinytex') -Recurse -Force

  $tlmgr = Join-Path $dest 'tinytex\bin\windows\tlmgr.bat'
  if (Test-Path $tlmgr) {
    & $tlmgr install xetex fontspec geometry fancyhdr graphics xcolor ebgaramond libertine
  }
  Write-Host 'TinyTeX bundled.'
} catch {
  Write-Warning "TinyTeX bundling failed (app will guide the user to install XeLaTeX): $_"
}

Write-Host "Bundled tools written to $dest"
Get-ChildItem $dest | Select-Object Name
