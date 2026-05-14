/**
 * app.js — Label Designer UI Controller
 *
 * Wires DOM events to the Bluetooth and Protocol modules.
 * Manages the live-preview canvas and print orchestration.
 */

import './style.css';
import { BluetoothManager }               from './bluetooth.js';
import { buildPrintJob, buildFinalizeJob,
         TAPE_CONFIG, PRINT_DPI }          from './protocol.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Extra horizontal dot padding added to each side of the measured text width */
const LABEL_H_PADDING_DOTS = 20;

/** Minimum label width in dots regardless of text length */
const LABEL_MIN_WIDTH_DOTS = 40;

// ─── Bluetooth manager ───────────────────────────────────────────────────────

const bt = new BluetoothManager();

// ─── DOM refs ────────────────────────────────────────────────────────────────

const connectBtn    = /** @type {HTMLButtonElement}  */ (document.getElementById('connect-btn'));
const statusDot     = /** @type {HTMLSpanElement}    */ (document.getElementById('status-dot'));
const statusText    = /** @type {HTMLSpanElement}    */ (document.getElementById('status-text'));

const labelTextarea = /** @type {HTMLTextAreaElement}*/ (document.getElementById('label-text'));
const fontSizeInput = /** @type {HTMLInputElement}   */ (document.getElementById('font-size'));
const fontSizeLabel = /** @type {HTMLSpanElement}    */ (document.getElementById('font-size-value'));
const boldToggle    = /** @type {HTMLInputElement}   */ (document.getElementById('bold-toggle'));

const tapePills     = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="tape-size"]'));

const halfCutInput  = /** @type {HTMLInputElement}   */ (document.getElementById('half-cut'));
const chainInput    = /** @type {HTMLInputElement}   */ (document.getElementById('chain-print'));
const copiesMinus   = /** @type {HTMLButtonElement}  */ (document.getElementById('copies-dec'));
const copiesPlus    = /** @type {HTMLButtonElement}  */ (document.getElementById('copies-inc'));
const copiesInput   = /** @type {HTMLInputElement}   */ (document.getElementById('copies'));

const printBtn      = /** @type {HTMLButtonElement}  */ (document.getElementById('print-btn'));
const finalizeBtn   = /** @type {HTMLButtonElement}  */ (document.getElementById('finalize-btn'));

const previewCanvas = /** @type {HTMLCanvasElement}  */ (document.getElementById('preview-canvas'));
const renderCanvas  = /** @type {HTMLCanvasElement}  */ (document.getElementById('render-canvas'));

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

// ─── Bluetooth status ────────────────────────────────────────────────────────

bt.onStatusChange = (status) => {
  switch (status) {
    case 'connected':
      statusDot.className   = 'status-dot bg-green-500';
      statusText.textContent = bt.deviceName ? `${bt.deviceName}` : 'Connected';
      connectBtn.textContent = 'Disconnect';
      connectBtn.classList.replace('bg-blue-600', 'bg-red-600');
      connectBtn.classList.replace('hover:bg-blue-700', 'hover:bg-red-700');
      printBtn.disabled    = false;
      finalizeBtn.disabled = false;
      break;

    case 'reconnecting':
      statusDot.className   = 'status-dot bg-yellow-500 animate-pulse';
      statusText.textContent = 'Reconnecting…';
      printBtn.disabled    = true;
      finalizeBtn.disabled = true;
      break;

    case 'disconnected':
    default:
      statusDot.className   = 'status-dot bg-red-500';
      statusText.textContent = 'Disconnected';
      connectBtn.textContent = 'Connect Printer';
      connectBtn.classList.replace('bg-red-600', 'bg-blue-600');
      connectBtn.classList.replace('hover:bg-red-700', 'hover:bg-blue-700');
      printBtn.disabled    = true;
      finalizeBtn.disabled = true;
      break;
  }
};

// ─── Connect / disconnect ────────────────────────────────────────────────────

connectBtn.addEventListener('click', async () => {
  if (bt.isConnected()) {
    await bt.disconnect();
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  try {
    await bt.connect();
  } catch (err) {
    console.error('Connection failed:', err);
    showToast(`Connection failed: ${err.message}`, 'error');
    bt.onStatusChange?.('disconnected');
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

function renderLabel() {
  const tapeMm = selectedTapeMm();
  const cfg    = TAPE_CONFIG[tapeMm] ?? TAPE_CONFIG[24];
  const tapeDots = cfg.dots;

  const text     = labelTextarea.value || 'Label Text';
  const fontSize = Math.max(8, parseInt(fontSizeInput.value, 10));
  const isBold   = boldToggle.checked;
  const fontSpec = `${isBold ? 'bold ' : ''}${fontSize}px sans-serif`;

  // ── Measure text to determine canvas width ──
  const probe = document.createElement('canvas').getContext('2d');
  probe.font  = fontSpec;
  const lines = text.split('\n');
  const lineHeight = Math.ceil(fontSize * 1.25);
  const textW  = Math.max(...lines.map(l => Math.ceil(probe.measureText(l).width)));
  const labelW = Math.max(textW + LABEL_H_PADDING_DOTS, LABEL_MIN_WIDTH_DOTS);
  const labelH = tapeDots;

  // ── Draw on the hidden render canvas ──
  renderCanvas.width  = labelW;
  renderCanvas.height = labelH;

  const ctx = renderCanvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, labelW, labelH);

  // Black text, centred
  ctx.font         = fontSpec;
  ctx.fillStyle    = '#000000';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  const totalTextH = lines.length * lineHeight;
  const startY     = (labelH - totalTextH) / 2 + lineHeight / 2;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], labelW / 2, startY + i * lineHeight);
  }

  updatePreview();
}

function updatePreview() {
  const container   = previewCanvas.parentElement;
  const maxW        = container.clientWidth  - 16; // subtract padding
  const maxH        = Math.min(160, container.clientHeight - 16);

  if (maxW <= 0 || maxH <= 0) return;

  const scale = Math.min(maxW / renderCanvas.width, maxH / renderCanvas.height, 4);

  previewCanvas.width  = Math.max(1, Math.round(renderCanvas.width  * scale));
  previewCanvas.height = Math.max(1, Math.round(renderCanvas.height * scale));

  const pCtx = previewCanvas.getContext('2d');
  pCtx.imageSmoothingEnabled = false;
  pCtx.drawImage(renderCanvas, 0, 0, previewCanvas.width, previewCanvas.height);

  // Resize the tape outline wrapper to match
  const tape = /** @type {HTMLElement} */ (document.getElementById('preview-tape'));
  tape.style.aspectRatio = `${renderCanvas.width} / ${renderCanvas.height}`;
}

// ─── UI event listeners ───────────────────────────────────────────────────────

labelTextarea.addEventListener('input',  scheduleRender);

fontSizeInput.addEventListener('input', () => {
  fontSizeLabel.textContent = `${fontSizeInput.value}px`;
  scheduleRender();
});

boldToggle.addEventListener('change', scheduleRender);

for (const pill of tapePills) {
  pill.addEventListener('change', scheduleRender);
}

copiesMinus.addEventListener('click', () => {
  copiesInput.value = String(clampCopies(parseInt(copiesInput.value, 10) - 1));
});

copiesPlus.addEventListener('click', () => {
  copiesInput.value = String(clampCopies(parseInt(copiesInput.value, 10) + 1));
});

copiesInput.addEventListener('change', () => {
  copiesInput.value = String(clampCopies(parseInt(copiesInput.value, 10) || 1));
});

// Redraw preview on window resize so scaling stays correct
const resizeObserver = new ResizeObserver(scheduleRender);
resizeObserver.observe(previewCanvas.parentElement);

// ─── Print ────────────────────────────────────────────────────────────────────

printBtn.addEventListener('click', async () => {
  if (!bt.isConnected()) {
    showToast('Please connect to the printer first.', 'error');
    return;
  }

  printBtn.disabled  = true;
  printBtn.textContent = '⏳ Printing…';

  try {
    renderLabel(); // ensure latest render

    const settings = {
      tapeMm:  selectedTapeMm(),
      halfCut: halfCutInput.checked,
      chain:   chainInput.checked,
      copies:  clampCopies(parseInt(copiesInput.value, 10)),
    };

    const buffer = buildPrintJob(renderCanvas, settings);
    await bt.sendData(buffer);

    showToast('Print job sent ✓', 'success');
    printBtn.textContent = '🖨 Print Label';
  } catch (err) {
    console.error('Print failed:', err);
    showToast(`Print error: ${err.message}`, 'error');
    printBtn.textContent = '🖨 Print Label';
  } finally {
    printBtn.disabled = false;
  }
});

// ─── Finalize series ─────────────────────────────────────────────────────────

finalizeBtn.addEventListener('click', async () => {
  if (!bt.isConnected()) {
    showToast('Please connect to the printer first.', 'error');
    return;
  }

  finalizeBtn.disabled = true;
  try {
    await bt.sendData(buildFinalizeJob());
    showToast('Series finalised — tape ejected ✓', 'success');
  } catch (err) {
    console.error('Finalize failed:', err);
    showToast(`Finalize error: ${err.message}`, 'error');
  } finally {
    finalizeBtn.disabled = false;
  }
});

// ─── Toast notifications ─────────────────────────────────────────────────────

let toastTimeout = 0;

function showToast(message, type = 'info') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className =
      'fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl ' +
      'text-sm font-medium shadow-xl transition-all duration-300 z-50';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = toast.className.replace(
    /bg-\S+/g,
    type === 'success' ? 'bg-green-700' :
    type === 'error'   ? 'bg-red-700'   : 'bg-zinc-700',
  );
  // ensure base classes survive the replace
  if (!toast.className.includes('bg-')) {
    toast.className += type === 'success' ? ' bg-green-700' :
                       type === 'error'   ? ' bg-red-700'   : ' bg-zinc-700';
  }
  toast.style.opacity = '1';

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// ─── Initialise ──────────────────────────────────────────────────────────────

renderLabel();
