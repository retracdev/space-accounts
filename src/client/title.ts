// The "accounts" heading, matching the retrac.space title: it resolves from
// chunky pixels to sharp, then a cursor-following pixel wave plays on hover.
import { motion } from "./motion";

const TEXT = "accounts";
const COLOR = "#f3f0ff";
const STEPS = [56, 40, 28, 20, 14, 10, 7, 5, 3, 2, 1]; // pixel sizes, coarse -> sharp
const STEP_MS = 95;

const canvas = document.querySelector<HTMLCanvasElement>("#title")!;
const ctx = canvas.getContext("2d")!;
const off = document.createElement("canvas");
const offCtx = off.getContext("2d")!;
let reduceMotion = motion.matches;
let titlePx = reduceMotion ? 1 : STEPS[0]!;
let titleAlpha = reduceMotion ? 1 : 0;
let fontSize = 0; // device pixels
let cssWidth = 1;
let weight = "700";
let spacing = 0; // em

const font = (size: number) =>
  `${weight} ${size}px "Space Grotesk", system-ui, sans-serif`;

function size() {
  const css = getComputedStyle(canvas.parentElement!);
  const fs = parseFloat(css.fontSize);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  weight = css.fontWeight;
  spacing = (parseFloat(css.letterSpacing) || 0) / fs;
  ctx.font = font(fs);
  ctx.letterSpacing = `${spacing * fs}px`;
  const w = Math.ceil(ctx.measureText(TEXT).width + fs * 0.1);
  const h = Math.ceil(fs * 1.3);
  cssWidth = w;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  fontSize = fs * dpr;
}

function draw() {
  const W = canvas.width,
    H = canvas.height;
  const px = Math.max(1, titlePx * (W / cssWidth));
  const lw = Math.max(1, Math.ceil(W / px)),
    lh = Math.max(1, Math.ceil(H / px));
  if (off.width !== lw || off.height !== lh) {
    off.width = lw;
    off.height = lh;
  }

  // Render the text small, then stretch it up with smoothing off.
  const fs = fontSize * (lw / W);
  offCtx.clearRect(0, 0, lw, lh);
  offCtx.font = font(fs);
  offCtx.letterSpacing = `${spacing * fs}px`;
  offCtx.textBaseline = "middle";
  offCtx.fillStyle = COLOR;
  offCtx.fillText(TEXT, fs * 0.05, lh / 2);

  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = titleAlpha;
  ctx.drawImage(off, 0, 0, lw, lh, 0, 0, W, H);
  ctx.globalAlpha = 1;
}

function play() {
  return new Promise<void>((done) => {
    if (reduceMotion) {
      draw();
      done();
      return;
    }
    const start = performance.now();
    const total = STEPS.length * STEP_MS;
    const tick = (now: number) => {
      if (reduceMotion) {
        titlePx = 1;
        titleAlpha = 1;
        draw();
        done();
        return;
      }
      // rAF's timestamp can land slightly before `start`, so clamp at 0.
      const p = Math.min(1, Math.max(0, (now - start) / total));
      titlePx =
        STEPS[Math.min(STEPS.length - 1, Math.floor(p * STEPS.length))]!;
      titleAlpha = Math.min(1, p * 3);
      draw();
      if (p < 1) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
}

/* ---------- Hover: a small, cursor-following pixel wave ---------- */
const wave = {
  active: false,
  ready: false,
  strength: 0,
  x: 0.5,
  y: 0.5,
  canvas: document.createElement("canvas"),
};
const waveCtx = wave.canvas.getContext("2d")!;

function track(event: PointerEvent) {
  if (reduceMotion || event.pointerType === "touch") return;
  const rect = canvas.getBoundingClientRect();
  wave.x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  wave.y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  wave.active = true;
}
canvas.addEventListener("pointerenter", track);
canvas.addEventListener("pointermove", track);
for (const name of ["pointerleave", "pointercancel"])
  canvas.addEventListener(name, () => (wave.active = false));
addEventListener("blur", () => (wave.active = false));

function drawWave(now: number, dt: number) {
  if (reduceMotion || !wave.ready) return;
  const target = wave.active ? 1 : 0;
  if (!target && wave.strength === 0) return;
  wave.strength += (target - wave.strength) * (1 - Math.exp(-dt * 14));
  if (!target && wave.strength < 0.005) wave.strength = 0;

  // Restore a pristine heading every frame so moving the cursor leaves no trail.
  draw();
  if (!wave.strength) return;
  const W = canvas.width,
    H = canvas.height,
    fs = fontSize;
  const cell = Math.max(2, Math.round(3 * (W / cssWidth)));
  const lw = Math.ceil(W / cell),
    lh = Math.ceil(H / cell);
  if (wave.canvas.width !== lw || wave.canvas.height !== lh) {
    wave.canvas.width = lw;
    wave.canvas.height = lh;
  }
  waveCtx.clearRect(0, 0, lw, lh);
  waveCtx.drawImage(off, 0, 0, off.width, off.height, 0, 0, lw, lh);

  const center = wave.x * W;
  const radius = fs * 0.72; // about two to three letters, independent of screen size
  const strip = W / lw;
  const start = Math.max(0, Math.floor((center - radius) / strip));
  const end = Math.min(lw, Math.ceil((center + radius) / strip));
  // A stepped clock and whole-pixel offsets give this a digital, wavy cadence.
  const time = Math.floor(now / 55) * 0.055;
  for (let i = start; i < end; i++) {
    const x = i * strip;
    const distance = Math.min(1, Math.abs(x + strip / 2 - center) / radius);
    const mix = (1 - distance * distance) ** 2 * wave.strength;
    const offset =
      Math.round(
        (Math.sin(((x - center) / fs) * 12 - time * 8 + wave.y * 3) *
          fs *
          0.055 *
          mix) /
          cell,
      ) * cell;
    ctx.clearRect(x, 0, strip, H);
    ctx.globalAlpha = 1 - mix;
    ctx.drawImage(
      off,
      (x * off.width) / W,
      0,
      (strip * off.width) / W,
      off.height,
      x,
      0,
      strip,
      H,
    );
    ctx.globalAlpha = mix;
    ctx.drawImage(wave.canvas, i, 0, 1, lh, x, offset, strip, H);
  }
  ctx.globalAlpha = 1;
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  drawWave(now, dt);
  requestAnimationFrame(frame);
}

motion.onChange(() => {
  reduceMotion = motion.matches;
  if (reduceMotion) {
    wave.active = false;
    wave.strength = 0;
    titlePx = 1;
    titleAlpha = 1;
    draw();
  }
});
addEventListener("resize", () => {
  size();
  draw();
});

// Wait for the title weight before measuring (but never hang on it).
const fontReady = document.fonts.load(font(100)).catch(() => {});
export const titleReady = Promise.race([
  fontReady,
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).then(async () => {
  size();
  requestAnimationFrame(frame);
  await play();
  wave.ready = true;
});
