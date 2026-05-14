/**
 * app.js — Label Designer UI Controller
 *
 * Wires DOM events to the Bluetooth and Protocol modules.
 * Manages the live-preview canvas and print orchestration.
 */

import "./style.css";
import QRCode from "qrcode";
import { SerialManager } from "./serial.js";
import {
  buildPrintJob,
  buildStatusRequest,
  parseStatusResponse,
  buildCutJob,
  TAPE_CONFIG,
  PRINT_DPI,
} from "./protocol.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Extra horizontal dot padding added to each side of the measured text width */
const LABEL_H_PADDING_DOTS = 20;

/** Minimum label width in dots regardless of text length */
const LABEL_MIN_WIDTH_DOTS = 40;

// ─── App version (injected at build time by vite.config.js define) ───────────
/* global __APP_VERSION__, __APP_BUILD_DATE__ */

const appVersionEl = document.getElementById("app-version");
if (appVersionEl) {
  appVersionEl.textContent = `${__APP_VERSION__} · ${__APP_BUILD_DATE__}`;
}

// ─── Serial manager ─────────────────────────────────────────────────────────

const serial = new SerialManager();

// ─── DOM refs ────────────────────────────────────────────────────────────────

const connectBtn = /** @type {HTMLButtonElement}  */ (
  document.getElementById("connect-btn")
);
const statusDot = /** @type {HTMLSpanElement}    */ (
  document.getElementById("status-dot")
);
const statusText = /** @type {HTMLSpanElement}    */ (
  document.getElementById("status-text")
);

const btHelpBox = /** @type {HTMLElement}        */ (
  document.getElementById("bt-help-box")
);
const btHelpDismiss = /** @type {HTMLButtonElement} */ (
  document.getElementById("bt-help-dismiss")
);
const btHelpShow = /** @type {HTMLButtonElement}   */ (
  document.getElementById("bt-help-show")
);

const logToggle = /** @type {HTMLInputElement}   */ (
  document.getElementById("log-toggle")
);
const logPanel = /** @type {HTMLDivElement}     */ (
  document.getElementById("log-panel")
);
const logOutput = /** @type {HTMLPreElement}     */ (
  document.getElementById("log-output")
);
const logClearBtn = /** @type {HTMLButtonElement}  */ (
  document.getElementById("log-clear")
);

const labelTextarea = /** @type {HTMLTextAreaElement}*/ (
  document.getElementById("label-text")
);
const fontSizeInput = /** @type {HTMLInputElement}   */ (
  document.getElementById("font-size")
);
const fontSizeLabel = /** @type {HTMLSpanElement}    */ (
  document.getElementById("font-size-value")
);
const boldToggle = /** @type {HTMLInputElement}   */ (
  document.getElementById("bold-toggle")
);

const tapePills = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="tape-size"]')
);

const halfCutInput = /** @type {HTMLInputElement}   */ (
  document.getElementById("half-cut")
);
const chainInput = /** @type {HTMLInputElement}   */ (
  document.getElementById("chain-print")
);
const copiesMinus = /** @type {HTMLButtonElement}  */ (
  document.getElementById("copies-dec")
);
const copiesPlus = /** @type {HTMLButtonElement}  */ (
  document.getElementById("copies-inc")
);
const copiesInput = /** @type {HTMLInputElement}   */ (
  document.getElementById("copies")
);

const printBtn = /** @type {HTMLButtonElement}  */ (
  document.getElementById("print-btn")
);
const cutBtn = /** @type {HTMLButtonElement}  */ (
  document.getElementById("cut-btn")
);
const queryBtn = /** @type {HTMLButtonElement}  */ (
  document.getElementById("query-btn")
);
const tapeInfoEl = /** @type {HTMLSpanElement}     */ (
  document.getElementById("tape-info")
);

const qrTextInput = /** @type {HTMLInputElement}   */ (
  document.getElementById("qr-text")
);
const qrPosPills = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="qr-pos"]')
);
const qrEcPills = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="qr-ec"]')
);

const previewCanvas = /** @type {HTMLCanvasElement}  */ (
  document.getElementById("preview-canvas")
);
const renderCanvas = /** @type {HTMLCanvasElement}  */ (
  document.getElementById("render-canvas")
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function selectedTapeMm() {
  for (const pill of tapePills) {
    if (pill.checked) return parseInt(pill.value, 10);
  }
  return 24;
}

function clampCopies(n) {
  return Math.max(1, Math.min(99, n));
}

// ─── Debug log ─────────────────────────────────────────────────────────

/** @param {'info'|'ok'|'warn'|'error'} level */
function log(level, ...args) {
  const prefix =
    { info: "ℹ️ ", ok: "✅ ", warn: "⚠️ ", error: "❌ " }[level] ?? "";
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const line = `[${ts}] ${prefix}${args.join(" ")}`;
  console[level === "ok" ? "log" : level](...args);
  logOutput.textContent += line + "\n";
  logOutput.scrollTop = logOutput.scrollHeight;
}

logToggle.addEventListener("change", () => {
  logPanel.classList.toggle("hidden", !logToggle.checked);
});

logClearBtn.addEventListener("click", () => {
  logOutput.textContent = "";
});

// Wire the logger into the serial manager now that log() is defined.
serial.setLogger(log);

// ─── Serial status ───────────────────────────────────────────────────────────

serial.onStatusChange = (status) => {
  switch (status) {
    case "connected":
      statusDot.className = "status-dot bg-green-500";
      statusText.textContent = serial.deviceName
        ? `${serial.deviceName}`
        : "Connected";
      log("ok", "Connected:", serial.deviceName ?? "Serial Port");
      connectBtn.textContent = "Disconnect";
      connectBtn.classList.replace("bg-blue-600", "bg-red-600");
      connectBtn.classList.replace("hover:bg-blue-700", "hover:bg-red-700");
      printBtn.disabled = false;
      cutBtn.disabled = false;
      queryBtn.disabled = false;
      break;

    case "reconnecting":
      statusDot.className = "status-dot bg-yellow-500 animate-pulse";
      statusText.textContent = "Reconnecting…";
      printBtn.disabled = true;
      cutBtn.disabled = true;
      queryBtn.disabled = true;
      break;

    case "disconnected":
    default:
      statusDot.className = "status-dot bg-red-500";
      statusText.textContent = "Disconnected";
      connectBtn.textContent = "Connect Printer";
      connectBtn.classList.replace("bg-red-600", "bg-blue-600");
      connectBtn.classList.replace("hover:bg-red-700", "hover:bg-blue-700");
      printBtn.disabled = true;
      cutBtn.disabled = true;
      queryBtn.disabled = true;
      log("warn", "Disconnected");
      break;
  }
};

// ─── Connect / disconnect ────────────────────────────────────────────────────

connectBtn.addEventListener("click", async () => {
  if (serial.isConnected()) {
    log("info", "Disconnecting…");
    await serial.disconnect();
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = "Connecting…";
  log("info", "Requesting serial port…");
  try {
    const name = await serial.connect();
    log("ok", "Port opened:", name);
  } catch (err) {
    console.error("Connection failed:", err);
    log("error", "Connection failed:", err.message);
    showToast(`Connection failed: ${err.message}`, "error");
    serial.onStatusChange?.("disconnected");
  } finally {
    connectBtn.disabled = false;
  }
});

// ─── Canvas rendering ────────────────────────────────────────────────────────

let rafId = 0;

function scheduleRender() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(renderLabel);
}

/** Return the currently selected QR position ('off' | 'left' | 'right'). */
function selectedQrPos() {
  for (const p of qrPosPills) if (p.checked) return p.value;
  return "off";
}

/** Return the selected QR error-correction level ('L' | 'M' | 'Q' | 'H'). */
function selectedQrEc() {
  for (const p of qrEcPills) if (p.checked) return p.value;
  return "M";
}

/**
 * Generate a QR-code canvas for the given `size` (the raw QR pixel size,
 * without any padding). The caller is responsible for placing it with the
 * desired margin.
 *
 * @param {string} content
 * @param {number} size                    - target pixel size of the QR square
 * @param {string} [errorCorrectionLevel]  - 'L' | 'M' | 'Q' | 'H'
 * @returns {Promise<HTMLCanvasElement>}
 */
async function makeQrCanvas(content, size, errorCorrectionLevel = "M") {
  const c = document.createElement("canvas");
  await QRCode.toCanvas(c, content, {
    width: size,
    margin: 0,
    errorCorrectionLevel,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return c;
}

/** Fractional vertical (and horizontal) margin for the QR block. */
const QR_MARGIN_FRAC = 0.075;

async function renderLabel() {
  const tapeMm = selectedTapeMm();
  const cfg = TAPE_CONFIG[tapeMm] ?? TAPE_CONFIG[24];
  const tapeDots = cfg.dots;

  const text = labelTextarea.value || "Label Text";
  const fontSize = Math.max(8, parseInt(fontSizeInput.value, 10));
  const isBold = boldToggle.checked;
  const fontSpec = `${isBold ? "bold " : ""}${fontSize}px sans-serif`;
  const qrPos = selectedQrPos();
  const qrContent = qrTextInput.value.trim();

  // ── Optionally render QR code ──
  // The QR block is tapeDots wide (square). Within it the QR is padded by
  // QR_MARGIN_FRAC on all four sides, so all margins are equal.
  const qrPad = Math.round(tapeDots * QR_MARGIN_FRAC);
  const qrDrawSize = tapeDots - 2 * qrPad; // QR pixel size on the label
  const qrBlockW = tapeDots; // total width reserved for the QR block

  let qrCanvas = null;
  if (qrPos !== "off" && qrContent) {
    try {
      qrCanvas = await makeQrCanvas(qrContent, qrDrawSize, selectedQrEc());
    } catch {
      qrCanvas = null; // ignore invalid content
    }
  }

  // ── Measure text to determine canvas width ──
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = fontSpec;
  const lines = text.split("\n");
  const lineHeight = Math.ceil(fontSize * 1.25);
  const textW = Math.max(
    ...lines.map((l) => Math.ceil(probe.measureText(l).width)),
  );
  const textAreaW = Math.max(
    textW + LABEL_H_PADDING_DOTS,
    LABEL_MIN_WIDTH_DOTS,
  );
  const labelW = textAreaW + (qrCanvas ? qrBlockW : 0);
  const labelH = tapeDots;

  // ── Draw on the hidden render canvas ──
  renderCanvas.width = labelW;
  renderCanvas.height = labelH;

  const ctx = renderCanvas.getContext("2d");

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, labelW, labelH);

  // Place QR code: draw at (qrX + qrPad, qrPad) scaled to qrDrawSize×qrDrawSize
  // so all four margins equal qrPad pixels.
  let textOffsetX = 0;
  if (qrCanvas) {
    const qrBlockX = qrPos === "left" ? 0 : textAreaW;
    ctx.drawImage(qrCanvas, qrBlockX + qrPad, qrPad, qrDrawSize, qrDrawSize);
    if (qrPos === "left") textOffsetX = qrBlockW;
  }

  // Black text, centred in the text area
  ctx.font = fontSpec;
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const totalTextH = lines.length * lineHeight;
  const startY = (labelH - totalTextH) / 2 + lineHeight / 2;
  const textCentreX = textOffsetX + textAreaW / 2;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], textCentreX, startY + i * lineHeight);
  }

  updatePreview();
}

function updatePreview() {
  const container = /** @type {HTMLElement} */ (
    document.getElementById("preview-area")
  );
  const maxW = container.clientWidth - 24; // subtract padding
  const maxH = Math.min(160, container.clientHeight - 24);

  if (maxW <= 0 || maxH <= 0) return;

  const scale = Math.min(
    maxW / renderCanvas.width,
    maxH / renderCanvas.height,
    4,
  );

  previewCanvas.width = Math.max(1, Math.round(renderCanvas.width * scale));
  previewCanvas.height = Math.max(1, Math.round(renderCanvas.height * scale));

  const pCtx = previewCanvas.getContext("2d");
  pCtx.imageSmoothingEnabled = false;
  pCtx.drawImage(renderCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
}

// ─── Settings persistence (localStorage) ─────────────────────────────────────

const SETTINGS_KEY = "ptouch_settings";

function saveSettings() {
  const checkedPill = document.querySelector('input[name="tape-size"]:checked');
  const checkedQr = document.querySelector('input[name="qr-pos"]:checked');
  const settings = {
    text: labelTextarea.value,
    fontSize: fontSizeInput.value,
    bold: boldToggle.checked,
    tape: checkedPill?.value ?? "24",
    halfCut: halfCutInput.checked,
    chain: chainInput.checked,
    copies: copiesInput.value,
    qrPos: checkedQr?.value ?? "off",
    qrText: qrTextInput.value,
    qrEc: selectedQrEc(),
    btHelpHidden: btHelpBox.classList.contains("hidden"),
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore QuotaExceededError or private-mode restrictions.
  }
}

function loadSettings() {
  let settings;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    settings = JSON.parse(raw);
  } catch {
    return;
  }

  if (settings.text !== undefined) labelTextarea.value = settings.text;
  if (settings.fontSize !== undefined) {
    fontSizeInput.value = settings.fontSize;
    fontSizeLabel.textContent = `${settings.fontSize}px`;
  }
  if (settings.bold !== undefined) boldToggle.checked = settings.bold;
  if (settings.tape !== undefined) {
    for (const pill of tapePills) {
      pill.checked = pill.value === String(settings.tape);
    }
  }
  if (settings.halfCut !== undefined) halfCutInput.checked = settings.halfCut;
  if (settings.chain !== undefined) chainInput.checked = settings.chain;
  if (settings.copies !== undefined)
    copiesInput.value = String(clampCopies(parseInt(settings.copies, 10) || 1));
  if (settings.qrPos !== undefined) {
    for (const p of qrPosPills) p.checked = p.value === settings.qrPos;
    qrTextInput.disabled = settings.qrPos === "off";
  }
  if (settings.qrText !== undefined) qrTextInput.value = settings.qrText;
  if (settings.qrEc !== undefined) {
    for (const p of qrEcPills) p.checked = p.value === settings.qrEc;
  }
  if (settings.btHelpHidden) btHelpBox.classList.add("hidden");
}

// Restore saved settings before the first render.
loadSettings();

// ─── Bluetooth help box ───────────────────────────────────────────────────────

btHelpDismiss.addEventListener("click", () => {
  btHelpBox.classList.add("hidden");
  saveSettings();
});

btHelpShow.addEventListener("click", () => {
  btHelpBox.classList.remove("hidden");
  btHelpBox.scrollIntoView({ behavior: "smooth", block: "start" });
  saveSettings();
});

// ─── UI event listeners ───────────────────────────────────────────────────────

labelTextarea.addEventListener("input", () => {
  saveSettings();
  scheduleRender();
});

fontSizeInput.addEventListener("input", () => {
  fontSizeLabel.textContent = `${fontSizeInput.value}px`;
  saveSettings();
  scheduleRender();
});

boldToggle.addEventListener("change", () => {
  saveSettings();
  scheduleRender();
});

for (const pill of tapePills) {
  pill.addEventListener("change", () => {
    saveSettings();
    scheduleRender();
  });
}

copiesMinus.addEventListener("click", () => {
  copiesInput.value = String(clampCopies(parseInt(copiesInput.value, 10) - 1));
  saveSettings();
});

copiesPlus.addEventListener("click", () => {
  copiesInput.value = String(clampCopies(parseInt(copiesInput.value, 10) + 1));
  saveSettings();
});

copiesInput.addEventListener("change", () => {
  copiesInput.value = String(clampCopies(parseInt(copiesInput.value, 10) || 1));
  saveSettings();
});

halfCutInput.addEventListener("change", saveSettings);
chainInput.addEventListener("change", saveSettings);

for (const p of qrPosPills) {
  p.addEventListener("change", () => {
    qrTextInput.disabled = p.value === "off";
    saveSettings();
    scheduleRender();
  });
}
qrTextInput.addEventListener("input", () => {
  saveSettings();
  scheduleRender();
});

for (const p of qrEcPills) {
  p.addEventListener("change", () => {
    saveSettings();
    scheduleRender();
  });
}

// Redraw preview on window resize so scaling stays correct.
// Observe the *outer* preview-area, not the tape-wrapper (which is sized by
// the canvas itself — observing it would create a feedback loop).
const resizeObserver = new ResizeObserver(scheduleRender);
resizeObserver.observe(document.getElementById("preview-area"));

// ─── Print ────────────────────────────────────────────────────────────────────

printBtn.addEventListener("click", async () => {
  if (!serial.isConnected()) {
    showToast("Please connect to the printer first.", "error");
    return;
  }

  printBtn.disabled = true;
  printBtn.textContent = "⏳ Printing…";

  try {
    renderLabel(); // ensure latest render

    const settings = {
      tapeMm: selectedTapeMm(),
      halfCut: halfCutInput.checked,
      chain: chainInput.checked,
      copies: clampCopies(parseInt(copiesInput.value, 10)),
    };

    const buffer = buildPrintJob(renderCanvas, settings);
    log(
      "info",
      `Sending print job: ${buffer.length} bytes, ${settings.copies} cop${settings.copies === 1 ? "y" : "ies"}, tape ${settings.tapeMm}mm`,
    );

    // Hex dump: first 64 bytes help verify the command sequence
    const hexDump = Array.from(buffer.slice(0, 64))
      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
      .reduce((acc, h, i) => acc + h + (i % 16 === 15 ? "\n" : " "), "");
    log("info", `Job header (first 64 bytes):\n${hexDump.trimEnd()}`);

    await serial.sendData(buffer);

    showToast("Print job sent ✓", "success");
    log("ok", "Print job sent.");
    printBtn.textContent = "🖨 Print Label";
  } catch (err) {
    console.error("Print failed:", err);
    log("error", "Print failed:", err.message);
    showToast(`Print error: ${err.message}`, "error");
    printBtn.textContent = "🖨 Print Label";
  } finally {
    printBtn.disabled = false;
  }
});

// ─── Query tape info ──────────────────────────────────────────────────────────

queryBtn.addEventListener("click", async () => {
  if (!serial.isConnected()) {
    showToast("Please connect to the printer first.", "error");
    return;
  }

  queryBtn.disabled = true;
  try {
    log("info", "Sending status request (ESC i S)…");
    await serial.sendData(buildStatusRequest());
    // Pass 0x80 as headerByte so the reader skips any stale bytes in the
    // receive buffer and syncs to the actual start of the status response.
    const response = await serial.readResponse(32, 3000, 0x80);

    const hex = Array.from(response)
      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
      .reduce((acc, h, i) => acc + h + (i % 16 === 15 ? "\n" : " "), "")
      .trimEnd();
    log("info", `Status response (32 bytes):\n${hex}`);

    const info = parseStatusResponse(response);
    if (!info) {
      log("warn", "Invalid status response — unexpected header bytes.");
      showToast("Invalid status response", "error");
      return;
    }

    const errStr = info.errors ? ` ⚠ ${info.errors.join(", ")}` : "";
    const label = `${info.tapeWidthMm} mm • ${info.mediaType} • ${info.tapeColor}${errStr}`;
    tapeInfoEl.textContent = label;
    tapeInfoEl.className = info.errors
      ? "text-xs text-yellow-400 truncate"
      : "text-xs text-green-400 truncate";
    log("ok", `Tape info: ${label}`);
    showToast(`Tape: ${label}`, "success");

    // Auto-select matching tape width pill if present in TAPE_CONFIG
    if (info.tapeWidthMm && TAPE_CONFIG[info.tapeWidthMm]) {
      for (const pill of tapePills) {
        if (parseInt(pill.value, 10) === info.tapeWidthMm) {
          pill.checked = true;
          scheduleRender();
          break;
        }
      }
    }
  } catch (err) {
    log("error", "Query failed:", err.message);
    showToast(`Query error: ${err.message}`, "error");
  } finally {
    queryBtn.disabled = false;
  }
});

// ─── Cut (feed + full cut without printing) ───────────────────────────────────

cutBtn.addEventListener("click", async () => {
  if (!serial.isConnected()) {
    showToast("Please connect to the printer first.", "error");
    return;
  }

  cutBtn.disabled = true;
  try {
    const tapeMm = parseInt(
      document.querySelector('input[name="tape-size"]:checked')?.value ?? "24",
      10,
    );
    log("info", `Sending cut command (${tapeMm} mm tape)…`);
    await serial.sendData(buildCutJob(tapeMm));
    showToast("Tape cut ✓", "success");
    log("ok", "Cut sent.");
  } catch (err) {
    log("error", "Cut failed:", err.message);
    showToast(`Cut error: ${err.message}`, "error");
  } finally {
    cutBtn.disabled = false;
  }
});

// ─── Toast notifications ─────────────────────────────────────────────────────

let toastTimeout = 0;

function showToast(message, type = "info") {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className =
      "fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl " +
      "text-sm font-medium shadow-xl transition-all duration-300 z-50";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = toast.className.replace(
    /bg-\S+/g,
    type === "success"
      ? "bg-green-700"
      : type === "error"
        ? "bg-red-700"
        : "bg-zinc-700",
  );
  // ensure base classes survive the replace
  if (!toast.className.includes("bg-")) {
    toast.className +=
      type === "success"
        ? " bg-green-700"
        : type === "error"
          ? " bg-red-700"
          : " bg-zinc-700";
  }
  toast.style.opacity = "1";

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.opacity = "0";
  }, 3000);
}

// ─── Initialise ──────────────────────────────────────────────────────────────

renderLabel();
