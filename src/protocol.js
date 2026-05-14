/**
 * protocol.js — Brother PT-E560BTVP Raster Command Protocol
 *
 * Command sequence verified against libptouch (ptouch-print) source:
 *   https://git.familie-radermacher.ch/linux/ptouch-print.git
 *
 * PT-E560BT device flags: FLAG_P700_INIT | FLAG_USE_INFO_CMD | FLAG_D460BT_MAGIC
 *
 * Per-copy sequence:
 *   1. 100×0x00 + ESC @       (invalidation + reset, once per job)
 *   2. ESC i a 0x01           (raster mode, FLAG_P700_INIT)
 *   3. ESC i z …              (info command, FLAG_USE_INFO_CMD, n9=0x02 for D460BT)
 *   4. ESC i d 01 00 4D 00    (D460BT magic, FLAG_D460BT_MAGIC — n3 MUST be 0x4D)
 *   5. ESC i K 0x00           (chain signal, only if chaining)
 *   6. G + len + data …       (raster lines, always 16 bytes each)
 *   7. 0x1A                   (eject/finalize, always for D460BT)
 *
 * Canvas rasterization:
 *   canvas.width  = label length in dots (number of raster lines)
 *   canvas.height = tape dot count       (dots per raster line)
 *   Bit packing matches libptouch reference:
 *     rasterline[(16-1)-(pixel/8)] |= 1 << (pixel % 8)   (LSB-first, reverse-indexed)
 */

/** Native print resolution in dots-per-inch */
export const PRINT_DPI = 180;

/**
 * Tape configurations keyed by width in mm.
 *
 * Dot counts from libptouch tape_info[] table (180 DPI).
 * The print head is always 128 dots wide; narrower tapes are centred.
 * The pixel offset is computed dynamically: offsetDots = (128 - dots) / 2.
 *
 * `dots` — printable dots for this tape width at 180 DPI
 */
export const TAPE_CONFIG = {
  24: { dots: 128 },
  18: { dots: 120 },
  12: { dots: 76 },
  9: { dots: 52 },
  6: { dots: 32 },
};

// ─── Low-level command builders ──────────────────────────────────────────────

/** 100 × 0x00 + ESC @ — invalidation then soft-reset (required by PT-E560BT) */
export function buildInvalidation() {
  const buf = new Uint8Array(102); // zeroed by default
  buf[100] = 0x1b; // ESC
  buf[101] = 0x40; // @
  return buf;
}

/** ESC i a 0x01 — switch to raster mode */
export function buildRasterMode() {
  return new Uint8Array([0x1b, 0x69, 0x61, 0x01]);
}

/**
 * ESC i z — print information command (13 bytes), FLAG_USE_INFO_CMD.
 *
 * Format verified against ptouch_info_cmd() in libptouch.c:
 *   cmd[3..4] = 0x00 0x00  (PI flags, unused)
 *   cmd[5]    = tape width in mm
 *   cmd[6]    = 0x00 (label height, 0 = continuous)
 *   cmd[7..10]= raster line count (32-bit little-endian)
 *   cmd[11]   = 0x02  (required for FLAG_D460BT_MAGIC devices like PT-E560BT)
 *   cmd[12]   = 0x00
 *
 * @param {number} tapeMm      - tape width in mm
 * @param {number} rasterLines - total number of raster lines to follow
 */
export function buildMediaCommand(tapeMm, rasterLines) {
  return new Uint8Array([
    0x1b,
    0x69,
    0x7a,
    0x00,
    0x00, // PI flags (unused)
    tapeMm, // tape width in mm
    0x00, // label height (0 = continuous)
    rasterLines & 0xff,
    (rasterLines >> 8) & 0xff,
    (rasterLines >> 16) & 0xff,
    (rasterLines >> 24) & 0xff,
    0x02, // n9: REQUIRED for D460BT/E560BT — feed control
    0x00, // reserved
  ]);
}

/**
 * ESC i K — cut-mode command.
 *
 * @param {boolean} halfCut - true → half-cut after this label
 */
export function buildCutCommand(halfCut) {
  return new Uint8Array([0x1b, 0x69, 0x4b, halfCut ? 0x08 : 0x00]);
}

/**
 * ESC i M — print-mode command.
 *
 * bit 6 (0x40): mirror print (do NOT set — mirrors the image)
 * bit 3 (0x08): special tape cut options (model-dependent)
 *
 * Use 0x00 for both normal and chain printing; the eject/print command
 * (0x1A / 0x0C) controls whether a cut follows.
 *
 * @param {boolean} _chain - reserved for future use
 */
export function buildModeCommand(_chain) {
  return new Uint8Array([0x1b, 0x69, 0x4d, 0x00]);
}

/** ESC i A 0x00 — disable raster-data compression */
export function buildCompressionCommand() {
  return new Uint8Array([0x1b, 0x69, 0x41, 0x00]);
}

/**
 * ESC i d — margin (feed) before printing (in dots).
 *
 * @param {number} dots - feed amount; 0 for no extra margin
 */
export function buildMarginCommand(dots = 0) {
  return new Uint8Array([0x1b, 0x69, 0x64, dots & 0xff, (dots >> 8) & 0xff]);
}

/**
 * D460BT magic command — ESC i d 01 00 4D 00 (7 bytes).
 *
 * Required for PT-E560BT (FLAG_D460BT_MAGIC). Must be sent after the
 * info command and before raster data. The byte at position 6 (0x4D)
 * MUST be 0x4D or the print is corrupted (verified in libptouch source).
 */
export function buildD460btMagic() {
  return new Uint8Array([0x1b, 0x69, 0x64, 0x01, 0x00, 0x4d, 0x00]);
}

/**
 * G command — one raster line with data.
 *
 * @param {Uint8Array} lineData - packed raster bytes for this line
 */
export function buildRasterLine(lineData) {
  const result = new Uint8Array(3 + lineData.length);
  result[0] = 0x47; // 'G'
  result[1] = lineData.length & 0xff; // length low byte
  result[2] = (lineData.length >> 8) & 0xff; // length high byte
  result.set(lineData, 3);
  return result;
}

/** Z command — empty raster line (advance tape by one dot, no ink) */
export function buildEmptyLine() {
  return new Uint8Array([0x5a]);
}

/** 0x0C — print current label (no eject, used with chain printing) */
export function buildPrint() {
  return new Uint8Array([0x0c]);
}

/** 0x1A — print + eject (full cut; ends a print session or series) */
export function buildEject() {
  return new Uint8Array([0x1a]);
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
 * Bit packing matches libptouch reference (rasterline_setpixel):
 *   rasterline[(16-1)-(pixel/8)] |= 1 << (pixel % 8)   LSB-first, reverse-indexed
 *
 * The print head is 128 dots wide; narrower tapes are centred:
 *   offsetDots = Math.floor((128 - tapeDots) / 2)
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} tapeMm - tape width in mm (must exist in TAPE_CONFIG)
 * @returns {Uint8Array[]}
 */
export function canvasToRasterLines(canvas, tapeMm) {
  const cfg = TAPE_CONFIG[tapeMm] ?? TAPE_CONFIG[24];
  const tapeDots = cfg.dots;
  const HEAD_BYTES = 16;
  const HEAD_DOTS = 128;
  // Centred offset within the 128-dot print head (pixel units, not bytes)
  const offsetDots = Math.floor((HEAD_DOTS - tapeDots) / 2);

  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const px = imageData.data; // RGBA uint8 array

  const lines = [];

  for (let x = 0; x < width; x++) {
    const lineBytes = new Uint8Array(HEAD_BYTES); // 16 bytes, zeroed

    for (let dot = 0; dot < tapeDots; dot++) {
      // Scale dot index to canvas y coordinate
      const y = Math.min(Math.floor((dot / tapeDots) * height), height - 1);
      const i = (y * width + x) * 4; // RGBA index

      const alpha = px[i + 3];
      const brightness =
        alpha < 128
          ? 255
          : px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;

      if (brightness < 128) {
        // Canvas top (dot=0) → highest pixel position (matches libptouch flip).
        const pixel = offsetDots + (tapeDots - 1 - dot);
        // Reference: rasterline[(size-1)-(pixel/8)] |= 1 << (pixel % 8)
        const byteIdx = HEAD_BYTES - 1 - Math.floor(pixel / 8);
        const bitIdx = pixel & 7; // LSB-first
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
  const { tapeMm = 24, halfCut = false, chain = false, copies = 1 } = settings;

  const rasterLines = canvasToRasterLines(canvas, tapeMm);
  const totalLines = rasterLines.length;
  const parts = [];

  // ── Initialisation (sent once per job) ──
  parts.push(buildInvalidation()); // 100×0x00 + ESC @

  // ── Per-copy section (rasterstart + info + magic + data + eject per copy) ──
  for (let copy = 0; copy < copies; copy++) {
    const isLastCopy = copy === copies - 1;
    const chainThisLabel = isLastCopy ? chain : true;

    // 1. Switch to raster mode (FLAG_P700_INIT style)
    parts.push(buildRasterMode()); // 1B 69 61 01
    // 2. Print information command (FLAG_USE_INFO_CMD, n9=0x02 for D460BT)
    parts.push(buildMediaCommand(tapeMm, totalLines));
    // 3. D460BT magic — MUST be sent before raster data (FLAG_D460BT_MAGIC)
    parts.push(buildD460btMagic()); // 1B 69 64 01 00 4D 00
    // 4. Cut-mode signal (ESC i K) — sent before raster data:
    //   0x00 = chain/no-cut  (D460BT: omit cut, feed only)
    //   0x08 = half-cut      (perforation, no full cut)
    //   omitting ESC i K    = full cut via 0x1A below
    if (chainThisLabel) {
      parts.push(buildCutCommand(false)); // 1B 69 4B 00 = chain (no cut)
    } else if (halfCut) {
      parts.push(buildCutCommand(true)); // 1B 69 4B 08 = half cut
    }

    // 5. Raster data
    for (const lineData of rasterLines) {
      parts.push(buildRasterLine(lineData));
    }

    // 6. Finalise — PT-E560BT (FLAG_D460BT_MAGIC) always uses eject (0x1A),
    //    chain vs single-cut is controlled by the chain signal above.
    parts.push(buildEject()); // 1A
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

// ─── Status / diagnostics ────────────────────────────────────────────────────

/** ESC i S — request printer status (printer replies with 32 bytes).
 *
 * Prefixed with 100 × 0x00 to flush any pending command bytes from the
 * printer’s receive buffer before the status query is sent.  This mirrors
 * the behaviour of ptouch-print’s ptouch_getstatus() and prevents a
 * partially-received prior command from corrupting the status response.
 */
export function buildStatusRequest() {
  // 100 × 0x00 (flush) + ESC i S
  const buf = new Uint8Array(103);
  // bytes 0-99 are already 0x00
  buf[100] = 0x1b; // ESC
  buf[101] = 0x69; // i
  buf[102] = 0x53; // S
  return buf;
}

/**
 * Decode the 32-byte status response packet sent by the printer.
 *
 * Returns `null` when the bytes do not look like a valid response
 * (wrong header, insufficient length).
 *
 * @param {Uint8Array} bytes
 * @returns {{
 *   tapeWidthMm: number,
 *   mediaType:   string,
 *   tapeColor:   string,
 *   textColor:   string,
 *   errors:      string[]|null,
 *   raw:         Uint8Array,
 * }|null}
 */
export function parseStatusResponse(bytes) {
  if (!bytes || bytes.length < 32) return null;
  // Header: 0x80 (print-head mark) + 0x20 (size=32)
  if (bytes[0] !== 0x80 || bytes[1] !== 0x20) return null;

  // PT-E560BT (D460BT-family) byte layout — empirically verified:
  // [0]  0x80  header
  // [1]  0x20  length = 32
  // [2]  model code
  // [3]  country code
  // [4]  battery / power status (0x7F = AC connected)
  // [5]  BT / extended field
  // [6]  status flags (not error bits)
  // [7]  error info 1
  // [8]  error info 2
  // [9]  reserved
  // [10] tape width in mm   ← media width
  // [11] media/tape type
  // [12..23] mode, density, phase, notification fields
  // [24] tape colour
  // [25] text colour
  // [26..31] hardware settings

  const MEDIA_TYPE = {
    0x00: "No tape",
    0x01: "Laminated tape",
    0x03: "Non-laminated tape",
    0x11: "Heat-shrink 2:1",
    0x14: "TZe tape",
    0x17: "Heat-shrink 3:1",
    0xff: "Incompatible tape",
  };

  const TAPE_COLOR = {
    0x01: "White",
    0x02: "Other",
    0x03: "Clear",
    0x04: "Red",
    0x05: "Blue",
    0x06: "Yellow",
    0x07: "Green",
    0x08: "Black",
    0x09: "Clear (white text)",
    0x20: "Matte white",
    0x21: "Matte clear",
    0x22: "Matte silver",
    0x40: "Fluorescent orange",
    0x41: "Fluorescent yellow",
    0x50: "Berry pink",
    0x90: "White (standard)",
  };

  const TEXT_COLOR = {
    0x01: "White",
    0x04: "Red",
    0x05: "Blue",
    0x08: "Black",
    0x0a: "Gold",
    0x0f: "Blue (neon)",
    0xff: "Incompatible",
  };

  const err1 = bytes[7];
  const err2 = bytes[8];
  const errors = [];
  if (err1 & 0x01) errors.push("No media");
  if (err1 & 0x02) errors.push("Tape end");
  if (err1 & 0x04) errors.push("Cutter jam");
  if (err1 & 0x40) errors.push("Transmission error");
  if (err1 & 0x80) errors.push("Cover open");
  if (err2 & 0x01) errors.push("Wrong media");
  if (err2 & 0x02) errors.push("Buffer overflow");

  return {
    tapeWidthMm: bytes[10],
    mediaType:
      MEDIA_TYPE[bytes[11]] ??
      `Unknown (0x${bytes[11].toString(16).padStart(2, "0")})`,
    tapeColor:
      TAPE_COLOR[bytes[24]] ??
      `Unknown (0x${bytes[24].toString(16).padStart(2, "0")})`,
    textColor:
      TEXT_COLOR[bytes[25]] ??
      `Unknown (0x${bytes[25].toString(16).padStart(2, "0")})`,
    errors: errors.length ? errors : null,
    raw: bytes,
  };
}

/**
 * Build a minimal blank print job that performs feed + full cut without
 * printing anything.
 *
 * Sequence: reset → raster mode → media (0 raster lines) → D460BT magic
 * → 0x1A (eject/cut).  No ESC i K is sent, so the printer does a full cut.
 *
 * Can be used both to finalise a chain-print series and to do a standalone
 * cut at any time.  The tape-width parameter is needed for the media command;
 * pass the currently selected width from the UI.
 *
 * @param {number} [tapeMm=24] - tape width in mm (must exist in TAPE_CONFIG)
 * @returns {Uint8Array}
 */
export function buildCutJob(tapeMm = 24) {
  const parts = [
    buildInvalidation(), // 100×0x00 + ESC @ — reset state
    buildRasterMode(), // 1B 69 61 01
    buildMediaCommand(tapeMm, 0), // 0 raster lines → nothing to print
    buildD460btMagic(), // 1B 69 64 01 00 4D 00
    // no ESC i K → full cut
    buildEject(), // 0x1A — feed + cut
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return buf;
}
