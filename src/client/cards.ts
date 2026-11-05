// Sign in / create account cards, matching the retrac.space project cards:
// a pixelated, slowed-down video loop that sharpens in a ripple on hover.
import { motion } from "./motion";
import { titleReady } from "./title";

export type Mode = "sign-in" | "sign-up";

const MAX_PIXEL = 16; // how chunky when idle
const IDLE_SPEED = 0.15; // playback speed when not hovered
const LEVELS = [10, 6, 4, 2, 1]; // pixel sizes of each ripple ring, outer -> inner
const RIPPLE_TIME = 0.9; // seconds for the ripple to cover the whole card
const BAND = 0.16; // ring thickness (fraction of card diagonal)

const options: { mode: Mode; name: string; href: string; video: string }[] = [
  {
    mode: "sign-in",
    name: "Sign In",
    href: "/sign-in",
    video: "/videos/login-loop.mp4",
  },
  {
    mode: "sign-up",
    name: "Create Account",
    href: "/sign-up",
    video: "/videos/signup-loop.mp4",
  },
];

interface Card {
  mode: Mode;
  el: HTMLAnchorElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  hover: boolean;
  r: number;
  ox: number;
  oy: number;
  speed: number;
  dpr: number;
  layers: Map<
    number,
    { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }
  >;
}

const container = document.querySelector<HTMLElement>("#mode-cards")!;
const cards: Card[] = options.map(({ mode, name, href, video: src }) => {
  const el = document.createElement("a");
  el.className = "card";
  el.href = href;
  el.dataset.nav = "";
  el.innerHTML = `<canvas aria-hidden="true"></canvas><video hidden src="${src}" loop muted playsinline preload="auto" aria-hidden="true"></video><div class="info"><span class="card-title">${name}</span></div>`;
  container.appendChild(el);
  const canvas = el.querySelector("canvas")!;
  const video = el.querySelector("video")!;
  video.playbackRate = IDLE_SPEED;
  const card: Card = {
    mode,
    el,
    canvas,
    ctx: canvas.getContext("2d")!,
    video,
    hover: false,
    r: 0,
    ox: 0.5,
    oy: 0.5,
    speed: IDLE_SPEED,
    dpr: 1,
    layers: new Map(),
  };
  const setOrigin = (event: MouseEvent) => {
    const rect = el.getBoundingClientRect();
    card.ox = (event.clientX - rect.left) / rect.width;
    card.oy = (event.clientY - rect.top) / rect.height;
  };
  el.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") return;
    if (card.r < 0.05) setOrigin(event); // a new ripple starts where the cursor lands
    card.hover = true;
  });
  el.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") card.hover = false;
  });
  el.addEventListener("click", (event) => {
    // Touch: the tapped card ripples sharp from the tap point.
    if (matchMedia("(hover: none)").matches) {
      for (const other of cards) {
        if (other === card) continue;
        other.hover = false;
        other.el.classList.remove("active");
      }
      if (!card.hover && card.r < 0.05) setOrigin(event);
      card.hover = true;
      el.classList.add("active");
    }
    // Re-selecting the current option would only reset the form.
    const plain =
      !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0;
    if (plain && el.hasAttribute("aria-current")) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  return card;
});

function playVideo(video: HTMLVideoElement) {
  // Explicit playback also supports muted video sources hidden behind a canvas.
  if (!motion.matches) video.play().catch(() => {});
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  for (const card of cards) {
    const rect = card.el.getBoundingClientRect();
    card.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    card.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    card.dpr = dpr;
  }
}

export function showModeCards(mode: Mode | null) {
  container.hidden = !mode;
  for (const card of cards) {
    if (card.mode === mode) card.el.setAttribute("aria-current", "page");
    else card.el.removeAttribute("aria-current");
    if (mode) playVideo(card.video);
    else card.video.pause();
  }
  if (mode) resize();
}

// Center-crop like object-fit: cover before the pixel/ripple pass.
function drawVideo(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  video: HTMLVideoElement,
) {
  c.fillStyle = "#0b0620";
  c.fillRect(0, 0, w, h);
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
  const sw = w / scale,
    sh = h / scale;
  c.drawImage(
    video,
    (video.videoWidth - sw) / 2,
    (video.videoHeight - sh) / 2,
    sw,
    sh,
    0,
    0,
    w,
    h,
  );
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
  if (container.hidden) return;
  for (const card of cards) {
    card.speed +=
      ((card.hover ? 1 : IDLE_SPEED) - card.speed) * Math.min(1, dt * 4);
    card.video.playbackRate = card.speed;
    card.r = Math.min(
      1,
      Math.max(0, card.r + ((card.hover ? 1 : -1.4) * dt) / RIPPLE_TIME),
    );

    const W = card.canvas.width,
      H = card.canvas.height,
      ctx = card.ctx;
    ctx.imageSmoothingEnabled = false;

    // Render the video at a given pixel size and stretch it over the card.
    const layer = (px: number) => {
      let target = card.layers.get(px);
      if (!target) {
        const canvas = document.createElement("canvas");
        target = { canvas, ctx: canvas.getContext("2d")! };
        card.layers.set(px, target);
      }
      const scale = Math.max(1, px * card.dpr);
      const lw = Math.max(2, Math.ceil(W / scale)),
        lh = Math.max(2, Math.ceil(H / scale));
      if (target.canvas.width !== lw || target.canvas.height !== lh) {
        target.canvas.width = lw;
        target.canvas.height = lh;
      }
      drawVideo(target.ctx, lw, lh, card.video);
      ctx.drawImage(target.canvas, 0, 0, lw, lh, 0, 0, W, H);
    };

    const ox = card.ox * W,
      oy = card.oy * H;
    const maxD = Math.max(
      Math.hypot(ox, oy),
      Math.hypot(W - ox, oy),
      Math.hypot(ox, H - oy),
      Math.hypot(W - ox, H - oy),
    );
    const band = BAND * Math.hypot(W, H);
    const total = maxD + band * (LEVELS.length - 1);
    const eased =
      card.r < 0.5 ? 2 * card.r * card.r : 1 - Math.pow(-2 * card.r + 2, 2) / 2;
    const front = eased * total;

    if (card.r <= 0) {
      layer(MAX_PIXEL);
      continue;
    }
    if (front - band * (LEVELS.length - 1) >= maxD) {
      layer(1);
      continue;
    }

    // Base: fully pixelated, then sharper rings clipped inside each other.
    layer(MAX_PIXEL);
    LEVELS.forEach((px, i) => {
      const rad = front - i * band;
      if (rad <= 0) return;
      // Clip to whole pixel blocks (not a smooth circle) so the edge stays blocky.
      const cell = MAX_PIXEL * card.dpr;
      ctx.save();
      ctx.beginPath();
      for (let y = 0; y < H; y += cell)
        for (let x = 0; x < W; x += cell)
          if (Math.hypot(x + cell / 2 - ox, y + cell / 2 - oy) < rad)
            ctx.rect(x, y, cell, cell);
      ctx.clip();
      layer(px);
      ctx.restore();
    });
  }
}

addEventListener("resize", () => {
  if (!container.hidden) resize();
});
requestAnimationFrame(frame);
void titleReady.then(() =>
  cards.forEach((card, i) =>
    setTimeout(
      () => card.el.classList.add("shown"),
      motion.matches ? 0 : i * 140,
    ),
  ),
);
