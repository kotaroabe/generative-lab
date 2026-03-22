/**
 * Generative Font Lab — mosaic grid from typographic sampling.
 */

let inkGrid = null;
/** Last px/tile used when resampling (for detail drift). */
let lastResampleDetail = null;

/** CSS font-family list for canvas (quoted names with spaces — full string for ctx.font). */
function fontStackFor(key) {
  switch (key) {
    case "sans":
      return '"Helvetica Neue", Helvetica, Arial, sans-serif';
    case "gothic":
      return '"Century Gothic", "Franklin Gothic Medium", "Yu Gothic UI", Meiryo, sans-serif';
    case "serif":
    default:
      return 'Georgia, "Times New Roman", serif';
  }
}

/** Apply font to a p5.Graphics buffer; must use 2d context — textFont() truncates at commas. */
function syncGraphicsCanvasFont(pg, sizePx, familyListCSS) {
  const ctx = pg.drawingContext || (pg.canvas && pg.canvas.getContext("2d"));
  if (!ctx) return;
  const sz = max(1, Math.round(sizePx));
  ctx.font = `${sz}px ${familyListCSS}`;
}

/** Draw with ctx.fillText so p5.text() cannot reset ctx.font to the wrong face. */
function drawRasterText(pg, display, pw, ph, familyListCSS) {
  const sz = pg.textSize();
  const ctx = pg.drawingContext || (pg.canvas && pg.canvas.getContext("2d"));
  syncGraphicsCanvasFont(pg, sz, familyListCSS);
  if (!ctx) {
    pg.text(display, pw / 2, ph / 2 + ph * 0.03);
    return;
  }
  ctx.fillStyle = "rgb(0,0,0)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineArr = display.split("\n");
  const lh = sz * 0.92;
  const nudge = ph * 0.03;
  const totalH = lineArr.length * lh;
  let y = ph / 2 + nudge - totalH / 2 + lh / 2;
  for (const raw of lineArr) {
    const line = raw.length ? raw : " ";
    ctx.fillText(line, pw / 2, y);
    y += lh;
  }
}

function clampCanvasDim(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 880;
  return constrain(Math.round(n), 200, 4096);
}

function readCanvasSize() {
  const g = (id) => document.getElementById(id);
  return {
    w: clampCanvasDim(g("inpCanvasW").value),
    h: clampCanvasDim(g("inpCanvasH").value),
  };
}

function resizeCanvasFromInputs() {
  const { w, h } = readCanvasSize();
  if (w !== width || h !== height) resizeCanvas(w, h);
  redraw();
}

function setup() {
  const host = document.getElementById("canvasHost");
  const { w, h } = readCanvasSize();
  const cnv = createCanvas(w, h);
  cnv.parent(host);
  pixelDensity(1);
  bindControls();
  syncLabels();
  regenerate();
}

function driftedSamplingDetail(p) {
  const pace = 0.000028 * (0.12 + p.detailPace * 1.88);
  const t = millis() * pace;
  const n = noise(t * 1.07 + p.seed * 0.00017, p.seed * 0.005 + 21.3);
  const jitter = (n - 0.5) * 2 * 3.5;
  return constrain(Math.round(p.samplingDetail + jitter), 2, 12);
}

function draw() {
  const p = readParams();
  if (p.detailDrift) {
    const d = driftedSamplingDetail(p);
    if (lastResampleDetail !== d) {
      lastResampleDetail = d;
      randomSeed(p.seed);
      noiseSeed(p.seed % 100000);
      inkGrid = sampleInkGrid(
        p.text,
        p.cols,
        p.rows,
        p.thresh,
        p.fontScale,
        d,
        p.fontStack,
      );
    }
  }
  drawScene(p);
}

function readParams() {
  const g = (id) => document.getElementById(id);
  const num = (id) => Number(g(id).value);
  const val = (id) => g(id).value;
  const animChk = g("inpAnimateTexture");
  const detailDriftChk = g("inpDetailDrift");
  const n = constrain(max(1, Math.round(num("inpGridN")) || 1), 1, 256);
  return {
    text: val("inpText") || "a",
    cols: n,
    rows: n,
    pad: num("inpPad"),
    gutter: num("inpGutter"),
    edge: num("inpEdge") / 100,
    grain: num("inpGrain") / 100,
    spread: num("inpSpread") / 100,
    thresh: num("inpThresh") / 100,
    mosaicBgHex: val("inpMosaicBg"),
    mosaicInkHex: val("inpMosaicInk"),
    seed: num("inpSeed") | 0,
    animate: !!(animChk && animChk.checked),
    detailDrift: !!(detailDriftChk && detailDriftChk.checked),
    detailPace: num("inpDetailPace") / 100,
    animSpeed: num("inpAnimSpeed") / 100,
    fontScale: num("inpFontScale") / 100,
    fontStack: fontStackFor(val("inpFontFamily")),
    samplingDetail: constrain(Math.round(num("inpSamplingDetail")), 2, 16),
  };
}

function syncLabels() {
  const p = readParams();
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = typeof v === "number" ? String(Math.round(v)) : v;
  };
  set("valGridN", `${p.cols} × ${p.rows}`);
  set("valPad", p.pad);
  set("valGutter", p.gutter);
  set("valEdge", Math.round(p.edge * 100));
  set("valGrain", Math.round(p.grain * 100));
  set("valSpread", Math.round(p.spread * 100));
  set("valThresh", Math.round(p.thresh * 100));
  set("valAnimSpeed", Math.round(p.animSpeed * 100));
  set("valDetailPace", Math.round(p.detailPace * 100));
  set("valFontScale", Math.round(p.fontScale * 100));
  set("valSamplingDetail", p.samplingDetail);
}

function bindControls() {
  const ids = [
    "inpText",
    "inpFontFamily",
    "inpFontScale",
    "inpMosaicBg",
    "inpMosaicInk",
    "inpGridN",
    "inpPad",
    "inpSamplingDetail",
    "inpGutter",
    "inpEdge",
    "inpGrain",
    "inpSpread",
    "inpThresh",
    "inpSeed",
  ];
  const onChange = () => {
    syncLabels();
    regenerate();
  };
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", onChange);
    el.addEventListener("change", onChange);
  });
  const commitCanvasSize = () => {
    const g = (id) => document.getElementById(id);
    g("inpCanvasW").value = String(clampCanvasDim(g("inpCanvasW").value));
    g("inpCanvasH").value = String(clampCanvasDim(g("inpCanvasH").value));
    resizeCanvasFromInputs();
  };
  ["inpCanvasW", "inpCanvasH"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", commitCanvasSize);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitCanvasSize();
      }
    });
  });
  const animChk = document.getElementById("inpAnimateTexture");
  if (animChk) {
    animChk.addEventListener("change", () => {
      syncLabels();
      applyLoopState();
      if (!readParams().animate && !readParams().detailDrift) redraw();
    });
  }
  const driftChk = document.getElementById("inpDetailDrift");
  if (driftChk) {
    driftChk.addEventListener("change", () => {
      syncLabels();
      applyLoopState();
      regenerate();
    });
  }
  const animSpd = document.getElementById("inpAnimSpeed");
  if (animSpd) {
    animSpd.addEventListener("input", () => syncLabels());
  }
  const detailPaceEl = document.getElementById("inpDetailPace");
  if (detailPaceEl) {
    detailPaceEl.addEventListener("input", () => syncLabels());
  }
  document.getElementById("btnRandomSeed").addEventListener("click", () => {
    document.getElementById("inpSeed").value = String(floor(random(1, 9999999)));
    syncLabels();
    regenerate();
  });
  document.getElementById("btnRedraw").addEventListener("click", () => {
    regenerate();
  });
  document.getElementById("btnExport").addEventListener("click", () => {
    saveCanvas("generative-font-" + Date.now(), "png");
  });
}

function applyLoopState() {
  const p = readParams();
  if (p.animate || p.detailDrift) loop();
  else noLoop();
}

function regenerate() {
  const p = readParams();
  randomSeed(p.seed);
  noiseSeed(p.seed % 100000);
  inkGrid = sampleInkGrid(
    p.text,
    p.cols,
    p.rows,
    p.thresh,
    p.fontScale,
    p.samplingDetail,
    p.fontStack,
  );
  lastResampleDetail = p.samplingDetail;
  applyLoopState();
  redraw();
}

/**
 * Shrink text until the laid-out block fits inside the raster buffer (no clipping).
 */
function fitTextToBuffer(pg, lines, pw, ph, startSize, familyListCSS) {
  const marginX = 0.93;
  const marginY = 0.9;
  const ctx = pg.drawingContext || (pg.canvas && pg.canvas.getContext("2d"));
  let size = max(4, startSize);
  let guard = 0;
  while (guard++ < 140) {
    pg.textSize(size);
    syncGraphicsCanvasFont(pg, size, familyListCSS);
    pg.textLeading(size * 0.92);
    let maxW = 0;
    for (const raw of lines) {
      const line = raw.length ? raw : " ";
      maxW = max(maxW, ctx ? ctx.measureText(line).width : pg.textWidth(line));
    }
    const lh = max(pg.textLeading(), size * 1.02);
    const blockH = lines.length * lh;
    if (maxW <= pw * marginX && blockH <= ph * marginY) break;
    size *= 0.965;
    if (size < 3.5) break;
  }
  pg.textSize(size);
  syncGraphicsCanvasFont(pg, size, familyListCSS);
  pg.textLeading(size * 0.92);
}

/**
 * Rasterize text to a buffer and collapse to [rows][cols] ink in 0..1.
 */
function sampleInkGrid(
  str,
  cols,
  rows,
  threshSoft,
  fontScale,
  samplingDetail,
  familyListCSS,
) {
  let pxPerCell = constrain(
    Math.round(Number(samplingDetail)) || 4,
    2,
    16,
  );
  const MIN_RASTER = 48;
  let pw = cols * pxPerCell;
  let ph = rows * pxPerCell;
  while ((pw < MIN_RASTER || ph < MIN_RASTER) && pxPerCell < 96) {
    pxPerCell += 1;
    pw = cols * pxPerCell;
    ph = rows * pxPerCell;
  }
  const pg = createGraphics(pw, ph);
  pg.pixelDensity(1);
  pg.background(255);
  pg.fill(0);
  pg.noStroke();
  pg.textAlign(CENTER, CENTER);
  const display = str.trim().length ? str : " ";
  const lines = display.split(/\n/).map((l) => l.replace(/\r/g, ""));
  const charCount = display.replace(/\n/g, "").length;
  const fs = constrain(Number(fontScale) || 1, 0.2, 2.5);
  const span = pxPerCell * max(cols, rows);
  const sizeGuess = span * (charCount > 4 ? 0.38 : 0.62) * fs;
  fitTextToBuffer(pg, lines, pw, ph, sizeGuess, familyListCSS);
  drawRasterText(pg, display, pw, ph, familyListCSS);

  pg.loadPixels();
  const cw = pw / cols;
  const ch = ph / rows;
  const grid = [];

  for (let j = 0; j < rows; j++) {
    grid[j] = [];
    for (let i = 0; i < cols; i++) {
      let sum = 0;
      let count = 0;
      const x0 = floor(i * cw);
      const y0 = floor(j * ch);
      const x1 = min(ceil((i + 1) * cw), pw);
      const y1 = min(ceil((j + 1) * ch), ph);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = 4 * (y * pw + x);
          sum += pg.pixels[idx];
          count++;
        }
      }
      const avg = count ? sum / count : 255;
      let ink = constrain((255 - avg) / 255, 0, 1);
      if (threshSoft > 0) {
        const t = 0.35 + threshSoft * 0.45;
        const k = 8 + threshSoft * 24;
        ink = 1 / (1 + exp(-k * (ink - t)));
      }
      grid[j][i] = ink;
    }
  }
  return grid;
}

function neighborEdge(grid, i, j, cols, rows) {
  const v = grid[j][i];
  if (v < 0.04) return 0;
  let hits = 0;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    const ni = i + dx;
    const nj = j + dy;
    if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
    const nv = grid[nj][ni];
    if (nv < v * 0.55) hits++;
  }
  return hits / 4;
}

/** Square N×N grid; cell size from shorter padded side so tiles stay square and centered. */
const GRID_VIEW_FRAC = 0.84;

function cellLayout(p) {
  const innerW = width - 2 * p.pad;
  const innerH = height - 2 * p.pad;
  const n = p.cols;
  const maxSide = min(innerW, innerH) * GRID_VIEW_FRAC;
  const cell = n > 0 ? maxSide / n : 1;
  const gridW = n * cell;
  const gridH = n * cell;
  const ox = (width - gridW) / 2;
  const oy = (height - gridH) / 2;
  return { cell, ox, oy, gridW, gridH };
}

/** Subtle RGB drift when animating — reads as a soft color wiggle on letter tiles. */
function wiggleInkColor(baseCol, p, i, j, ink, animT) {
  if (!p.animate) return baseCol;
  const a = animT * (0.9 + p.animSpeed * 0.7);
  const u = sin(a + i * 0.52 + ink * 7.1) * 0.5 + 0.5;
  const v = sin(a * 0.82 + j * 0.48 + ink * 6.2) * 0.5 + 0.5;
  const wv = sin(a * 1.1 + (i + j) * 0.31 + ink * 5) * 0.5 + 0.5;
  const amp = 10 + 8 * p.animSpeed;
  const dr = amp * (u - 0.5) * (0.4 + ink * 0.6);
  const dg = amp * (v - 0.5) * (0.35 + ink * 0.55);
  const db = (amp + 4) * (wv - 0.5) * (0.45 + ink * 0.5);
  return color(
    constrain(red(baseCol) + dr, 0, 255),
    constrain(green(baseCol) + dg, 0, 255),
    constrain(blue(baseCol) + db, 0, 255),
  );
}

function drawScene(p) {
  if (!inkGrid) return;
  const cols = p.cols;
  const rows = p.rows;
  const { cell, ox, oy } = cellLayout(p);
  const animT =
    p.animate ? millis() * 0.00055 * (0.35 + p.animSpeed * 1.65) : 0;

  background(p.mosaicBgHex);
  const paper = color(p.mosaicBgHex);
  const inkC = color(p.mosaicInkHex);
  const hi = lerpColor(paper, inkC, 0.38);
  const grainLight = lerpColor(paper, color(255), 0.55);
  const grainDark = lerpColor(inkC, color(0), 0.45);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let ink = inkGrid[j][i];
      if (ink < 0.02) continue;

      const edge = neighborEdge(inkGrid, i, j, cols, rows);
      const soften = lerp(1, 1 - p.edge * 0.85, edge);
      let level = ink * soften;

      const n =
        (noise(
          i * 0.35 + p.seed * 0.01,
          j * 0.35 + animT * 0.55,
          p.seed * 0.02 + animT * 0.25,
        ) -
          0.5) *
        p.spread;
      const rj = p.animate
        ? sin(animT * 1.75 + i * 0.31 + j * 0.29) * p.spread * 0.175
        : (random() - 0.5) * p.spread * 0.35;
      level = constrain(level + n + rj, 0, 1);

      const base = lerpColor(paper, inkC, level);
      const edgeTint = lerpColor(base, hi, edge * p.edge * 0.4);
      const g = max(0, p.gutter);
      const inner = max(0.5, cell - g);
      const px = ox + i * cell + g / 2;
      const py = oy + j * cell + g / 2;

      noStroke();
      fill(wiggleInkColor(edgeTint, p, i, j, ink, animT));
      rect(px, py, inner, inner);

      if (p.grain > 0.02) {
        const dots = floor(3 + p.grain * 14);
        for (let k = 0; k < dots; k++) {
          let gx;
          let gy;
          let a;
          let d;
          let light;
          if (p.animate) {
            gx =
              px +
              inner *
                noise(i * 0.37 + k * 0.11, j * 0.37 + animT * 0.4, animT * 0.08);
            gy =
              py +
              inner *
                noise(i * 0.37 + 19.2, j * 0.37 + k * 0.13 + animT * 0.35, animT);
            a =
              p.grain *
              42 *
              (0.28 +
                0.72 * noise(k * 0.21 + animT * 0.5, i + j * 0.7, animT * 0.12));
            d =
              inner *
              (0.08 +
                0.34 *
                  noise(i * 0.5 + k, j * 0.5 + animT * 0.25, 11.3 + animT * 0.03));
            light = noise(animT * 0.4, k * 0.3 + i * 0.02, j * 0.02) > 0.5;
          } else {
            gx = px + random(inner);
            gy = py + random(inner);
            a = p.grain * 42 * random(0.3, 1);
            light = random() < 0.5;
            d = random(0.6, inner * 0.42);
          }
          if (light) fill(red(grainLight), green(grainLight), blue(grainLight), a);
          else fill(red(grainDark), green(grainDark), blue(grainDark), a);
          circle(gx, gy, d);
        }
      }
    }
  }
}
