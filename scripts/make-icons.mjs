#!/usr/bin/env node
/**
 * The app's icons, drawn from the app's own ornament library.
 *
 * An installed web app is identified by its icon on a home screen, so this is
 * the one picture the tool has to have. It is drawn from `BUILTIN_ORNAMENTS`
 * rather than from something invented for the purpose — the fleuron the books
 * are set with is what this tool is for, and an icon made of house material
 * cannot drift away from the house.
 *
 * Rendered with the Chromium that is already here rather than by hand-rolling a
 * PNG encoder. Regenerable, like the test fixtures, so nobody has to remember
 * how the icon was made:
 *
 *   node scripts/make-icons.mjs
 *
 * Full-bleed and square, with no transparency: iOS masks the corners itself,
 * and a transparent icon is composited on black there and on white elsewhere,
 * which is two different icons.
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { readFileSync } from 'node:fs'

const REPO = resolve(import.meta.dirname, '..')
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const OUT = resolve(REPO, 'public/icons')

// The palette is the app's own, read from its stylesheet so the icon and the
// interface cannot drift apart.
const css = readFileSync(resolve(REPO, 'src/app/styles.css'), 'utf8')
const variable = (name, fallback) =>
  new RegExp(`--${name}:\\s*(#[0-9a-f]{3,8})`, 'i').exec(css)?.[1] ?? fallback
const INK = variable('ink', '#23201b')
const BG = variable('bg', '#fbfaf7')

// `fleuron-center` from `src/core/ornament/ornaments.ts`, at its own viewBox.
const FLEURON = {
  width: 120,
  height: 60,
  shapes: [
    'M60 18 C66 26 66 34 60 42 C54 34 54 26 60 18 Z',
    'M58 30 C46 22 34 24 24 30 C34 36 46 38 58 30 Z',
    'M62 30 C74 22 86 24 96 30 C86 36 74 38 62 30 Z',
    'M20.4 30 a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0 Z',
    'M99.6 30 a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0 Z'
  ]
}

const page = (size) => `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;padding:0}
  body{width:${size}px;height:${size}px;background:${INK};
       display:flex;align-items:center;justify-content:center}
  .keyline{position:absolute;inset:${size * 0.06}px;border:${Math.max(1, size * 0.01)}px solid ${BG};
           opacity:0.35;border-radius:${size * 0.015}px}
  /* Nearly the full width. The fleuron is 2:1, so a conservative size leaves it
     a thin smudge at the 60pt a home screen actually draws it at — which is the
     size this has to be legible at, not the 512 it is authored at. */
  svg{width:${size * 0.84}px}
</style>
<div class="keyline"></div>
<svg viewBox="0 0 ${FLEURON.width} ${FLEURON.height}" xmlns="http://www.w3.org/2000/svg">
  ${FLEURON.shapes.map((d) => `<path d="${d}" fill="${BG}"/>`).join('')}
</svg>`

const SIZES = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  // iOS uses this one for the Home Screen, and only this one.
  { name: 'apple-touch-icon.png', size: 180 }
]

const browser = await chromium.launch({ executablePath: EXECUTABLE })
await mkdir(OUT, { recursive: true })
for (const { name, size } of SIZES) {
  const tab = await browser.newPage({ viewport: { width: size, height: size } })
  await tab.setContent(page(size))
  const bytes = await tab.screenshot({ type: 'png' })
  const target = resolve(OUT, name)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes)
  console.log(`  ${name}  ${size}×${size}  ${bytes.length} bytes`)
  await tab.close()
}
await browser.close()
