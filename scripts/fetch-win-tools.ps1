<#
.SYNOPSIS
  Fetch portable Windows builds of the external tools into resources\bin\win so
  the installer is self-contained (SPEC §12 #21). Run on a Windows runner before
  electron-builder (see the package-windows CI job).

.NOTES
  This must run on Windows; it cannot be validated in the Linux dev sandbox.
  Tool versions/URLs are pinned below and may need bumping over time. The app
  resolves these via src/tooling/tool-paths.ts:
    bin/win/tesseract.exe         (+ tessdata\)
    bin/win/pdftoppm.exe          (+ poppler DLLs)
    bin/win/pandoc.exe
    bin/win/tinytex\bin\windows\xelatex.exe   (+ the TinyTeX tree)
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

# --- Pandoc: ships a portable pandoc.exe in its release zip ------------------
$pandocVer = '3.1.11'
$pandoc = Expand-Url "https://github.com/jgm/pandoc/releases/download/$pandocVer/pandoc-$pandocVer-windows-x86_64.zip" 'pandoc'
Copy-Item (Get-ChildItem -Recurse $pandoc -Filter 'pandoc.exe').FullName $dest -Force

# --- Poppler: pdftoppm.exe + DLLs (oschwartz10612 build) --------------------
$popplerVer = '24.08.0-0'
$poppler = Expand-Url "https://github.com/oschwartz10612/poppler-windows/releases/download/v$popplerVer/Release-$popplerVer.zip" 'poppler'
Copy-Item (Join-Path $poppler 'poppler-*\Library\bin\*') $dest -Recurse -Force

# --- Tesseract: install silently (UB-Mannheim), then copy the program dir ----
# (No official portable zip; the installer is the supported distribution.)
$tessUrl = 'https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-5.3.3.20231005.exe'
$tessExe = Join-Path $tmp 'tesseract-setup.exe'
Invoke-WebRequest -Uri $tessUrl -OutFile $tessExe
Start-Process -Wait -FilePath $tessExe -ArgumentList '/S'
Copy-Item 'C:\Program Files\Tesseract-OCR\*' $dest -Recurse -Force

# --- TinyTeX: a small XeLaTeX distribution; add the packages we typeset with -
# Installs to %APPDATA%\TinyTeX; we copy the whole tree under bin\win\tinytex
# (the resolver points xelatex at tinytex\bin\windows\xelatex.exe).
$installer = Join-Path $tmp 'install-tinytex.bat'
Invoke-WebRequest -Uri 'https://yihui.org/tinytex/install-bin-windows.bat' -OutFile $installer
& $installer
$tinytex = Join-Path $env:APPDATA 'TinyTeX'
$tlmgr = Join-Path $tinytex 'bin\windows\tlmgr.bat'
& $tlmgr install xetex fontspec geometry fancyhdr graphics xcolor

Copy-Item $tinytex (Join-Path $dest 'tinytex') -Recurse -Force

Write-Host "Bundled tools written to $dest"
Get-ChildItem $dest | Select-Object Name
