#!/usr/bin/env node
/**
 * The chapters rendered so far, as a page to listen on.
 *
 * One `<audio>` per chapter, with what the render measured beside it: how long
 * it came out, how long its words predicted, and — the part that matters — what
 * it could not read. A chapter with a paragraph missing sounds exactly like a
 * chapter, so the only place that can be caught is here, in writing, next to
 * the thing itself.
 *
 *   node scripts/audio-page.mjs public/audio mp3
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? 'public/audio')
const extension = process.argv[3] ?? 'mp3'

const escape = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
const chapters = []
for (const name of names) {
  const record = JSON.parse(await readFile(resolve(dir, name), 'utf8'))
  chapters.push({ ...record, file: `${name.replace(/\.json$/u, '')}.${extension}` })
}
chapters.sort((a, b) => a.chapter - b.chapter)

const minutes = (s) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`

const sections = chapters
  .map((c) => {
    const drift = Math.abs(c.seconds - c.expectedSeconds) / c.expectedSeconds
    return `    <section>
      <h2>${escape([c.label, c.title].filter(Boolean).join(' — '))}</h2>
      <p class="why">${escape(c.book)} · read by ${escape(c.voice)}</p>
      <audio controls preload="none" src="${escape(c.file)}"></audio>
      <div class="out">${escape(
        `${minutes(c.seconds)} of audio from ${c.words} words ` +
          `(the words predicted ${minutes(c.expectedSeconds)}, ${(drift * 100).toFixed(0)}% out).`
      )}</div>
${
  c.unread.length === 0
    ? '      <p class="why">Every block in the chapter was read.</p>'
    : `      <p class="why">Not read:</p>
      <div class="out bad">${c.unread
        .map((u) => escape(`${u.id} (${u.kind}) — ${u.why}`))
        .join('\n')}</div>`
}
    </section>`
  })
  .join('\n\n')

await writeFile(
  resolve(dir, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Read aloud</title>
    <style>
      :root {
        --bg: #fbfaf7;
        --panel: #fff;
        --ink: #23201b;
        --muted: #6f675c;
        --line: #e0d9cc;
        --bad: #b5651d;
        font-family: ui-serif, Georgia, serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0 auto; padding: 20px 16px 64px; max-width: 40em;
        background: var(--bg); color: var(--ink); line-height: 1.5;
      }
      h1 { font-size: 1.3rem; margin: 0 0 4px; }
      h2 { font-size: 1rem; margin: 0 0 4px; }
      .lede, .why { color: var(--muted); font-size: 0.88rem; margin: 0 0 12px; }
      section {
        background: var(--panel); border: 1px solid var(--line);
        border-radius: 8px; padding: 14px 16px; margin: 0 0 16px;
      }
      audio { width: 100%; }
      .out {
        white-space: pre-wrap; font-family: ui-monospace, Menlo, monospace;
        font-size: 0.75rem; background: #f4efe6; border-radius: 6px;
        padding: 8px; margin-top: 10px; overflow-x: auto;
      }
      .out.bad { color: var(--bad); }
    </style>
  </head>
  <body>
    <h1>Read aloud</h1>
    <p class="lede">
      Rendered off the device from the book file itself &mdash; every correction, every
      respelling, chapter numbers written out. Under each chapter is what the render measured,
      including anything it could not read: a chapter with a paragraph missing sounds exactly
      like a chapter, so that has to be in writing.
    </p>

${sections}
  </body>
</html>
`
)
console.log(`${chapters.length} chapters laid out in ${resolve(dir, 'index.html')}`)
