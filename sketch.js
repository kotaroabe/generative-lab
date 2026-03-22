/**
 * Generative Font Lab — mosaic grid from typographic sampling.
 */

let inkGrid = null;

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

/** Apply font to a p5.Graphics buffer via 2D context — textFont() truncates at commas. */
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
  noLoop();
  bindControls();
  syncLabels();
  regenerate();
}

function draw() {
  const p = readParams();
  drawScene(p);
}

function readParams() {
  const g = (id) => document.getElementById(id);
  const num = (id) => Number(g(id).value);
  const val = (id) => g(id).value;
  const n = constrain(max(1, Math.round(num("inpGridN")) || 1), 1, 256);
  return {
    text: val("inpText") || "a",
    cols: n,
    rows: n,
    cellShape: val("inpCellShape") || "square",
    pad: num("inpPad"),
    gutter: num("inpGutter"),
    edge: num("inpEdge") / 100,
    grain: num("inpGrain") / 100,
    spread: num("inpSpread") / 100,
    thresh: num("inpThresh") / 100,
    mosaicBgHex: val("inpMosaicBg"),
    mosaicInkHex: val("inpMosaicInk"),
    seed: num("inpSeed") | 0,
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
    "inpCellShape",
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
  document.getElementById("btnRandomSeed").addEventListener("click", () => {
    document.getElementById("inpSeed").value = String(floor(random(1, 9999999)));
    syncLabels();
    regenerate();
  });
  document.getElementById("btnRedraw").addEventListener("click", () => regenerate());
  document.getElementById("btnExport").addEventListener("click", () => {
    saveCanvas("generative-font-" + Date.now(), "png");
  });
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
function sampleInkGrid(str, cols, rows, threshSoft, fontScale, samplingDetail, familyListCSS) {
  let pxPerCell = constrain(Math.round(Number(samplingDetail)) || 4, 2, 16);
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
      let sum = 0, count = 0;
      const x0 = floor(i * cw), y0 = floor(j * ch);
      const x1 = min(ceil((i + 1) * cw), pw);
      const y1 = min(ceil((j + 1) * ch), ph);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += pg.pixels[4 * (y * pw + x)];
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
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const ni = i + dx, nj = j + dy;
    if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
    if (grid[nj][ni] < v * 0.55) hits++;
  }
  return hits / 4;
}

/**
 * Returns { cellW, cellH, ox, oy } for the current cell shape.
 * The grid always fits inside GRID_VIEW_FRAC of the shorter canvas side.
 * - square  1:1 → N×N tiles, square
 * - tall    1:2 → N×N tiles, each twice as tall as wide
 * - wide    2:1 → N×N tiles, each twice as wide as tall
 */
const GRID_VIEW_FRAC = 0.84;

function cellLayout(p) {
  const innerW = width - 2 * p.pad;
  const innerH = height - 2 * p.pad;
  const maxSide = min(innerW, innerH) * GRID_VIEW_FRAC;
  const N = p.cols;
  let cellW, cellH;
  if (p.cellShape === "wide") {
    // each tile 2:1 — scale so total width still fits maxSide
    const base = maxSide / (N * 2);
    cellW = base * 2;
    cellH = base;
  } else if (p.cellShape === "tall") {
    // each tile 1:2 — scale so total height still fits maxSide
    const base = maxSide / (N * 2);
    cellW = base;
    cellH = base * 2;
  } else {
    // square 1:1
    const base = maxSide / N;
    cellW = cellH = base;
  }
  const gridW = N * cellW;
  const gridH = N * cellH;
  const ox = (width - gridW) / 2;
  const oy = (height - gridH) / 2;
  return { cellW, cellH, ox, oy };
}

/**
 * Draw scratch marks inside one tile — horizontal-ish lines that mimic
 * relief print / woodblock texture, keyed on tile ink level.
 */
function drawScratchCell(px, py, tw, th, ink, grainAmt, paper, inkCol) {
  if (grainAmt < 0.02) return;
  const count = floor(3 + grainAmt * 22);
  for (let k = 0; k < count; k++) {
    const ry = py + random() * th;
    // start slightly outside tile edge so scratches can bleed to edge
    const rx = px - tw * 0.05 + random() * tw * 1.1;
    const len = tw * (0.25 + random() * 0.85);
    const angle = (random() - 0.5) * 0.28;   // ≈ ±16° tilt in radians
    const sw = 0.3 + random() * 1.15;
    const alpha = grainAmt * 58 * (0.12 + random() * 0.88);

    // Mix of light marks (paper peeking through) and dark marks (ink)
    const isLight = random() > 0.5 + ink * 0.25; // more light marks on dark tiles
    let sr, sg, sb;
    if (isLight) {
      // slightly lighter than tile base — paper tone bleeding through
      const t = 0.08 + random() * 0.18;
      sr = lerp(red(inkCol), red(paper), ink * 0.5 + t);
      sg = lerp(green(inkCol), green(paper), ink * 0.5 + t);
      sb = lerp(blue(inkCol), blue(paper), ink * 0.5 + t);
    } else {
      // slightly darker than tile base — deeper ink deposit
      const t = constrain(ink + 0.15 + random() * 0.25, 0, 1);
      sr = lerp(red(paper), red(inkCol), t);
      sg = lerp(green(paper), green(inkCol), t);
      sb = lerp(blue(paper), blue(inkCol), t);
    }
    stroke(sr, sg, sb, alpha);
    strokeWeight(sw);
    // Nearly horizontal: vertical component is ~15% of horizontal so it reads as scratch
    line(rx, ry, rx + cos(angle) * len, ry + sin(angle) * len * 0.15);
  }
  noStroke();
}

function drawScene(p) {
  if (!inkGrid) return;
  const cols = p.cols;
  const rows = p.rows;
  const { cellW, cellH, ox, oy } = cellLayout(p);

  background(p.mosaicBgHex);
  const paper = color(p.mosaicBgHex);
  const inkC  = color(p.mosaicInkHex);
  const hi    = lerpColor(paper, inkC, 0.38);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let ink = inkGrid[j][i];
      if (ink < 0.02) continue;

      const edge = neighborEdge(inkGrid, i, j, cols, rows);
      const soften = lerp(1, 1 - p.edge * 0.85, edge);
      let level = ink * soften;

      const noiseShift =
        (noise(i * 0.35 + p.seed * 0.01, j * 0.35, p.seed * 0.02) - 0.5) * p.spread;
      const randJitter = (random() - 0.5) * p.spread * 0.35;
      level = constrain(level + noiseShift + randJitter, 0, 1);

      const base = lerpColor(paper, inkC, level);
      const tileColor = lerpColor(base, hi, edge * p.edge * 0.4);
      const g = max(0, p.gutter);
      const tw = max(0.5, cellW - g);
      const th = max(0.5, cellH - g);
      const px = ox + i * cellW + g / 2;
      const py = oy + j * cellH + g / 2;

      noStroke();
      fill(tileColor);
      rect(px, py, tw, th);

      drawScratchCell(px, py, tw, th, level, p.grain, paper, inkC);
    }
  }
}
