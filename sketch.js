/**
 * Generative Font Lab — mosaic grid from typographic sampling.
 */

let inkGrid = null;
/** Loaded user image (p5.Image) when Input → Image is used. */
let userImage = null;
/** Optional print/paper texture asset used in Striped block text rendering. */
let stripePrintTexture = null;
/** Stripe animation: legacy y-offset (kept for reset on toggle, unused in render). */
let stripeAnimOffset = 0;
/** Row-unit counter driving the row-by-row slide animation. */
let stripeRowOffset = 0;

/** Foreground + stripe pairs for Text color preset (striped block text). */
const TEXT_COLOR_PRESETS = {
  red: { ink: "#e00000", stripe: "#8a4300" },
  blue: { ink: "#14008f", stripe: "#7f8fff" },
  green: { ink: "#1c7f0d", stripe: "#e0bfd0" },
};

let _applyingTextColorPreset = false;
/** Cached mask graphics for stripe rendering — rebuilt only when text/layout changes. */
let _stripeCache = null;
/** Mean luminance of loaded stripe texture (0..1), used to center contrast. */
let stripePrintTextureMean = 0.5;
/** Bundled paper texture; loaded in preload. */
let defaultStripeTextureImage = null;
/**
 * Tight pixel rect of visible content (alpha above threshold), computed once per load.
 * Used so irregular / padded PNGs scale to fit the ink grid instead of tiny centered blobs.
 */
let userImageAlphaBounds = null;

function getInputMode() {
  const tab = document.querySelector(".input-tab.is-active");
  return tab && tab.dataset.inputTab === "image" ? "image" : "text";
}

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

function clampCanvasDim(v, maxDim) {
  const n = Number(v);
  const cap = maxDim != null ? maxDim : 4096;
  if (!Number.isFinite(n)) return min(880, cap);
  return constrain(Math.round(n), 200, cap);
}

function readCanvasSize() {
  const g = (id) => document.getElementById(id);
  return {
    w: clampCanvasDim(g("inpCanvasW").value, 4096),
    h: clampCanvasDim(g("inpCanvasH").value, 4096),
  };
}

function readExportScale() {
  const el = document.getElementById("inpExportScale");
  const s = Math.round(Number(el && el.value));
  return constrain(Number.isFinite(s) ? s : 2, 1, 3);
}

/** Export dimensions = preview × scale (each side clamped to 8192). */
function readExportSize() {
  const { w: pw, h: ph } = readCanvasSize();
  const s = readExportScale();
  return {
    w: constrain(Math.round(pw * s), 200, 8192),
    h: constrain(Math.round(ph * s), 200, 8192),
  };
}

function resizeCanvasFromInputs() {
  const { w, h } = readCanvasSize();
  if (w !== width || h !== height) resizeCanvas(w, h);
  redraw();
}

/** Apply stripe texture from a loaded p5.Image; updates mean luminance and optional UI label. */
function assignStripeTextureFromImage(img, uiLabel) {
  const nameEl = document.getElementById("stripeTextureFileName");
  if (!img || img.width <= 0) {
    stripePrintTexture = null;
    stripePrintTextureMean = 0.5;
    if (nameEl) nameEl.textContent = "No texture file loaded";
    return;
  }
  stripePrintTexture = img;
  stripePrintTexture.loadPixels();
  let sumL = 0;
  const np = stripePrintTexture.width * stripePrintTexture.height;
  for (let pi = 0; pi < np; pi++) {
    const bi = pi * 4;
    const tr = stripePrintTexture.pixels[bi];
    const tg = stripePrintTexture.pixels[bi + 1];
    const tb = stripePrintTexture.pixels[bi + 2];
    sumL += (0.299 * tr + 0.587 * tg + 0.114 * tb) / 255;
  }
  stripePrintTextureMean = np > 0 ? sumL / np : 0.5;
  if (nameEl && uiLabel != null) nameEl.textContent = uiLabel;
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

  // Data URL (stripe-default-texture-dataurl.js) works under file://; path fallback for http(s).
  const defaultTexSrc =
    typeof DEFAULT_STRIPE_TEXTURE_DATA_URL !== "undefined" && DEFAULT_STRIPE_TEXTURE_DATA_URL
      ? DEFAULT_STRIPE_TEXTURE_DATA_URL
      : "assets/default-stripe-texture.png";
  loadImage(
    defaultTexSrc,
    (img) => {
      defaultStripeTextureImage = img;
      const inp = document.getElementById("inpStripeTextureFile");
      const noUserFile = !inp || !inp.files || inp.files.length === 0;
      if (noUserFile) {
        assignStripeTextureFromImage(img, "Default paper texture");
        regenerate();
      }
    },
    () => {
      defaultStripeTextureImage = null;
      const nameEl = document.getElementById("stripeTextureFileName");
      const inp = document.getElementById("inpStripeTextureFile");
      const noUserFile = !inp || !inp.files || inp.files.length === 0;
      if (nameEl && noUserFile) nameEl.textContent = "No texture file loaded";
    },
  );
}

function draw() {
  const p = readParams();
  const isStripeText = p.renderMode === "stripe" && p.inputMode === "text";
  if (isStripeText && p.stripeAnimate) {
    stripeRowOffset += p.stripeAnimSpeed / 60;
  }
  if (p.renderMode === "offset") drawOffsetPrintScene(p, null, null);
  else if (isStripeText) drawStripedTextScene(p, null);
  else drawScene(p, null, null);
}

/** All parameters; `cw`/`ch` are the logical canvas size used for grid row count + layout. */
function readParamsForCanvas(cw, ch) {
  const g = (id) => document.getElementById(id);
  const num = (id) => Number(g(id).value);
  const val = (id) => g(id).value;
  const n = constrain(max(1, Math.round(num("inpGridN")) || 1), 1, 256);
  const pad = constrain(Math.round(num("inpPad")) || 0, 0, 500);
  const innerW = max(1, cw - 2 * pad);
  const innerH = max(1, ch - 2 * pad);
  const rows = max(1, Math.round(n * innerH / innerW));
  return {
    inputMode: getInputMode(),
    text: (val("inpText") || "a").replace(/\r\n?/g, "\n"),
    cols: n,
    rows,
    renderMode: val("inpRenderMode") || "stripe",
    tilePrimitive: val("inpTilePrimitive") || "rect",
    cellShape: val("inpCellShape") || "square",
    pad,
    gutter: num("inpGutter"),
    edge: num("inpEdge") / 100,
    grain: num("inpGrain") / 100,
    spread: num("inpSpread") / 100,
    contrast: constrain(num("inpContrast") / 100, 0, 1),
    thresh: num("inpThresh") / 100,
    dotGain: constrain(num("inpDotGain") / 100, 0.4, 2),
    dotJitter: constrain(num("inpDotJitter") / 100, 0, 0.4),
    dotSquareMix: constrain(num("inpDotSquareMix") / 100, 0, 1),
    mosaicBgHex: val("inpMosaicBg"),
    mosaicInkHex: val("inpMosaicInk"),
    stripeAccentHex: val("inpStripeAccent") || "#8a4300",
    stripeTextureOn: !!(g("inpStripeTextureOn") && g("inpStripeTextureOn").checked),
    stripeTextureStrength: constrain(num("inpStripeTextureStrength") / 100, 0, 2),
    stripeTextureScale: constrain(num("inpStripeTextureScale") / 100, 0.5, 2),
    stripeTextureLighten: !!(g("inpStripeTextureLighten") && g("inpStripeTextureLighten").checked),
    stripeAnimate: !!(g("inpStripeAnimate") && g("inpStripeAnimate").checked),
    stripeAnimSpeed: constrain(num("inpStripeAnimSpeed"), 1, 20),
    imageScale: constrain(num("inpImageScale") / 100, 0.5, 2),
    imageLighten: !!(g("inpImageLighten") && g("inpImageLighten").checked),
    seed: num("inpSeed") | 0,
    fontScale: num("inpFontScale") / 100,
    fontStack: fontStackFor(val("inpFontFamily")),
    samplingDetail: constrain(Math.round(num("inpSamplingDetail")), 2, 16),
  };
}

function readParams() {
  return readParamsForCanvas(width, height);
}

function applyTextColorPreset(key) {
  const pair = TEXT_COLOR_PRESETS[key];
  if (!pair) return;
  const inkEl = document.getElementById("inpMosaicInk");
  const stripeEl = document.getElementById("inpStripeAccent");
  _applyingTextColorPreset = true;
  try {
    if (inkEl) inkEl.value = pair.ink;
    if (stripeEl) stripeEl.value = pair.stripe;
  } finally {
    _applyingTextColorPreset = false;
  }
}

function syncTextColorPresetUi() {
  const presetEl = document.getElementById("inpTextColorPreset");
  const customInk = document.getElementById("customColorGroup");
  const customStripe = document.getElementById("customStripeAccentGroup");
  if (!presetEl) return;
  const isCustom = presetEl.value === "custom";
  if (customInk) customInk.hidden = !isCustom;
  if (customStripe) customStripe.hidden = !isCustom;
}

function syncRenderModeUi() {
  const el = document.getElementById("inpRenderMode");
  const v = (el && el.value) || "mosaic";
  const isOffset = v === "offset";
  const isStripe = v === "stripe";
  const isMosaic = v === "mosaic";

  document.querySelectorAll(".not-offset").forEach((node) => {
    node.style.display = isOffset ? "none" : "";
  });
  document.querySelectorAll(".only-offset").forEach((node) => {
    node.style.display = isOffset ? "" : "none";
  });
  document.querySelectorAll(".only-stripe").forEach((node) => {
    node.style.display = isStripe ? "" : "none";
  });
  document.querySelectorAll(".only-mosaic-render").forEach((node) => {
    node.style.display = isMosaic ? "" : "none";
  });
  document.querySelectorAll(".not-stripe").forEach((node) => {
    node.style.display = isStripe ? "none" : "";
  });
}

function syncLabels() {
  const p = readParams();
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = typeof v === "number" ? String(Math.round(v)) : v;
  };
  const ex = readExportSize();
  set("valExportDims", `${ex.w} × ${ex.h}`);
  syncRenderModeUi();
  set("valGridN", `${p.cols} × ${p.rows}`);
  set("valPad", p.pad);
  set("valGutter", p.gutter);
  set("valEdge", Math.round(p.edge * 100));
  set("valGrain", Math.round(p.grain * 100));
  set("valSpread", Math.round(p.spread * 100));
  set("valContrast", Math.round(p.contrast * 100));
  set("valThresh", Math.round(p.thresh * 100));
  set("valDotGain", Math.round(p.dotGain * 100));
  set("valDotJitter", Math.round(p.dotJitter * 100));
  set("valDotSquareMix", Math.round(p.dotSquareMix * 100));
  set("valFontScale", Math.round(p.fontScale * 100));
  set("valSamplingDetail", p.samplingDetail);
  set("valStripeTextureStrength", Math.round(p.stripeTextureStrength * 100));
  set("valStripeAnimSpeed", p.stripeAnimSpeed);
  set("valStripeTextureScale", Math.round(p.stripeTextureScale * 100));
  set("valImageScale", Math.round(p.imageScale * 100));
  syncTextColorPresetUi();
}

function bindControls() {
  const ids = [
    "inpText",
    "inpFontFamily",
    "inpFontScale",
    "inpMosaicBg",
    "inpMosaicInk",
    "inpStripeAccent",
    "inpStripeTextureOn",
    "inpStripeTextureScale",
    "inpStripeTextureLighten",
    "inpStripeTextureStrength",
    "inpImageScale",
    "inpImageLighten",
    "inpGridN",
    "inpExportScale",
    "inpRenderMode",
    "inpTilePrimitive",
    "inpCellShape",
    "inpPad",
    "inpSamplingDetail",
    "inpGutter",
    "inpEdge",
    "inpGrain",
    "inpSpread",
    "inpContrast",
    "inpThresh",
    "inpDotGain",
    "inpDotJitter",
    "inpDotSquareMix",
    "inpSeed",
  ];
  const onChange = () => {
    syncLabels();
    regenerate();
  };
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === "inpExportScale") {
      const onScale = () => syncLabels();
      el.addEventListener("input", onScale);
      el.addEventListener("change", onScale);
      return;
    }
    const handler =
      id === "inpMosaicInk" || id === "inpStripeAccent"
        ? () => {
            if (!_applyingTextColorPreset) {
              const ps = document.getElementById("inpTextColorPreset");
              if (ps && ps.value !== "custom") {
                ps.value = "custom";
                syncTextColorPresetUi();
              }
            }
            onChange();
          }
        : onChange;
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
  });

  const presetEl = document.getElementById("inpTextColorPreset");
  if (presetEl) {
    presetEl.addEventListener("change", () => {
      const v = presetEl.value;
      if (v !== "custom") applyTextColorPreset(v);
      syncTextColorPresetUi();
      syncLabels();
      regenerate();
    });
  }
  syncTextColorPresetUi();
  const commitCanvasSize = () => {
    const g = (id) => document.getElementById(id);
    g("inpCanvasW").value = String(clampCanvasDim(g("inpCanvasW").value, 4096));
    g("inpCanvasH").value = String(clampCanvasDim(g("inpCanvasH").value, 4096));
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
  document.getElementById("btnExport").addEventListener("click", () => exportPng());

  // Mobile toolbar duplicates
  const btnRM = document.getElementById("btnRedrawMobile");
  const btnEM = document.getElementById("btnExportMobile");
  if (btnRM) btnRM.addEventListener("click", () => regenerate());
  if (btnEM) btnEM.addEventListener("click", () => exportPng());

  // ── Accordion: click h2 to collapse / expand a control group ──
  document.querySelectorAll(".control-group h2").forEach((h2) => {
    h2.addEventListener("click", () => {
      h2.closest(".control-group").classList.toggle("is-collapsed");
    });
  });

  // ── Mobile panel: drag handle expands / collapses the sheet ──
  const panel = document.getElementById("panel");
  const handle = document.getElementById("panelHandle");
  if (handle && panel) {
    handle.addEventListener("click", () => {
      panel.classList.toggle("is-expanded");
    });
  }

  // ── On mobile, start with most groups collapsed to save space ──
  function applyMobileDefaults() {
    if (window.innerWidth >= 720) return;
    // Keep Render + Input open, collapse the rest
    const groups = document.querySelectorAll(".control-group");
    groups.forEach((g, i) => {
      if (i > 1) g.classList.add("is-collapsed");
    });
  }
  applyMobileDefaults();

  // ── Input: Text / Image tabs ──
  function applyInputTabVisibility(isImg) {
    const textP = document.getElementById("panelInputText");
    const imgP = document.getElementById("panelInputImage");
    const extras = document.getElementById("imageInputExtras");
    if (textP) textP.hidden = isImg;
    if (imgP) imgP.hidden = !isImg;
    if (extras) extras.hidden = !isImg;
  }

  document.querySelectorAll(".input-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".input-tab").forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      const isImg = tab.dataset.inputTab === "image";
      applyInputTabVisibility(isImg);
      syncLabels();
      regenerate();
    });
  });

  applyInputTabVisibility(getInputMode() === "image");

  const pickBtn = document.getElementById("btnPickImage");
  const fileInp = document.getElementById("inpImageFile");
  if (pickBtn && fileInp) pickBtn.addEventListener("click", () => fileInp.click());
  if (fileInp) {
    fileInp.addEventListener("change", () => {
      const f = fileInp.files && fileInp.files[0];
      const nameEl = document.getElementById("imageFileName");
      if (!f) {
        if (nameEl) nameEl.textContent = "No file loaded";
        userImage = null;
        userImageAlphaBounds = null;
        regenerate();
        return;
      }
      if (nameEl) nameEl.textContent = f.name;
      const url = URL.createObjectURL(f);
      loadImage(
        url,
        (img) => {
          URL.revokeObjectURL(url);
          userImage = img;
          userImageAlphaBounds =
            img && img.width > 0 ? computeImageContentBounds(img) : null;
          regenerate();
        },
        () => {
          URL.revokeObjectURL(url);
          userImage = null;
          userImageAlphaBounds = null;
          if (nameEl) nameEl.textContent = "Could not load image";
          regenerate();
        },
      );
    });
  }

  // ── Stripe animation toggle ──
  const animChk = document.getElementById("inpStripeAnimate");
  const animSpeedGroup = document.getElementById("stripeAnimSpeedGroup");
  const animSpeedRange = document.getElementById("inpStripeAnimSpeed");
  if (animChk) {
    animChk.addEventListener("change", () => {
      const on = animChk.checked;
      if (animSpeedGroup) animSpeedGroup.hidden = !on;
      if (on) {
        stripeAnimOffset = 0;
        stripeRowOffset = 0;
        loop();
      } else {
        noLoop();
        redraw();
      }
    });
  }
  if (animSpeedRange) {
    animSpeedRange.addEventListener("input", syncLabels);
  }

  const pickTexBtn = document.getElementById("btnPickStripeTexture");
  const texFileInp = document.getElementById("inpStripeTextureFile");
  if (pickTexBtn && texFileInp) pickTexBtn.addEventListener("click", () => texFileInp.click());
  if (texFileInp) {
    texFileInp.addEventListener("change", () => {
      const f = texFileInp.files && texFileInp.files[0];
      if (!f) {
        if (defaultStripeTextureImage && defaultStripeTextureImage.width > 0) {
          assignStripeTextureFromImage(defaultStripeTextureImage, "Default paper texture");
        } else {
          assignStripeTextureFromImage(null, null);
        }
        redraw();
        return;
      }
      const url = URL.createObjectURL(f);
      loadImage(
        url,
        (img) => {
          URL.revokeObjectURL(url);
          assignStripeTextureFromImage(img, f.name);
          redraw();
        },
        () => {
          URL.revokeObjectURL(url);
          assignStripeTextureFromImage(null, null);
          const nameEl = document.getElementById("stripeTextureFileName");
          if (nameEl) nameEl.textContent = "Could not load texture file";
          redraw();
        },
      );
    });
  }
}

function emptyInkGrid(cols, rows) {
  const g = [];
  for (let j = 0; j < rows; j++) {
    g[j] = [];
    for (let i = 0; i < cols; i++) g[j][i] = 0;
  }
  return g;
}

function buildInkGrid(p) {
  randomSeed(p.seed);
  noiseSeed(p.seed % 100000);
  if (p.inputMode === "image") {
    if (userImage && userImage.width > 0) {
      return sampleInkGridFromImage(
        userImage,
        p.cols,
        p.rows,
        p.thresh,
        p.samplingDetail,
        p.imageScale,
        p.imageLighten,
      );
    }
    return emptyInkGrid(p.cols, p.rows);
  }
  return sampleInkGrid(
    p.text,
    p.cols,
    p.rows,
    p.thresh,
    p.fontScale,
    p.samplingDetail,
    p.fontStack,
  );
}

function regenerate() {
  const p = readParams();
  inkGrid = buildInkGrid(p);
  redraw();
}

/** Row count for a given canvas size (must match readParamsForCanvas). */
function gridRowsForCanvas(cols, pad, cw, ch) {
  const innerW = max(1, cw - 2 * pad);
  const innerH = max(1, ch - 2 * pad);
  return max(1, Math.round(cols * innerH / innerW));
}

/**
 * Save at export resolution. Renders offscreen so preview canvas stays at preview size.
 * Same aspect ratio as preview → same row count → same ink grid. Otherwise re-samples for export.
 */
function exportPng() {
  const { w: pw, h: ph } = readCanvasSize();
  const { w: ew, h: eh } = readExportSize();
  if (ew === pw && eh === ph) {
    saveCanvas("generative-font-" + Date.now(), "png");
    return;
  }
  const pBase = readParams();
  const rowsPreview = gridRowsForCanvas(pBase.cols, pBase.pad, pw, ph);
  const rowsExport = gridRowsForCanvas(pBase.cols, pBase.pad, ew, eh);
  const needNewGrid = rowsPreview !== rowsExport;

  let grid = inkGrid;
  const pDraw = readParamsForCanvas(ew, eh);
  if (needNewGrid) {
    grid = buildInkGrid({ ...pBase, cols: pDraw.cols, rows: pDraw.rows });
  }

  const g = createGraphics(ew, eh);
  g.pixelDensity(1);
  if (pDraw.renderMode === "offset") drawOffsetPrintScene(pDraw, g, grid);
  else if (pDraw.renderMode === "stripe" && pDraw.inputMode === "text") {
    drawStripedTextScene(pDraw, g);
  }
  else drawScene(pDraw, g, grid);
  g.save("generative-font-" + Date.now() + ".png");
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

/** Average luma per cell → ink 0..1 (dark = high ink). Handles alpha by compositing on white. */
function collapseRasterToInkGrid(pg, cols, rows, threshSoft) {
  pg.loadPixels();
  const pw = pg.width;
  const ph = pg.height;
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
          const r = pg.pixels[idx];
          const gc = pg.pixels[idx + 1];
          const b = pg.pixels[idx + 2];
          const a = pg.pixels[idx + 3] / 255;
          const L = 0.299 * r + 0.587 * gc + 0.114 * b;
          sum += L * a + 255 * (1 - a);
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

function rasterBufferSize(cols, rows, samplingDetail) {
  let pxPerCell = constrain(Math.round(Number(samplingDetail)) || 4, 2, 16);
  const MIN_RASTER = 48;
  let pw = cols * pxPerCell;
  let ph = rows * pxPerCell;
  while ((pw < MIN_RASTER || ph < MIN_RASTER) && pxPerCell < 96) {
    pxPerCell += 1;
    pw = cols * pxPerCell;
    ph = rows * pxPerCell;
  }
  return { pw, ph, pxPerCell };
}

/**
 * Axis-aligned bounds of pixels with alpha above threshold (irregular silhouettes, logo padding).
 * Falls back to full bitmap if nothing passes (e.g. fully transparent → treat as full frame).
 */
function computeImageContentBounds(img, alphaThreshold = 10) {
  if (!img || img.width <= 0) {
    return { sx: 0, sy: 0, sw: 1, sh: 1 };
  }
  img.loadPixels();
  const w = img.width;
  const h = img.height;
  const pix = img.pixels;
  const step = w * h > 4_000_000 ? 2 : 1;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += step) {
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x += step) {
      const a = pix[rowBase + x * 4 + 3];
      if (a > alphaThreshold) {
        const x2 = min(x + step - 1, w - 1);
        const y2 = min(y + step - 1, h - 1);
        if (x < minX) minX = x;
        if (x2 > maxX) maxX = x2;
        if (y < minY) minY = y;
        if (y2 > maxY) maxY = y2;
      }
    }
  }
  if (maxX < 0) {
    return { sx: 0, sy: 0, sw: w, sh: h };
  }
  return {
    sx: minX,
    sy: minY,
    sw: max(1, maxX - minX + 1),
    sh: max(1, maxY - minY + 1),
  };
}

/** Uniform scale + center so source rect fits inside dw×dh (object-contain, letterbox on bg). */
function drawImageContainSource(pg, img, dx, dy, dw, dh, sx, sy, sw, sh) {
  if (!img || sw <= 0 || sh <= 0) return;
  const ir = sw / sh;
  const tr = dw / dh;
  let tw;
  let th;
  if (ir > tr) {
    tw = dw;
    th = dw / ir;
  } else {
    th = dh;
    tw = dh * ir;
  }
  const ox = dx + (dw - tw) / 2;
  const oy = dy + (dh - th) / 2;
  pg.image(img, ox, oy, tw, th, sx, sy, sw, sh);
}

function scaledSourceRect(sx, sy, sw, sh, scale, maxW, maxH) {
  const s = constrain(Number(scale) || 1, 0.5, 2);
  const tw = sw / s;
  const th = sh / s;
  const cx = sx + sw * 0.5;
  const cy = sy + sh * 0.5;
  const nsw = constrain(tw, 1, maxW);
  const nsh = constrain(th, 1, maxH);
  const nsx = constrain(cx - nsw * 0.5, 0, maxW - nsw);
  const nsy = constrain(cy - nsh * 0.5, 0, maxH - nsh);
  return { sx: nsx, sy: nsy, sw: nsw, sh: nsh };
}

/** Scale + center-crop image to fill dw×dh (object-cover). */
function drawImageCover(pg, img, dx, dy, dw, dh) {
  if (!img || img.width <= 0) return;
  const ir = img.width / img.height;
  const br = dw / dh;
  let sx;
  let sy;
  let sw;
  let sh;
  if (ir > br) {
    sh = img.height;
    sw = sh * br;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / br;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  pg.image(img, dx, dy, dw, dh, sx, sy, sw, sh);
}

/**
 * Sample a photo into [rows][cols] ink — same pipeline as text after rasterization.
 * Padded / irregular alpha masks: fit tight content with contain. Full-bleed photos: cover.
 */
function sampleInkGridFromImage(img, cols, rows, threshSoft, samplingDetail, imageScale, imageLighten) {
  const { pw, ph } = rasterBufferSize(cols, rows, samplingDetail);
  const pg = createGraphics(pw, ph);
  pg.pixelDensity(1);
  pg.background(255);
  const w = img.width;
  const h = img.height;
  const b =
    userImageAlphaBounds &&
    userImageAlphaBounds.sw > 0 &&
    userImageAlphaBounds.sh > 0
      ? userImageAlphaBounds
      : computeImageContentBounds(img);
  const contentFrac = (b.sw * b.sh) / max(1, w * h);
  const FRAC_FULL_BLEED = 0.88;
  if (contentFrac >= FRAC_FULL_BLEED) {
    const r = scaledSourceRect(0, 0, img.width, img.height, imageScale, img.width, img.height);
    pg.image(img, 0, 0, pw, ph, r.sx, r.sy, r.sw, r.sh);
  } else {
    const r = scaledSourceRect(b.sx, b.sy, b.sw, b.sh, imageScale, img.width, img.height);
    drawImageContainSource(pg, img, 0, 0, pw, ph, r.sx, r.sy, r.sw, r.sh);
  }
  if (imageLighten) {
    pg.noStroke();
    pg.fill(255, 255, 255, 64);
    pg.rect(0, 0, pw, ph);
  }
  return collapseRasterToInkGrid(pg, cols, rows, threshSoft);
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
  const { pw, ph } = rasterBufferSize(cols, rows, samplingDetail);
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
  const pxPerCell = pw / cols;
  const span = pxPerCell * max(cols, rows);
  const sizeGuess = span * (charCount > 4 ? 0.38 : 0.62) * fs;
  fitTextToBuffer(pg, lines, pw, ph, sizeGuess, familyListCSS);
  drawRasterText(pg, display, pw, ph, familyListCSS);
  return collapseRasterToInkGrid(pg, cols, rows, threshSoft);
}

const STRIPE_GLYPH_W = 7;
const STRIPE_GLYPH_H = 13;
const STRIPE_ADV_X = 8;
const STRIPE_ADV_Y = 15;
const STRIPE_FONT = {
  "A": [".#####.","###.###","###.###","###.###","###.###","###.###","#######","###.###","###.###","###.###","###.###",".......","......."],
  "B": ["######.","###.###","###.###","###.###","######.","######.","###.###","###.###","###.###","###.###","######.",".......","......."],
  "C": [".######","###.###","###....","###....","###....","###....","###....","###....","###....","###.###",".######",".......","......."],
  "D": ["#####..","###.##.","###.###","###.###","###.###","###.###","###.###","###.###","###.###","###.##.","#####..",".......","......."],
  "E": ["#######","###....","###....","###....","######.","###....","###....","###....","###....","###....","#######",".......","......."],
  "F": ["#######","###....","###....","###....","######.","###....","###....","###....","###....","###....","###....",".......","......."],
  "G": [".#####.","###.###","###....","###....","###....","###.###","###.###","###.###","###.###","###.###",".#####.",".......","......."],
  "H": ["###.###","###.###","###.###","###.###","###.###","#######","###.###","###.###","###.###","###.###","###.###",".......","......."],
  "I": ["#######","..###..","..###..","..###..","..###..","..###..","..###..","..###..","..###..","..###..","#######",".......","......."],
  "J": ["..#####","....###","....###","....###","....###","....###","....###","....###","###.###","###.###",".#####.",".......","......."],
  "K": ["###.###","###.###","###.##.","######.","#####..","#####..","######.","###.##.","###.###","###.###","###.###",".......","......."],
  "L": ["###....","###....","###....","###....","###....","###....","###....","###....","###....","###....","#######",".......","......."],
  "M": ["###.###","#######","#######","#######","###.###","###.###","###.###","###.###","###.###","###.###","###.###",".......","......."],
  "N": ["###.###","####.##","#######","#######","##.####","###.###","###.###","###.###","###.###","###.###","###.###",".......","......."],
  "O": [".#####.","###.###","###.###","###.###","###.###","###.###","###.###","###.###","###.###","###.###",".#####.",".......","......."],
  "P": ["######.","###.###","###.###","###.###","###.###","######.","###....","###....","###....","###....","###....",".......","......."],
  "Q": [".#####.","###.###","###.###","###.###","###.###","###.###","###.###","###.###","###.###",".######","..#####",".......","......."],
  "R": ["######.","###.###","###.###","###.###","###.###","######.","######.","###.##.","###.###","###.###","###.###",".......","......."],
  "S": [".######","###.###","###....","###....",".#####.","....###","....###","....###","....###","###.###","######.",".......","......."],
  "T": ["#######","..###..","..###..","..###..","..###..","..###..","..###..","..###..","..###..","..###..","..###..",".......","......."],
  "U": ["###.###","###.###","###.###","###.###","###.###","###.###","###.###","###.###","###.###","###.###",".#####.",".......","......."],
  "V": ["###.###","###.###","###.###","###.###","###.###","###.###","###.###","###.###",".#####.","..###..","...#...",".......","......."],
  "W": ["###.###","###.###","###.###","###.###","###.###","###.###","###.###","#######","#######","#######","###.###",".......","......."],
  "X": ["###.###","###.###",".##.##.","..###..","..###..","..###..","..###..",".##.##.","###.###","###.###","###.###",".......","......."],
  "Y": ["###.###","###.###","###.###",".#####.","..###..","..###..","..###..","..###..","..###..","..###..","..###..",".......","......."],
  "Z": ["#######","....###","....###","...###.","..###..","..###..",".###...","###....","###....","###....","#######",".......","......."],
  "0": [".#####.","###.###","###.###","##..###","##.#.##","###..##","###.###","###.###","###.###","###.###",".#####.",".......","......."],
  "1": ["..###..","..###..",".####..","..###..","..###..","..###..","..###..","..###..","..###..","..###..","..###..",".......","......."],
  "2": [".#####.","###.###","....###","....###","...###.","..###..",".###...","###....","###....","###....","#######",".......","......."],
  "3": ["######.","....###","....###","....###",".#####.","....###","....###","....###","....###","....###","######.",".......","......."],
  "4": ["....###","...####","..#.###",".#..###","#...###","#######","....###","....###","....###","....###","....###",".......","......."],
  "5": ["#######","###....","###....","###....","######.","....###","....###","....###","....###","....###","######.",".......","......."],
  "6": [".#####.","###....","###....","###....","######.","###.###","###.###","###.###","###.###","###.###",".#####.",".......","......."],
  "7": ["#######","....###","....###","...###.","...###.","..###..","..###..",".###...",".###...",".###...",".###...",".......","......."],
  "8": [".#####.","###.###","###.###","###.###",".#####.","###.###","###.###","###.###","###.###","###.###",".#####.",".......","......."],
  "9": [".#####.","###.###","###.###","###.###","###.###",".######","....###","....###","....###","....###",".#####.",".......","......."],
  "?": [".#####.","###.###","....###","...###.","..###..","..###..","..###..",".......",".......","..###..","..###..",".......","......."],
  "!": ["..###..","..###..","..###..","..###..","..###..","..###..","..###..","..###..",".......",".......","..###..",".......","......."],
  "-": [".......",".......",".......",".......",".......","#####..",".......",".......",".......",".......",".......",".......",".......",],
  ".": [".......",".......",".......",".......",".......",".......",".......",".......",".......",".......","..###..",".......","......."],
  ",": [".......",".......",".......",".......",".......",".......",".......",".......",".......",".......","..###..","..##...",".......",],
  " ": [".......",".......",".......",".......",".......",".......",".......",".......",".......",".......",".......",".......",".......",],
};

function stripeGlyphFor(ch) {
  if (!ch || ch === " ") return STRIPE_FONT[" "];
  const up = ch.toUpperCase();
  return STRIPE_FONT[up] || STRIPE_FONT["?"];
}

function drawStripePixel(ctx, x, y, w, h, fillCol) {
  if (ctx) {
    ctx.fill(fillCol);
    ctx.rect(x, y, w, h);
  } else {
    fill(fillCol);
    rect(x, y, w, h);
  }
}

/**
 * Render mode: handcrafted striped block alphabet (A-Z/0-9), edge-striped like reference.
 * Only used when Input=Text and Render mode=Striped block.
 *
 * Masks (orangeMask, blackMask) are cached by text+fontScale+canvas size so animation
 * frames only re-run the fast per-pixel color loop, not the expensive createGraphics calls.
 */
function drawStripedTextScene(p, ctx) {
  const W = ctx ? ctx.width : width;
  const H = ctx ? ctx.height : height;
  const bgHex = p.mosaicBgHex;
  const dark = color(p.mosaicInkHex);
  const paper = color(p.mosaicBgHex);
  const accent = color(p.stripeAccentHex || "#e38953");

  if (ctx) {
    ctx.background(bgHex);
    ctx.noStroke();
  } else {
    background(bgHex);
    noStroke();
  }

  const input = (p.text || "").trim().length ? p.text : "HARD";
  const lines = input.split(/\n/).map((l) => l.replace(/\r/g, ""));
  const lineWUnits = lines.map((line) => {
    const count = max(1, line.length);
    return count * STRIPE_ADV_X - (STRIPE_ADV_X - STRIPE_GLYPH_W);
  });
  const textUnitsW = max(1, ...lineWUnits);
  const textUnitsH = max(1, lines.length * STRIPE_ADV_Y - (STRIPE_ADV_Y - STRIPE_GLYPH_H));

  const fs = constrain(Number(p.fontScale) || 1, 0.35, 2.4);
  const fitX = (W * 0.8) / textUnitsW;
  const fitY = (H * 0.58) / textUnitsH;
  const block = constrain(floor(min(fitX, fitY) * fs), 2, 40);

  const drawW = textUnitsW * block;
  const drawH = textUnitsH * block;
  const ox = floor((W - drawW) * 0.5);
  let oy = floor((H - drawH) * 0.5);

  // ── Mask cache: rebuild only when text/layout/canvas changes (not on color or anim frames) ──
  // Skip caching for exports (ctx != null) to avoid dimension mismatches.
  const maskCacheKey = ctx ? null : `${p.text}|${p.fontScale}|${W}|${H}`;
  let cache = null;
  if (!ctx && _stripeCache && _stripeCache.key === maskCacheKey) {
    cache = _stripeCache;
  } else {
    // Build occupancy grid
    const occ = new Uint8Array(textUnitsW * textUnitsH);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const lineW = lineWUnits[li];
      const xBase = floor((textUnitsW - lineW) * 0.5);
      const yBase = li * STRIPE_ADV_Y;
      for (let ci = 0; ci < max(1, line.length); ci++) {
        const ch = line.length ? line[ci] : " ";
        const g = stripeGlyphFor(ch);
        const gx = xBase + ci * STRIPE_ADV_X;
        for (let gy = 0; gy < STRIPE_GLYPH_H; gy++) {
          const row = g[gy] || ".....";
          const yy = yBase + gy;
          if (yy < 0 || yy >= textUnitsH) continue;
          for (let xx = 0; xx < STRIPE_GLYPH_W; xx++) {
            if (row[xx] !== "#") continue;
            const x = gx + xx;
            if (x < 0 || x >= textUnitsW) continue;
            occ[yy * textUnitsW + x] = 1;
          }
        }
      }
    }

    // Center using tight vertical ink bounds (ignore empty font-box rows above/below glyphs).
    let minOccY = textUnitsH;
    let maxOccY = -1;
    for (let y = 0; y < textUnitsH; y++) {
      for (let x = 0; x < textUnitsW; x++) {
        if (!occ[y * textUnitsW + x]) continue;
        if (y < minOccY) minOccY = y;
        if (y > maxOccY) maxOccY = y;
      }
    }
    if (maxOccY >= minOccY) {
      const inkTopPx = minOccY * block;
      const inkHpx = (maxOccY - minOccY + 1) * block;
      oy = floor((H - inkHpx) * 0.5) - inkTopPx;
    }

    const cellW = block;
    const darkCoreW = constrain(floor(cellW * 0.52), 1, max(1, cellW - 1));

    // Release old cached graphics before allocating new ones
    if (_stripeCache) {
      _stripeCache.orangeMask.remove();
      _stripeCache.blackMask.remove();
      _stripeCache.art.remove();
    }

    const orangeMask = createGraphics(drawW, drawH);
    const blackMask = createGraphics(drawW, drawH);
    const artBuf = createGraphics(drawW, drawH);
    orangeMask.pixelDensity(1);
    blackMask.pixelDensity(1);
    artBuf.pixelDensity(1);
    orangeMask.clear();
    blackMask.clear();
    artBuf.clear();
    orangeMask.noStroke();
    blackMask.noStroke();
    orangeMask.fill(255);
    blackMask.fill(255);

    for (let y = 0; y < textUnitsH; y++) {
      let x = 0;
      while (x < textUnitsW) {
        if (!occ[y * textUnitsW + x]) { x++; continue; }
        let runStart = x;
        while (x < textUnitsW && occ[y * textUnitsW + x]) x++;
        const runEnd = x - 1;
        for (let rx = runStart; rx <= runEnd; rx++) {
          const isLeftEdge = rx === runStart;
          const isRightEdge = rx === runEnd;
          const lx = rx * block;
          const ly = y * block;
          orangeMask.rect(lx, ly, cellW, block);
          if (isLeftEdge) blackMask.rect(lx, ly, darkCoreW, block);
          if (isRightEdge) blackMask.rect(lx + cellW - darkCoreW, ly, darkCoreW, block);
        }
      }
    }

    orangeMask.loadPixels();
    blackMask.loadPixels();

    // Union mask: which pixels belong to any part of the letter shapes.
    // Used so animation keeps the letter outline fixed while scrolling stripe identity.
    const letterPixels = new Uint8Array(drawW * drawH);
    for (let i = 0; i < drawW * drawH; i++) {
      if (orangeMask.pixels[i * 4 + 3] > 0 || blackMask.pixels[i * 4 + 3] > 0) letterPixels[i] = 1;
    }

    cache = { key: maskCacheKey, orangeMask, blackMask, letterPixels, art: artBuf, drawW, drawH, ox, oy };
    if (!ctx) _stripeCache = cache;
  }

  const { orangeMask, blackMask, letterPixels, art: artBuf } = cache;
  const dW = cache.drawW;
  const dH = cache.drawH;
  const dox = cache.ox;
  const doy = cache.oy;

  // ── Per-frame color render ──
  const seed = p.seed | 0;
  const texImg = stripePrintTexture;
  const texW = texImg && texImg.width > 0 ? texImg.width : 0;
  const texH = texImg && texImg.height > 0 ? texImg.height : 0;
  const texStrength = p.stripeTextureOn ? p.stripeTextureStrength : 0;
  const texCrop =
    texW > 0 && texH > 0 ? scaledSourceRect(0, 0, texW, texH, p.stripeTextureScale, texW, texH) : null;
  let texCropX0 = 0;
  let texCropY0 = 0;
  let texCropRw = 1;
  let texCropRh = 1;
  if (texCrop) {
    texCropX0 = constrain(floor(texCrop.sx), 0, max(0, texW - 1));
    texCropY0 = constrain(floor(texCrop.sy), 0, max(0, texH - 1));
    texCropRw = max(1, min(floor(texCrop.sw), texW - texCropX0));
    texCropRh = max(1, min(floor(texCrop.sh), texH - texCropY0));
  }

  const pw = paper.levels[0];
  const pg = paper.levels[1];
  const pb = paper.levels[2];
  const ar = accent.levels[0];
  const ag = accent.levels[1];
  const ab = accent.levels[2];
  const dr = dark.levels[0];
  const dg = dark.levels[1];
  const db = dark.levels[2];

  // Row-by-row slide animation.
  // Each block-row slides in from the right, staggered top→bottom.
  // Phases: Reveal → Hold → Hide (bottom→top) → Gap → repeat.
  const nRows = textUnitsH;
  const slideX = new Float32Array(nRows); // horizontal offset per block-row (0 = fully in)
  if (p.stripeAnimate) {
    const revealDur = 1.5;   // row-units for each row's slide-in
    const holdDur   = 3.0;   // row-units all rows stay fully visible
    const holdStart = (nRows - 1) + revealDur; // when last row finishes sliding
    const holdEnd   = holdStart + holdDur;
    const totalCycle = holdEnd + nRows + 1.0;  // hide (1 unit/row) + gap (1 unit)
    const phase = stripeRowOffset % totalCycle;
    for (let rr = 0; rr < nRows; rr++) {
      const revealStart = rr;
      const revealEnd   = rr + revealDur;
      const hideAt      = holdEnd + (nRows - 1 - rr); // bottom rows hide first
      if (phase < revealStart || phase >= hideAt) {
        slideX[rr] = dW;  // off-screen right (hidden)
      } else if (phase < revealEnd) {
        const progress = (phase - revealStart) / revealDur;
        slideX[rr] = Math.round(dW * (1 - progress));
      } else {
        slideX[rr] = 0;   // fully visible
      }
    }
  }
  // When not animating, slideX stays all-zeros → full letter always visible.

  artBuf.clear();
  artBuf.loadPixels();

  for (let y = 0; y < dH; y++) {
    const blockRow = Math.floor(y / block);
    const rowSX = slideX[blockRow];
    if (rowSX >= dW) continue;  // entire block-row off-screen, skip

    for (let x = rowSX; x < dW; x++) {
      const sx = x - rowSX;  // source x: letter content at sx maps to canvas column x
      if (!letterPixels[y * dW + sx]) continue;

      const srcIdx = 4 * (y * dW + sx);
      const baRaw = blackMask.pixels[srcIdx + 3];
      const oaRaw = orangeMask.pixels[srcIdx + 3];
      const ba = baRaw;
      const oa = (oaRaw < 1 && baRaw < 1) ? 1 : oaRaw;

      const dstIdx = 4 * (y * dW + x);
      const wx = dox + sx;  // noise/texture coords follow source content
      const wy = doy + y;
      const micro = noise(wx * 0.42 + 11.8, wy * 0.42 + 29.6, seed * 0.071);
      const speck = noise(wx * 0.14 + 61.2, wy * 0.14 + 14.9, seed * 0.021);
      let texL = 0.5;
      if (texStrength > 0 && texW > 0 && texH > 0 && texImg.pixels && texImg.pixels.length > 0 && texCrop) {
        const tx = texCropX0 + ((floor(wx) % texCropRw) + texCropRw) % texCropRw;
        const ty = texCropY0 + ((floor(wy) % texCropRh) + texCropRh) % texCropRh;
        const tidx = 4 * (ty * texW + tx);
        texL = (0.299 * texImg.pixels[tidx] + 0.587 * texImg.pixels[tidx + 1] + 0.114 * texImg.pixels[tidx + 2]) / 255;
        if (p.stripeTextureLighten) texL = min(1, texL * 0.72 + 0.28);
      }
      const texSigned = (texL - stripePrintTextureMean) * 3.2 * texStrength;

      let cr;
      let cg;
      let cb;

      if (ba > 0) {
        const inkLift = max(0, speck - 0.86) * 0.28 * texStrength;
        cr = dr + texSigned * 30;
        cg = dg + texSigned * 30;
        cb = db + texSigned * 30;
        const whiteDrop =
          max(0, micro - 0.82) * 0.9 * texStrength +
          max(0, speck - 0.94) * 0.55 * texStrength;
        cr = lerp(cr, pw, whiteDrop);
        cg = lerp(cg, pg, whiteDrop);
        cb = lerp(cb, pb, whiteDrop);
        cr = lerp(cr, pw, inkLift);
        cg = lerp(cg, pg, inkLift);
        cb = lerp(cb, pb, inkLift);
      } else {
        const paperShow = max(0, speck - 0.88) * 0.22 * texStrength;
        cr = ar + texSigned * 36;
        cg = ag + texSigned * 36;
        cb = ab + texSigned * 36;
        const whiteSpeck =
          max(0, micro - 0.79) * 0.52 * texStrength +
          max(0, speck - 0.92) * 0.32 * texStrength;
        const darkSpeck = max(0, 0.13 - micro) * 0.2 * texStrength;
        cr = lerp(cr, pw, whiteSpeck);
        cg = lerp(cg, pg, whiteSpeck);
        cb = lerp(cb, pb, whiteSpeck);
        cr = lerp(cr, dr, darkSpeck);
        cg = lerp(cg, dg, darkSpeck);
        cb = lerp(cb, db, darkSpeck);
        cr = lerp(cr, pw, paperShow);
        cg = lerp(cg, pg, paperShow);
        cb = lerp(cb, pb, paperShow);
      }

      artBuf.pixels[dstIdx]     = constrain(cr, 0, 255);
      artBuf.pixels[dstIdx + 1] = constrain(cg, 0, 255);
      artBuf.pixels[dstIdx + 2] = constrain(cb, 0, 255);
      artBuf.pixels[dstIdx + 3] = 255;
    }
  }
  artBuf.updatePixels();
  if (ctx) ctx.image(artBuf, dox, doy);
  else image(artBuf, dox, doy);
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
 * Square cells filling the full padded frame.
 * slot = innerW / cols — cells are square because rows = round(cols × innerH/innerW).
 * Any rounding remainder is absorbed by the oy centering offset.
 */
function cellLayout(p, cw, ch) {
  const W = cw != null ? cw : width;
  const H = ch != null ? ch : height;
  const pad = max(0, p.pad);
  const innerW = max(1, W - 2 * pad);
  const innerH = max(1, H - 2 * pad);
  const slot = p.cols > 0 ? innerW / p.cols : 1;
  const gridW = p.cols * slot;
  const gridH = p.rows * slot;
  const ox = pad + (innerW - gridW) / 2;
  const oy = pad + (innerH - gridH) / 2;
  return { slotW: slot, slotH: slot, ox, oy };
}

/**
 * Largest axis-aligned rect of the chosen aspect inside the drawable slot
 * (slotW−g)×(slotH−g), centered. Returns fillFrac = drawn area / inner slot area for tone match.
 */
function tileRectInSlot(sx, sy, slotW, slotH, gutter, shape) {
  const g = max(0, gutter);
  const iw = max(0.5, slotW - g);
  const ih = max(0.5, slotH - g);
  const ix = sx + g / 2;
  const iy = sy + g / 2;
  let tw, th;
  if (shape === "wide") {
    const scale = min(iw / 2, ih);
    tw = 2 * scale;
    th = scale;
  } else if (shape === "tall") {
    const scale = min(iw, ih / 2);
    tw = scale;
    th = 2 * scale;
  } else {
    tw = iw;
    th = ih;
  }
  const px = ix + (iw - tw) / 2;
  const py = iy + (ih - th) / 2;
  const fillFrac = (tw * th) / (iw * ih);
  return { px, py, tw, th, fillFrac };
}

/**
 * Tall/wide tiles only cover half the slot; the rest shows paper, so the cell reads lighter.
 * Boost ink level so slot-average luminance matches a full square at the same sample level:
 *   (1-f)*paper + f*lerp(paper,ink,L') ≈ lerp(paper,ink,L)  →  L' = L/f (clamped).
 */
function levelMatchedToSquareFill(level, fillFrac) {
  if (fillFrac >= 0.999) return level;
  return constrain(level / fillFrac, 0, 1);
}

/** Push tones away from mid-gray; contrast01 0 = off, 1 = strong. */
function applyToneContrast(t, contrast01) {
  if (contrast01 < 0.001) return t;
  const k = 1 + contrast01 * 2.35;
  return constrain((t - 0.5) * k + 0.5, 0, 1);
}

const TEXTURE_GLYPHS = "0123456789ABCDEFXYZ@#$%&*+=?|/\\08BO";

function canvas2dFromP5(ctx) {
  if (ctx) return ctx.drawingContext;
  return typeof drawingContext !== "undefined" ? drawingContext : null;
}

/**
 * Low-contrast data-like glyph field, soft radial vignette, and fine grain.
 * Drawn on top of solid paper; same for mosaic, offset, preview, and export.
 */
function drawPaperTextureOverlay(paperHex, inkHex, W, H, seed, ctx) {
  const paper = color(paperHex);
  const inkC = color(inkHex);
  const dctx = canvas2dFromP5(ctx);
  if (!dctx || W < 2 || H < 2) return;

  const pr = red(paper);
  const pg = green(paper);
  const pb = blue(paper);

  dctx.save();

  const cx = W * 0.5;
  const cy = H * 0.5;
  const rad = max(W, H) * 0.82;
  const rg = dctx.createRadialGradient(cx, cy, rad * 0.06, cx, cy, rad);
  const lr = lerp(pr, 255, 0.055);
  const lg = lerp(pg, 255, 0.055);
  const lb = lerp(pb, 255, 0.055);
  const dr = lerp(pr, 0, 0.15);
  const dg = lerp(pg, 0, 0.15);
  const db = lerp(pb, 0, 0.15);
  rg.addColorStop(0, `rgba(${lr},${lg},${lb},0.38)`);
  rg.addColorStop(0.5, `rgba(${pr},${pg},${pb},0)`);
  rg.addColorStop(1, `rgba(${dr},${dg},${db},0.44)`);
  dctx.fillStyle = rg;
  dctx.fillRect(0, 0, W, H);


  const targetGlyphs = 8200;
  let step = floor(sqrt((W * H) / targetGlyphs));
  step = constrain(step, 7, 24);
  const tr = lerp(pr, red(inkC), 0.1);
  const tg = lerp(pg, green(inkC), 0.1);
  const tb = lerp(pb, blue(inkC), 0.1);
  dctx.fillStyle = `rgba(${tr},${tg},${tb},0.24)`;
  dctx.textAlign = "center";
  dctx.textBaseline = "middle";
  const fontPx = constrain(round(step * 0.72), 6, 11);
  dctx.font = `${fontPx}px ui-monospace, "Courier New", monospace`;

  const nG = TEXTURE_GLYPHS.length;
  const s = seed | 0;
  for (let y = step * 0.5; y < H; y += step) {
    const gj = (y / step) | 0;
    for (let x = step * 0.5; x < W; x += step) {
      const gi = (x / step) | 0;
      const h = (gi * 73856093 ^ gj * 668265263 ^ s * 1442695041) >>> 0;
      const ch = TEXTURE_GLYPHS[h % nG];
      const jx = (sin(gi * 1.17 + s * 0.017) + sin(gj * 0.93)) * 0.7;
      const jy = (cos(gj * 1.09) + cos(gi * 0.88 + s * 0.023)) * 0.7;
      dctx.fillText(ch, x + jx, y + jy);
    }
  }

  randomSeed(s + 917733);
  const nSpeck = constrain(floor((W * H) / 1600), 100, 16000);
  for (let k = 0; k < nSpeck; k++) {
    const px = floor(random() * W);
    const py = floor(random() * H);
    if (random() > 0.5) {
      dctx.fillStyle = "rgba(0,0,0,0.04)";
    } else {
      dctx.fillStyle = "rgba(255,255,255,0.03)";
    }
    dctx.fillRect(px, py, 1, 1);
  }

  dctx.restore();
}

/**
 * Draw scratch marks inside one tile — horizontal-ish lines that mimic
 * relief print / woodblock texture, keyed on tile ink level.
 */
/** `ctx` null = main canvas; else p5.Graphics */
function drawScratchCell(ctx, px, py, tw, th, ink, grainAmt, paper, inkCol, scratchCountMult) {
  if (grainAmt < 0.02) return;
  const span = max(tw, th);
  const mult = scratchCountMult >= 0.5 ? scratchCountMult : 1;
  const count = floor((3 + grainAmt * 22) * mult);
  for (let k = 0; k < count; k++) {
    const ry = py + random() * th;
    // start slightly outside tile edge so scratches can bleed to edge
    const rx = px - tw * 0.05 + random() * tw * 1.1;
    const len = span * (0.25 + random() * 0.85);
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
    if (ctx) {
      ctx.stroke(sr, sg, sb, alpha);
      ctx.strokeWeight(sw);
      ctx.line(rx, ry, rx + cos(angle) * len, ry + sin(angle) * len * 0.15);
    } else {
      stroke(sr, sg, sb, alpha);
      strokeWeight(sw);
      line(rx, ry, rx + cos(angle) * len, ry + sin(angle) * len * 0.15);
    }
  }
  if (ctx) ctx.noStroke();
  else noStroke();
}

/**
 * Offset print mode: mark size carries tone (not tile fill color).
 * Dots are mostly circular with optional square mixing to mimic print artifacts.
 */
/** `ctx` null = main canvas. `gridOverride` optional for export re-sample. */
function drawOffsetPrintScene(p, ctx, gridOverride) {
  const grid = gridOverride || inkGrid;
  if (!grid) return;
  const cols = p.cols;
  const rows = p.rows;
  const W = ctx ? ctx.width : width;
  const H = ctx ? ctx.height : height;
  const { slotW, slotH, ox, oy } = cellLayout(p, W, H);
  const gutter = max(0, p.gutter);

  const inkC = color(p.mosaicInkHex);
  const maxDBase = max(1, min(slotW, slotH) - gutter);

  if (ctx) {
    ctx.background(p.mosaicBgHex);
    ctx.noStroke();
    ctx.rectMode(CENTER);
    ctx.ellipseMode(CENTER);
  } else {
    background(p.mosaicBgHex);
    noStroke();
    rectMode(CENTER);
    ellipseMode(CENTER);
  }

  drawPaperTextureOverlay(p.mosaicBgHex, p.mosaicInkHex, W, H, p.seed, ctx);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let ink = grid[j][i];
      if (ink < 0.01) continue;

      const edge = neighborEdge(grid, i, j, cols, rows);
      const soften = lerp(1, 1 - p.edge * 0.85, edge);
      let level = ink * soften;
      const noiseShift =
        (noise(i * 0.35 + p.seed * 0.01, j * 0.35, p.seed * 0.02) - 0.5) * p.spread;
      level = constrain(level + noiseShift, 0, 1);
      level = applyToneContrast(level, p.contrast);

      // Dot size encodes tone, like offset halftone.
      const dotT = constrain(pow(level, 0.72) * p.dotGain, 0, 1);
      const d = max(maxDBase * 0.08, maxDBase * dotT);
      if (d < 0.6) continue;

      const cx =
        ox +
        i * slotW +
        slotW / 2 +
        (noise(i * 0.91 + p.seed * 0.003, j * 0.77 + 17.1) - 0.5) * slotW * p.dotJitter;
      const cy =
        oy +
        j * slotH +
        slotH / 2 +
        (noise(i * 0.67 + 42.4, j * 0.83 + p.seed * 0.002) - 0.5) * slotH * p.dotJitter;

      const squareLike = noise(i * 1.13 + p.seed * 0.004, j * 1.07 + 23.9) < p.dotSquareMix;
      if (ctx) {
        ctx.fill(inkC);
        if (squareLike) ctx.rect(cx, cy, d, d);
        else ctx.circle(cx, cy, d);
      } else {
        fill(inkC);
        if (squareLike) rect(cx, cy, d, d);
        else circle(cx, cy, d);
      }
    }
  }
  if (ctx) {
    ctx.rectMode(CORNER);
    ctx.ellipseMode(CENTER);
  } else {
    rectMode(CORNER);
  }
}

function drawScene(p, ctx, gridOverride) {
  const grid = gridOverride || inkGrid;
  if (!grid) return;
  const cols = p.cols;
  const rows = p.rows;
  const W = ctx ? ctx.width : width;
  const H = ctx ? ctx.height : height;
  const { slotW, slotH, ox, oy } = cellLayout(p, W, H);
  const gutter = max(0, p.gutter);

  const paper = color(p.mosaicBgHex);
  const inkC  = color(p.mosaicInkHex);
  const hi    = lerpColor(paper, inkC, 0.38);
  const { fillFrac: rectFillFrac } = tileRectInSlot(0, 0, slotW, slotH, gutter, p.cellShape);
  const primitiveFillFrac = p.tilePrimitive === "circle" ? PI / 4 : 1;
  const fillFrac = rectFillFrac * primitiveFillFrac;
  /** ~constant scratch strokes per unit tile area (tall/wide insets cover less of the slot). */
  const scratchMult = fillFrac < 0.999 ? 1 / sqrt(fillFrac) : 1;

  if (ctx) {
    ctx.background(p.mosaicBgHex);
    ctx.noStroke();
  } else {
    background(p.mosaicBgHex);
    noStroke();
  }

  drawPaperTextureOverlay(p.mosaicBgHex, p.mosaicInkHex, W, H, p.seed, ctx);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let ink = grid[j][i];
      if (ink < 0.02) continue;

      const edge = neighborEdge(grid, i, j, cols, rows);
      const soften = lerp(1, 1 - p.edge * 0.85, edge);
      let level = ink * soften;

      const noiseShift =
        (noise(i * 0.35 + p.seed * 0.01, j * 0.35, p.seed * 0.02) - 0.5) * p.spread;
      const randJitter = (random() - 0.5) * p.spread * 0.35;
      level = constrain(level + noiseShift + randJitter, 0, 1);
      let levelDraw = levelMatchedToSquareFill(level, fillFrac);
      levelDraw = applyToneContrast(levelDraw, p.contrast);

      const base = lerpColor(paper, inkC, levelDraw);
      const tileColor = lerpColor(base, hi, edge * p.edge * 0.4);
      const sx = ox + i * slotW;
      const sy = oy + j * slotH;
      const { px, py, tw, th } = tileRectInSlot(sx, sy, slotW, slotH, gutter, p.cellShape);

      if (ctx) {
        ctx.fill(tileColor);
        if (p.tilePrimitive === "circle") {
          const d = min(tw, th);
          ctx.circle(px + tw / 2, py + th / 2, d);
        } else {
          ctx.rect(px, py, tw, th);
        }
      } else {
        fill(tileColor);
        if (p.tilePrimitive === "circle") {
          const d = min(tw, th);
          circle(px + tw / 2, py + th / 2, d);
        } else {
          rect(px, py, tw, th);
        }
      }

      if (p.tilePrimitive !== "circle") {
        drawScratchCell(ctx, px, py, tw, th, levelDraw, p.grain, paper, inkC, scratchMult);
      }
    }
  }
}
