#!/usr/bin/env node
/**
 * A page of rendered samples, so a voice is judged by listening rather than by
 * waiting for a phone.
 *
 * `say.mjs` renders; this lays the result out. It exists because the phone
 * cannot be the place this decision is made: synthesis runs on the main thread,
 * so the tab locks solid for the length of the job, with no progress, no
 * scrolling and no way to reload. Rendered elsewhere and published here, the
 * whole set is a page of play buttons.
 *
 * The phonemes are printed under each clip on purpose. A word that comes out
 * wrong is a word whose phonemes were wrong, and reading them is how a
 * respelling gets chosen instead of guessed at.
 *
 *   node scripts/voice-page.mjs <dir with manifest.json and the audio>
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? 'public/voice-samples')
const extension = process.argv[3] ?? 'mp3'
const rendered = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'))

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const passages = new Map()
for (const clip of rendered) {
  if (!passages.has(clip.key)) passages.set(clip.key, { ...clip, clips: [] })
  passages.get(clip.key).clips.push(clip)
}

const sections = [...passages.values()]
  .map(
    (passage) => `    <section>
      <h2>${escape(passage.title)}</h2>
      <p class="said">${escape(passage.text).replace(/\n/g, '<br />')}</p>
${passage.clips
  .map(
    (clip) => `      <div class="clip">
        <h3>${escape(clip.voice)} · ${clip.seconds.toFixed(1)}s</h3>
        <audio controls preload="none" src="${escape(`${clip.key}-${clip.voice}.${extension}`)}"></audio>
        <div class="phon">${clip.phonemes
          .map((p) => `${escape(p.text)}\n  → ${escape(p.phonemes)}`)
          .join('\n\n')}</div>
      </div>`
  )
  .join('\n')}
    </section>`
  )
  .join('\n\n')

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Voices — how this book would sound</title>
    <style>
      :root {
        --bg: #fbfaf7;
        --panel: #fff;
        --ink: #23201b;
        --muted: #6f675c;
        --line: #e0d9cc;
        font-family: ui-serif, Georgia, serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0 auto;
        padding: 20px 16px 64px;
        background: var(--bg);
        color: var(--ink);
        line-height: 1.5;
        max-width: 40em;
      }
      h1 { font-size: 1.3rem; margin: 0 0 4px; }
      .lede { color: var(--muted); font-size: 0.92rem; margin: 0 0 24px; }
      section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px 16px;
        margin: 0 0 16px;
      }
      h2 { font-size: 1rem; margin: 0 0 8px; }
      h3 { font-size: 0.85rem; margin: 0 0 6px; color: var(--muted); font-weight: 600; }
      .said { font-size: 0.95rem; margin: 0 0 14px; }
      .clip { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
      audio { width: 100%; }
      .phon {
        white-space: pre-wrap;
        font-family: ui-monospace, Menlo, monospace;
        font-size: 0.72rem;
        background: #f4efe6;
        border-radius: 6px;
        padding: 8px;
        margin-top: 8px;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <h1>Voices: how this book would sound</h1>
    <p class="lede">
      Rendered off the device, so nothing here has to be waited for. Under each clip is what
      the voice thought the words were — that is where a mispronunciation shows up as
      something readable, and where a respelling gets chosen rather than guessed at. Tell me
      which words come out wrong, and which voice you want to listen to for an hour.
    </p>

${sections}
  </body>
</html>
`

await writeFile(resolve(dir, 'index.html'), html)
console.log(`${rendered.length} clips laid out in ${resolve(dir, 'index.html')}`)
