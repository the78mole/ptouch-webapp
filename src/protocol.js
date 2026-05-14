/**
 * protocol.js — Brother PT-E560BTVP Raster Command Protocol
 *
 * Implements the Brother Raster Command Reference for the PT-E series:
 *   • Invalidation handshake  (100 × 0x00)
 *   • Switch to Raster Mode   (ESC i a 0x01)
 *   • Media settings          (ESC i z)
 *   • Print mode / chain      (ESC i M)
 *   • Cut mode / half-cut     (ESC i K)
 *   • Compression             (ESC i A)
 *   • Feed margin             (ESC i d)
 *   • Raster lines            (G command / Z for empty lines)
 *   • Eject / full-cut        (0x1A)
 *   • Print without cut       (0x0C)
 *
 * Canvas rasterization:
 *   canvas.width  = label length in dots (number of raster lines)
 *   canvas.height = tape dot count       (dots per raster line)
 *   Each canvas column (x) maps to one raster line;
 *   bits are packed MSB-first along the Y axis.
 */

/** Native print resolution in dots-per-inch */
export const PRINT_DPI = 180;

/**
 * Tape configurations keyed by width in mm.
 * `dots`  — print-head dots spanning the printable area
 * `bytes` — bytes per raster line (ceil(dots / 8), byte-aligned)
 */
export const TAPE_CONFIG = {
  24: { dots: 128, bytes: 16 },
  18: { dots: 96,  bytes: 12 },
  12: { dots: 64,  bytes: 8  },
  9:  { dots: 48,  bytes: 6  },
  6:  { dots: 32,  bytes: 4  },
};

// ─── Low-level command builders ──────────────────────────────────────────────

/** 100 × 0x00 — reset / invalidation sequence */
export function buildInvalidation() {
  return new Uint8Array(100).fill(0x00);
}

/** ESC i a 0x01 — switch to raster mode */
export function buildRasterMode() {
  return new Uint8Array([0x1B, 0x69, 0x61, 0x01]);
}

/**
 * ESC i z — media-and-quality information command (13 bytes total).
 *
 * @param {number} tapeMm      - tape width in mm
 * @param {number} rasterLines - total number of raster lines to follow
 */
export function buildMediaCommand(tapeMm, rasterLines) {
  const lo = rasterLines & 0xFF;
  const hi = (rasterLines >> 8) & 0xFF;
  return new Uint8Array([
    0x1B, 0x69, 0x7A,
    0x8E,      // PI flags: RECOVER | QUALITY | LENGTH | WIDTH | TYPE
    0x0A,      // media type: TZe laminated tape
    tapeMm,    // tape width in mm
    0x00,      // label height (0 = continuous)
    lo, hi,    // raster line count (little-endian)
    0x00,      // starting page index
    0x00,      // number of copies (0 = unspecified / 1 implied)
    0x00, 0x00 // reserved
  ]);
}

/**
 * ESC i K — cut-mode command.
 *
 * @param {boolean} halfCut - true → half-cut after this label
 */
export function buildCutCommand(halfCut) {
  return new Uint8Array([0x1B, 0x69, 0x4B, halfCut ? 0x08 : 0x00]);
}

/**
 * ESC i M — print-mode command.
 *
 * @param {boolean} chain - true → chain printing (no auto tape-cut at end)
 */
export function buildModeCommand(chain) {
  return new Uint8Array([0x1B, 0x69, 0x4D, chain ? 0x08 : 0x00]);
}

/** ESC i A 0x00 — disable raster-data compression */
export function buildCompressionCommand() {
  return new Uint8Array([0x1B, 0x69, 0x41, 0x00]);
}

/**
 * ESC i d — margin (feed) before printing (in dots).
 *
 * @param {number} dots - feed amount; 0 for no extra margin
 */
export function buildMarginCommand(dots = 0) {
  return new Uint8Array([
    0x1B, 0x69, 0x64,
    dots & 0xFF,
    (dots >> 8) & 0xFF,
  ]);
}

/**
 * G command — one raster line with data.
 *
 * @param {Uint8Array} lineData - packed raster bytes for this line
 */
export function buildRasterLine(lineData) {
  const result = new Uint8Array(3 + lineData.length);
  result[0] = 0x47;                         // 'G'
  result[1] = lineData.length & 0xFF;       // length low byte
  result[2] = (lineData.length >> 8) & 0xFF; // length high byte
  result.set(lineData, 3);
  return result;
}

/** Z command — empty raster line (advance tape by one dot, no ink) */
export function buildEmptyLine() {
  return new Uint8Array([0x5A]);
}

/** 0x0C — print current label (no eject, used with chain printing) */
export function buildPrint() {
  return new Uint8Array([0x0C]);
}

/** 0x1A — print + eject (full cut; ends a print session or series) */
export function buildEject() {
  return new Uint8Array([0x1A]);
}

// ─── Canvas rasterization ────────────────────────────────────────────────────

/**
 * Convert an HTMLCanvasElement to an array of raster-line Uint8Arrays.
 *
 * The canvas must be oriented so that:
 *   canvas.width  = label length in dots (= number of raster lines)
 *   canvas.height = tape dots (= height of what is drawn on the tape)
 *
 * Each column (x) of the canvas becomes one raster line.
 * Each bit within a line represents one print-head dot along the Y axis,
 * packed MSB-first (y=0 → bit 7 of byte 0).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} tapeMm - tape width in mm (must exist in TAPE_CONFIG)
 * @returns {Uint8Array[]}
 */
export function canvasToRasterLines(canvas, tapeMm) {
  const cfg = TAPE_CONFIG[tapeMm] ?? TAPE_CONFIG[24];
  const { dots: tapeDots, bytes: bytesPerLine } = cfg;

  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const px = imageData.data; // RGBA uint8 array

  const lines = [];

  for (let x = 0; x < width; x++) {
    const lineBytes = new Uint8Array(bytesPerLine);

    for (let dot = 0; dot < tapeDots; dot++) {
      // Map dot index to canvas y coordinate (scale to canvas height)
      const y = Math.min(Math.floor((dot / tapeDots) * height), height - 1);
      const i = (y * width + x) * 4; // RGBA index

      const alpha = px[i + 3];
      // Treat transparent pixels as white (no ink)
      const brightness = alpha < 128
        ? 255
        : (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);

      if (brightness < 128) {
        const byteIdx = dot >> 3;           // floor(dot / 8)
        const bitIdx  = 7 - (dot & 7);     // MSB-first within byte
        lineBytes[byteIdx] |= 1 << bitIdx;
      }
    }

    lines.push(lineBytes);
  }

  return lines;
}

// ─── Print-job builder ───────────────────────────────────────────────────────

/**
 * Build a complete binary print-job buffer ready to send to the printer.
 *
 * The buffer contains the full handshake, per-label headers, all raster
 * lines, and the final eject (or chain-print) command.
 *
 * @param {HTMLCanvasElement} canvas  - rendered label canvas
 * @param {object}  settings
 * @param {number}  settings.tapeMm  - tape width in mm (12 | 18 | 24)
 * @param {boolean} settings.halfCut - insert a half-cut between copies
 * @param {boolean} settings.chain   - keep chain mode open (no final full-cut)
 * @param {number}  settings.copies  - number of copies to print
 * @returns {Uint8Array}
 */
export function buildPrintJob(canvas, settings) {
  const {
    tapeMm  = 24,
    halfCut = false,
    chain   = false,
    copies  = 1,
  } = settings;

  const rasterLines  = canvasToRasterLines(canvas, tapeMm);
  const totalLines   = rasterLines.length;
  const parts        = [];

  // ── Initialisation (sent once per job) ──
  parts.push(buildInvalidation());
  parts.push(buildRasterMode());

  // ── Per-copy section ──
  for (let copy = 0; copy < copies; copy++) {
    const isLastCopy = copy === copies - 1;

    // Chain between copies; honour caller's `chain` flag for the last copy
    const chainThisLabel = isLastCopy ? chain : true;

    // Half-cut between copies (not after the very last one unless requested)
    const halfCutThisLabel = halfCut && !isLastCopy;

    parts.push(buildMediaCommand(tapeMm, totalLines));
    parts.push(buildCutCommand(halfCutThisLabel));
    parts.push(buildModeCommand(chainThisLabel));
    parts.push(buildCompressionCommand());
    parts.push(buildMarginCommand(0));

    // Raster data
    for (const lineData of rasterLines) {
      const isEmpty = lineData.every(b => b === 0);
      parts.push(isEmpty ? buildEmptyLine() : buildRasterLine(lineData));
    }

    // Finalise this copy
    if (isLastCopy && !chain) {
      parts.push(buildEject());  // full-cut + eject
    } else {
      parts.push(buildPrint());  // print, stay in chain mode
    }
  }

  // ── Concatenate all command segments ──
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

/**
 * Build a minimal "finalize series" buffer: just an eject command.
 * Send this after a chain-printing session to trigger the final full-cut.
 *
 * @returns {Uint8Array}
 */
export function buildFinalizeJob() {
  return buildEject();
}
