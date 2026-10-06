/**
 * Carry a traced emblem's rays out to the edges of the board.
 *
 * Written for Manly P. Hall's all-seeing eye, whose fan is a half-disc at the
 * foot of the cover when it prints as it was traced. The editor wanted the rays
 * extended in every direction, so the whole board is the radiance and the eye
 * sits in the middle of it.
 *
 * ## There is nothing in the trace to pick up and lengthen
 *
 * The engraving is one connected mass of ink with the slits between its rays
 * cut out of it, so the file is a single snaking contour and two hundred-odd
 * specks — classify it however you like, no contour is a ray. What there is, is
 * the pattern the rays make where they reach the rim: a ring of ink and gap in
 * the press's own irregular spacing. That is read off the ink and carried
 * straight outward, each run of ink becoming one ray on its own angle. Nothing
 * here is drawn: the angles, the widths and the gaps are all the engraving's.
 *
 * ## The fan's own hatching is not kept, and that is the point
 *
 * Printed under the carried rays it leaves the one thing this exists to remove.
 * The engraving is an ELLIPSE — its ink reaches 953 px at the sides and 464 at
 * the foot — so where the fan is deep its ink adds to the rays and where it is
 * shallow it does not, and what a reader sees is a wide flat lozenge round the
 * eye: the fan's own outline, which no fading of the join will take out because
 * the join is not what shows.
 *
 * So the hatching goes and the rays carry all of it. What is kept of the trace
 * is what is a FIGURE rather than a texture: the eye, and the seven stars.
 * Neither can be lifted out by contour — labelled in the pixels the eye's ink
 * is one component with the whole fan, and the seventh star's white is one with
 * the background, because on the paper both touch the hatching. Both come out
 * by walking outward from a seed at every angle instead: a star and an eye are
 * star-shaped about their own centres, so the first ink (or the last) traces the
 * true outline off the original pixels, contacts and all.
 *
 * ## A ray goes out as a line, not as a widening wedge
 *
 * Carried out at its own angular width a ray keeps half the board inked at
 * every radius, which is a wash rather than a radiance — the first emission
 * covered a 7x10 in alternating black and ground to the corners. What an
 * engraver draws instead is a hairline, so `TAPER` holds back most of the
 * widening once past the core.
 *
 * ## The box is wider than any cover, on purpose
 *
 * A picture wider than its box is scaled to the box's HEIGHT and cropped at the
 * sides, so two things hold exactly on every trim and in both placements: the
 * eye's height on the board is the fraction written into the file, and the
 * emblem prints at the width it was written for, the only box height either
 * placement has being the full height of the cover sheet. 2.6 is set by the
 * wrap: across a whole 7x10 cover the eye stands on the front panel and the far
 * corner of the back is 13.5 in away, which the artwork's half-width must reach.
 *
 * Usage:
 *   node scripts/radiance.mjs public/devices/all-seeing-eye.svg \
 *     public/devices/all-seeing-eye-radiant.svg --width 3.4 --at 0.33
 */
import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BINS = 4320 // a twelfth of a degree
const DUTY_AT = 0.85 // where round the fan the ink pattern is read
const INK = 0.45 // coverage that counts as ink
const BOX_ASPECT = 2.6
const TAPER = 0.3 // how much of a ray's widening it keeps once past the core
const FRAME_HEIGHT_IN = 10.25 // a 7x10 cover out to the bleed; sets the pixel scale only

/**
 * How far out the rays hold the fan's own weight, before they begin to thin.
 *
 * The fan's longest reach, so the heavy zone is a circle rather than the lens
 * the fan's own ellipse would make. Taken off the trace rather than set, so a
 * re-traced emblem moves it.
 */
const CORE_AT_MAX_REACH = true

// --- the texture, all of it measured off the trace -----------------------
//
// A carried ray drawn as a clean polygon reads as a different material from a
// cut one. Followed outward run by run, a ray of this fan wanders sideways
// about half its own width over the fan's depth (1.26 px per 10 px out, against
// a width of 8.7 px there), and along its length it is a chain of dashes, 16 px
// of ink to a 12 px gap at the median.
//
// A ray is walked in the LOGARITHM of its radius, and that is not tidiness. A
// carried ray is ten times a cut one's depth, so a wobble of a fixed wavelength
// gives twenty-seven waves down its length and the board grows hair, and a dash
// of a fixed 67 px gives sixty beads on a string — both were printed and looked
// at. What the engraving holds constant is the stroke as a PROPORTION of where
// it is on the figure, which is a constant step in log r. (A constant step in
// r / coreRadius is not the same thing: it is a fixed number of pixels under
// another name, and it printed the foot of the board as bamboo.)
//
// The gap is the one length that does not scale, a break being where the burin
// left the plate. And the dash figures are taken from the long end of the
// engraving's own distribution: the pattern read round a circle is already that
// dashing, so breaking at the median's 57 per cent would halve a density the
// circle reading had got right.
const WOBBLE = 0.7 // sideways wander, as a share of the ray's own half-width
const WOBBLE_LN = 0.8 // one wave per 2.2x of radius
const WIDTH_VAR = 0.3 // how much a ray's width breathes along its length
const WIDTH_LN = 0.35
const DASH_LN = 0.17 // a dash spans about a sixth of the radius it is at
// A burin enters and leaves the plate, so a stroke is a lens and not a bar.
// Cut square, a break across a ray a twentieth of an inch wide reads as a dash
// in a dashed line however narrow the gap is made, and shortening it did not
// help. 1 is a pure lens, 0 a bar.
const NIB = 0.45
const GAP_PX = 12 // the fan's own median gap, in the trace's own pixels
const STEP_LN = 0.02 // how finely a ray's edges are built
// The eye is isolated by THINNING the ink rather than by walking out from the
// pupil: on the paper its lid touches the hatching, so a walk escapes along the
// first stroke it meets and the eye measured 305 px instead of 195. Thinned by
// 8 px the hatching breaks away and the lid survives, which leaves the eye as
// its own mass; the outline is that mass's reach per angle, with the thinning
// given back.
const EYE_THIN = 8
const EYE_MARGIN = 11 // the thinning, plus air

/**
 * Where the engraving's own ink fades out, as a share of the fan's rim.
 *
 * This is the shape the editor could see, and it is narrower than it looked
 * from the inside: not the fan's mass but its EDGE — a hundred and thirty-three
 * blunt ray-ends and the gaps between them, standing in an arc. Removing the
 * hatching removes it and takes the engraving with it, which is the wrong
 * trade: the hatching round the eye and the stars is the emblem.
 *
 * So the ink is faded to nothing across its own rim instead, per angle, against
 * the measured `env` rather than a circle — the fan reaches 953 px at the sides
 * and 464 at the foot, so one radius would cut the sides off and leave the foot
 * standing. The carried rays run on through the band and out, so what the eye
 * meets at the rim is a ray getting on with it rather than a row of stops.
 *
 * The inner bound is set by the stars, not by taste: the top row sits at 0.84
 * of the rim in its own direction, so a fade that began earlier takes the ink
 * out from behind them and they stop reading as holes. Three bands were
 * rendered and measured; 0.80 is a shade better at the rim and visibly thinner
 * behind the top stars, which is the wrong trade.
 */
const FADE_FROM = 0.84
const FADE_TO = 0.98
const FADE_PX = 1024 // the fade is a raster mask; this is its long side

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const positional = []
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) i++
  else positional.push(args[i])
}
const [src, out] = positional
const emblemWidthIn = Number(flag('width', 3.4))
const eyeAt = Number(flag('at', 0.33))

if (!src || !out) {
  console.error('usage: radiance.mjs <trace.svg> <out.svg> [--width in] [--at frac]')
  process.exit(2)
}

const svg = await readFile(resolve(src), 'utf8')
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })

const measured = await page.evaluate(
  async ({ svg, BINS, DUTY_AT, INK, EYE_MARGIN, EYE_THIN, FADE_FROM, FADE_TO, FADE_PX }) => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
    })
    const W = img.naturalWidth
    const H = img.naturalHeight
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, W, H)
    const d = ctx.getImageData(0, 0, W, H).data
    const cover = new Float64Array(W * H)
    const ink = new Uint8Array(W * H)
    for (let i = 0, p = 0; p < W * H; p++, i += 4) {
      cover[p] = (d[i + 3] / 255) * (1 - d[i] / 255)
      ink[p] = cover[p] > INK ? 1 : 0
    }
    const at = (x, y) => {
      const xi = Math.round(x)
      const yi = Math.round(y)
      return xi < 0 || yi < 0 || xi >= W || yi >= H ? 0 : cover[yi * W + xi]
    }
    const inkAt = (x, y) => {
      const xi = Math.round(x)
      const yi = Math.round(y)
      return xi < 0 || yi < 0 || xi >= W || yi >= H ? 1 : ink[yi * W + xi]
    }

    // --- where the fan radiates from ------------------------------------
    //
    // Every stroke of an engraved sunburst points at the centre, and a stroke's
    // direction is the perpendicular of the image gradient — so at the true
    // centre the gradient is square to the radius wherever there is an edge.
    // Score a candidate by the share of gradient energy lying ALONG the radius,
    // which is the part a radial stroke cannot have, and take the minimum. It
    // uses every edge pixel and needs no opinion about what is a ray, which is
    // what the contour measurements it replaced all needed.
    const edges = []
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const gx = cover[y * W + x + 1] - cover[y * W + x - 1]
        const gy = cover[(y + 1) * W + x] - cover[(y - 1) * W + x]
        const g2 = gx * gx + gy * gy
        if (g2 > 0.04) edges.push(x, y, gx, gy, g2)
      }
    const rLo = Math.min(W, H) * 0.24
    const rHi = Math.min(W, H) * 0.51
    const radialShare = (cx, cy) => {
      let along = 0
      let all = 0
      for (let i = 0; i < edges.length; i += 5) {
        const dx = edges[i] - cx
        const dy = edges[i + 1] - cy
        const r = Math.hypot(dx, dy)
        if (r < rLo || r > rHi) continue
        const dot = (edges[i + 2] * dx + edges[i + 3] * dy) / r
        along += dot * dot
        all += edges[i + 4]
      }
      return all ? along / all : 1
    }
    let centre = [W / 2, H / 2]
    let step = Math.min(W, H) / 14
    for (let pass = 0; pass < 9; pass++) {
      let best = Infinity
      let found = centre
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const p = [centre[0] + dx * step, centre[1] + dy * step]
          const s = radialShare(p[0], p[1])
          if (s < best) {
            best = s
            found = p
          }
        }
      centre = found
      step = Math.max(0.5, step / 2)
    }
    const [cx, cy] = centre

    // --- the figures: the eye, and the seven stars -----------------------
    //
    // Both are star-shaped about their own centres, which is what lets a radial
    // walk trace them off the original pixels where no labelling can: the eye's
    // ink runs into the fan's and the seventh star's white runs into the
    // background, because on the paper they touch.
    const OUTLINE_BINS = 720
    const starOutline = (sx, sy, limit) => {
      const radii = []
      for (let b = 0; b < OUTLINE_BINS; b++) {
        const a = (b / OUTLINE_BINS) * 2 * Math.PI
        const ux = Math.cos(a)
        const uy = Math.sin(a)
        let r = 1
        while (r < limit && !inkAt(sx + r * ux, sy + r * uy)) r += 1
        radii.push(r)
      }
      let area = 0
      for (let b = 0; b < OUTLINE_BINS; b++)
        area +=
          0.5 * radii[b] * radii[(b + 1) % OUTLINE_BINS] * Math.sin((2 * Math.PI) / OUTLINE_BINS)
      const sorted = radii.slice().sort((p, q) => p - q)
      return {
        c: [sx, sy],
        radii,
        area,
        sharp: sorted[Math.floor(0.95 * OUTLINE_BINS)] / sorted[Math.floor(0.2 * OUTLINE_BINS)]
      }
    }

    const dilate = (r) => {
      const far = 1e9
      const dist = new Float64Array(W * H)
      for (let q = 0; q < W * H; q++) dist[q] = ink[q] ? 0 : far
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const q = y * W + x
          if (x > 0) dist[q] = Math.min(dist[q], dist[q - 1] + 1)
          if (y > 0) dist[q] = Math.min(dist[q], dist[q - W] + 1)
        }
      for (let y = H - 1; y >= 0; y--)
        for (let x = W - 1; x >= 0; x--) {
          const q = y * W + x
          if (x < W - 1) dist[q] = Math.min(dist[q], dist[q + 1] + 1)
          if (y < H - 1) dist[q] = Math.min(dist[q], dist[q + W] + 1)
        }
      const grown = new Uint8Array(W * H)
      for (let q = 0; q < W * H; q++) grown[q] = dist[q] <= r ? 1 : 0
      return grown
    }
    const enclosedWhite = (mask) => {
      const id = new Int32Array(W * H).fill(-1)
      const parts = []
      const stack = []
      for (let s = 0; s < W * H; s++) {
        if (id[s] >= 0 || mask[s] !== 0) continue
        let area = 0
        let sx = 0
        let sy = 0
        const n = parts.length
        id[s] = n
        stack.push(s)
        while (stack.length) {
          const q = stack.pop()
          const x = q % W
          const y = (q - x) / W
          area++
          sx += x
          sy += y
          for (const t of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W])
            if (t >= 0 && t < W * H && id[t] < 0 && mask[t] === 0) {
              id[t] = n
              stack.push(t)
            }
        }
        parts.push({ area, c: [sx / area, sy / area] })
      }
      return parts
    }

    const enclosed = enclosedWhite(dilate(3))
      .filter((p) => p.area > 12000 && p.area < 40000)
      .map((p) => starOutline(p.c[0], p.c[1], 200))
    const areas = enclosed.map((s) => s.area).sort((a, b) => a - b)
    const sharps = enclosed.map((s) => s.sharp).sort((a, b) => a - b)
    // A star whose points touch the hatching is not enclosed at all. Sealing
    // the ink gives a SEED inside it; it is then accepted on the same two
    // measurements the enclosed ones make, not on where it sits.
    const touching = enclosedWhite(dilate(11))
      .filter(
        (p) =>
          p.area > 5000 && enclosed.every((s) => Math.hypot(s.c[0] - p.c[0], s.c[1] - p.c[1]) > 150)
      )
      .map((p) => starOutline(p.c[0], p.c[1], 200))
      .filter(
        (s) =>
          s.area > areas[0] * 0.8 &&
          s.area < areas.at(-1) * 1.2 &&
          s.sharp > sharps[0] * 0.8 &&
          s.sharp < sharps.at(-1) * 1.2
      )
    const stars = [...enclosed, ...touching]

    // The eye, off the thinned ink: the mass the pupil sits in once the
    // hatching has broken away from the lid.
    const thickness = new Float64Array(W * H)
    {
      const FAR = 1e9
      for (let q = 0; q < W * H; q++) thickness[q] = ink[q] ? FAR : 0
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const q = y * W + x
          if (x > 0) thickness[q] = Math.min(thickness[q], thickness[q - 1] + 1)
          if (y > 0) thickness[q] = Math.min(thickness[q], thickness[q - W] + 1)
        }
      for (let y = H - 1; y >= 0; y--)
        for (let x = W - 1; x >= 0; x--) {
          const q = y * W + x
          if (x < W - 1) thickness[q] = Math.min(thickness[q], thickness[q + 1] + 1)
          if (y < H - 1) thickness[q] = Math.min(thickness[q], thickness[q + W] + 1)
        }
    }
    const core = new Uint8Array(W * H)
    for (let q = 0; q < W * H; q++) core[q] = thickness[q] > EYE_THIN ? 1 : 0
    const eyeMask = new Uint8Array(W * H)
    {
      const seed = Math.round(cy) * W + Math.round(cx)
      if (core[seed]) {
        const stack = [seed]
        eyeMask[seed] = 1
        while (stack.length) {
          const q = stack.pop()
          const x = q % W
          for (const n of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W])
            if (n >= 0 && n < W * H && !eyeMask[n] && core[n]) {
              eyeMask[n] = 1
              stack.push(n)
            }
        }
      }
    }
    // The clip is a DISC of the mass's own reach, not its outline and not an
    // ellipse fitted to it. Thinning eats the lid's two tips, which are the
    // thinnest part of the eye, so any outline taken from the thinned mass cuts
    // them off and the eye prints chewed — the ellipse did it too. A disc
    // cannot, and being generous costs nothing here: what lies just outside the
    // eye is rays either way, so a stray stroke caught inside the clip reads as
    // one more of them.
    let n = 0
    let mx = 0
    let my = 0
    for (let q = 0; q < W * H; q++)
      if (eyeMask[q]) {
        n++
        mx += q % W
        my += (q - (q % W)) / W
      }
    mx = n ? mx / n : cx
    my = n ? my / n : cy
    let reach = 0
    for (let q = 0; q < W * H; q++)
      if (eyeMask[q]) {
        const dx = (q % W) - mx
        const dy = (q - (q % W)) / W - my
        reach = Math.max(reach, Math.hypot(dx, dy))
      }
    const eyeR = reach + EYE_THIN + EYE_MARGIN
    const eye = { c: [mx, my], radii: new Array(OUTLINE_BINS).fill(eyeR) }
    // Where the rays may come in to, which is NOT that disc. Starting them all
    // on one circle leaves a bare ring round the eye — a hard halo, and the
    // editor is right that any shape a reader can name is the fault. So the
    // clip stays generous and the rays follow the eye's own reach instead, up
    // to a few pixels off its ink; what they cross inside the clip is the
    // ground the eye sits on, which is where they belong.
    const eyeInk = []
    for (let b = 0; b < OUTLINE_BINS; b++) {
      const a = (b / OUTLINE_BINS) * 2 * Math.PI
      const ux = Math.cos(a)
      const uy = Math.sin(a)
      let last = 0
      for (let r = 1; r < 300; r += 1) {
        const xi = Math.round(mx + r * ux)
        const yi = Math.round(my + r * uy)
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) break
        if (eyeMask[yi * W + xi]) last = r
      }
      eyeInk.push(last + EYE_THIN)
    }

    // --- the fan's rim, and the ink round it -----------------------------
    const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))
    const outer = new Float64Array(BINS)
    for (let b = 0; b < BINS; b++) {
      const a = ((b + 0.5) / BINS) * 2 * Math.PI
      const ux = Math.cos(a)
      const uy = Math.sin(a)
      let last = 0
      for (let r = Math.min(W, H) * 0.11; r < far; r += 1)
        if (at(cx + r * ux, cy + r * uy) > INK) last = r
      outer[b] = last
    }
    const halfWindow = Math.round(BINS / 48)
    const env = new Float64Array(BINS)
    for (let b = 0; b < BINS; b++) {
      const v = []
      for (let k = -halfWindow; k <= halfWindow; k++) v.push(outer[(b + k + BINS) % BINS])
      v.sort((p, q) => p - q)
      env[b] = v[Math.floor(0.9 * (v.length - 1))]
    }
    const duty = []
    for (let b = 0; b < BINS; b++) {
      const a = ((b + 0.5) / BINS) * 2 * Math.PI
      const r = env[b] * DUTY_AT
      duty.push(at(cx + r * Math.cos(a), cy + r * Math.sin(a)) > INK)
    }

    // --- how many rays the engraving has, radius by radius ---------------
    //
    // Near the eye this fan runs six or nine strokes and out at the rim near a
    // hundred: the rays multiply outward, which is why the engraving is open
    // round the eye and dense at the edge. Carried rays all starting together
    // would print a hard collar of ink round the eye instead, so each one is
    // given a radius to begin at and the count follows the engraving's own.
    const eyeMax = Math.max(...eyeInk)
    // Only as far as a whole circle still fits inside the picture: past that a
    // count is taken over the arc that is left and reads low — measured, the
    // rim came back as 4 rays where the engraving sets near a hundred.
    const rimMax = Math.min(Math.max(...env), 0.95 * Math.min(cx, W - cx, cy, H - cy))
    const counts = []
    for (let k = 0; k <= 24; k++) {
      const r = eyeMax + ((rimMax - eyeMax) * k) / 24
      let runs = 0
      let was = false
      const n = Math.max(720, Math.round(r * 3))
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 2 * Math.PI
        const on = at(cx + r * Math.cos(a), cy + r * Math.sin(a)) > INK
        if (on && !was) runs++
        was = on
      }
      counts.push([r, runs])
    }

    // The fade, as a greyscale raster the size of the trace's own box: white
    // where the engraving prints in full, black past its rim. A raster rather
    // than a radial gradient because the rim is not an ellipse — it is whatever
    // the press cut, and `env` is the measurement of it.
    const fade = document.createElement('canvas')
    fade.width = Math.round(FADE_PX)
    fade.height = Math.round((FADE_PX * H) / W)
    const fx = fade.getContext('2d')
    const fimg = fx.createImageData(fade.width, fade.height)
    for (let y = 0; y < fade.height; y++)
      for (let x = 0; x < fade.width; x++) {
        const px = (x + 0.5) * (W / fade.width)
        const py = (y + 0.5) * (H / fade.height)
        const dx = px - cx
        const dy = py - cy
        const r = Math.hypot(dx, dy)
        const b = Math.round(((Math.atan2(dy, dx) + 2 * Math.PI) / (2 * Math.PI)) * BINS) % BINS
        const rim = env[b] || 1
        const t = (r - rim * FADE_FROM) / (rim * (FADE_TO - FADE_FROM))
        const u = Math.min(1, Math.max(0, t))
        const v = Math.round(255 * (1 - u * u * (3 - 2 * u)))
        const i = (y * fade.width + x) * 4
        fimg.data[i] = v
        fimg.data[i + 1] = v
        fimg.data[i + 2] = v
        fimg.data[i + 3] = 255
      }
    fx.putImageData(fimg, 0, 0)

    return {
      W,
      H,
      centre,
      fadeUrl: fade.toDataURL('image/png'),
      env: [...env],
      duty,
      stars,
      eye,
      counts,
      eyeInk,
      share: radialShare(cx, cy)
    }
  },
  { svg, BINS, DUTY_AT, INK, EYE_MARGIN, EYE_THIN, FADE_FROM, FADE_TO, FADE_PX }
)
await browser.close()

const { W, H, centre, fadeUrl, env, duty, stars, eye, eyeInk, counts, share } = measured

/** Runs of consecutive true bins, wrapping round the circle. */
function runsOf(flags) {
  const n = flags.length
  const runs = []
  let start = -1
  for (let b = 0; b < n * 2; b++) {
    const on = flags[b % n]
    if (on && start < 0) start = b
    else if (!on && start >= 0) {
      if (b - start <= n) runs.push([start % n, b - start])
      start = -1
      if (b >= n) break
    }
    if (b >= n && start < 0) break
  }
  return runs
}

const rays = runsOf(duty).filter(([, len]) => len >= 4)

/**
 * A run far wider than the rest is rays the trace lost, not one wide ray.
 *
 * Where the engraving's slits close up — the merged ink below the bottom star,
 * and three other places on this emblem — one reading at a single radius sees
 * several rays as one, and carried out at that width they print as blots among
 * hairlines. So the carried width is capped at the runs' ninth decile.
 */
const widths = rays.map(([, len]) => len).sort((a, b) => a - b)
const cap = widths[Math.floor(0.9 * (widths.length - 1))]

const VH = Math.round((W * FRAME_HEIGHT_IN) / emblemWidthIn)
const VW = Math.round(VH * BOX_ASPECT)
const EX = VW / 2
const EY = VH * eyeAt
const rOuter = Math.hypot(Math.max(EX, VW - EX), Math.max(EY, VH - EY)) * 1.06
const coreTo = CORE_AT_MAX_REACH ? Math.max(...env) : 0

const angleOf = (b) => ((b + 0.5) / BINS) * 2 * Math.PI
const point = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`
/** A traced figure's outline, placed in the artwork's own box. */
const outlinePath = (fig) =>
  'M' +
  fig.radii
    .map((r, b) => {
      const a = (b / fig.radii.length) * 2 * Math.PI
      return point(
        EX + (fig.c[0] - centre[0]) + r * Math.cos(a),
        EY + (fig.c[1] - centre[1]) + r * Math.sin(a)
      )
    })
    .join('L') +
  'Z'

/** Where a ray at this angle may begin: just clear of the eye's own ink. */
const eyeEdge = (angle) => {
  const n = eyeInk.length
  const b = Math.round((angle / (2 * Math.PI)) * n) % n
  return eyeInk[(b + n) % n]
}

/**
 * The radius each ray begins at, so the count follows the engraving's own.
 *
 * This fan sets seventeen strokes just outside the eye and ninety-four at the
 * rim — the rays multiply outward, which is why the engraving is open round the
 * eye and dense at its edge. Carried rays all starting together would print a
 * collar of ink round the eye that the engraving does not have, and the
 * engraving is still there to be doubled: `counts` is runs of ink round a
 * circle, measured at two dozen radii, and each ray is given a radius to begin
 * at from that curve. The order is fixed by a seed, so the file is the same on
 * every run.
 */
const order = rays.map((_, i) => i)
for (let i = order.length - 1; i > 0; i--) {
  const h = Math.imul(i + 1, 2246822519) >>> 0
  const j = h % (i + 1)
  ;[order[i], order[j]] = [order[j], order[i]]
}
const birth = new Array(rays.length)
const finalCount = counts.at(-1)[1] || rays.length
order.forEach((rayIndex, rank) => {
  const wanted = ((rank + 1) / rays.length) * finalCount
  const row = counts.find(([, n]) => n >= wanted)
  birth[rayIndex] = row ? row[0] : counts.at(-1)[0]
})

/**
 * Smooth noise in one dimension, from a seed, so every run writes the same file.
 *
 * A hash at each integer, cosine-interpolated between them, which is all the
 * wander needs — it is a wobble with a length, not a spectrum.
 */
function noise(seed, t) {
  const hash = (n) => {
    let h = Math.imul(n ^ seed, 2246822519)
    h = Math.imul(h ^ (h >>> 13), 3266489917)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295 - 0.5
  }
  const i = Math.floor(t)
  const f = t - i
  const w = (1 - Math.cos(f * Math.PI)) / 2
  return hash(i) * (1 - w) + hash(i + 1) * w
}

const wedges = []
let dashes = 0
rays.forEach(([start, len], index) => {
  const mid = angleOf((start + (len - 1) / 2) % BINS)
  const halfAngle = ((Math.min(len, cap) / BINS) * 2 * Math.PI) / 2
  const ux = Math.cos(mid)
  const uy = Math.sin(mid)
  const nx = -uy
  const ny = ux
  const seed = Math.imul(index + 1, 2654435761)
  const from = Math.max(birth[index], eyeEdge(mid) + 8)

  /** Half-width at a radius: the fan's own wedge to the core, thinning past it. */
  const halfAt = (r) =>
    r <= coreTo ? halfAngle * r : halfAngle * coreTo * Math.pow(r / coreTo, TAPER)

  /**
   * A point on the ray's wandering centre line, and its half-width there.
   *
   * `along` is how far through its own dash the point is, 0 to 1, which is what
   * draws the stroke's ends to a point.
   */
  const spine = (u, along) => {
    const r = Math.exp(u)
    const nib = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, along))), NIB)
    const w = halfAt(r) * (1 + WIDTH_VAR * 2 * noise(seed + 1, u / WIDTH_LN)) * nib
    const off = WOBBLE * halfAt(r) * 2 * noise(seed, u / WOBBLE_LN)
    return { x: EX + r * ux + off * nx, y: EY + r * uy + off * ny, w: Math.max(0.15, w) }
  }

  const uEnd = Math.log(rOuter)
  let u = Math.log(from)
  while (u < uEnd) {
    const end = Math.min(uEnd, u + DASH_LN * (0.6 + 1.3 * (noise(seed + 2, u / DASH_LN) + 0.5)))
    const left = []
    const right = []
    for (let t = u; ; t = Math.min(end, t + STEP_LN)) {
      const p = spine(t, (t - u) / (end - u))
      left.push(point(p.x + p.w * nx, p.y + p.w * ny))
      right.push(point(p.x - p.w * nx, p.y - p.w * ny))
      if (t >= end) break
    }
    wedges.push(`M${left.join('L')}L${right.reverse().join('L')}Z`)
    dashes++
    const gap = Math.log1p(GAP_PX / Math.exp(end))
    u = end + gap * (0.5 + 1.4 * (noise(seed + 3, u / Math.max(gap, 1e-6)) + 0.5))
  }
})

// The stars are holes in the RAY field, as they are holes in the engraving's
// own hatching: white shapes the ink encloses, not ink. A mask rather than an
// even-odd subpath, because two overlapping dashes under one star would invert
// the rule back to ink.
//
// A mask and a transform go on SEPARATE groups, for both of these. A mask —
// like a clip-path — is resolved in the user space of the element that carries
// it, so an element carrying both has its mask moved by its own transform as
// well, which once put the eye's outline a second emblem's width away and drew
// nothing at all.
const starPath = stars.map(outlinePath).join('')
const body = /\sd="([^"]+)"/.exec(svg)[1]
const traceX = EX - centre[0]
const traceY = EY - centre[1]

await writeFile(
  resolve(out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}">
<defs>
<mask id="stars" maskUnits="userSpaceOnUse" x="0" y="0" width="${VW}" height="${VH}">
<rect width="${VW}" height="${VH}" fill="#fff"/><path fill="#000" d="${starPath}"/>
</mask>
<mask id="rim" maskUnits="userSpaceOnUse" x="0" y="0" width="${VW}" height="${VH}">
<image x="${traceX.toFixed(1)}" y="${traceY.toFixed(1)}" width="${W}" height="${H}" href="${fadeUrl}"/>
</mask>
</defs>
<path fill="#141414" mask="url(#stars)" d="${wedges.join('')}"/>
<g mask="url(#rim)"><g transform="translate(${traceX.toFixed(1)} ${traceY.toFixed(1)})"><path fill="#141414" fill-rule="evenodd" d="${body}"/></g></g>
</svg>\n`
)

console.log(
  `${src} is ${W}x${H}; it radiates from ${centre[0].toFixed(1)}, ${centre[1].toFixed(1)}`
)
console.log(
  `  = ${(centre[0] / W).toFixed(4)}, ${(centre[1] / H).toFixed(4)} of its box, at a radial share of ${share.toFixed(4)}`
)
console.log(
  `${stars.length} stars traced off the pixels, ${stars.length - 6} of them by seed; the eye reaches ${Math.max(...eye.radii).toFixed(0)}px`
)
console.log(
  `the engraving runs ${counts[0][1]} rays at ${counts[0][0].toFixed(0)}px and ${counts.at(-1)[1]} at ${counts.at(-1)[0].toFixed(0)}px`
)
console.log(
  `${rays.length} rays carried out in ${dashes} dashes, the fan's weight held to ${coreTo.toFixed(0)}px`
)
console.log(
  `${out}: ${VW}x${VH}, the emblem ${emblemWidthIn}in wide with its centre at ${(EY / VH).toFixed(4)} down the board`
)
