# ptouch-webapp

A modern, client-side Single-Page Application (SPA) for designing and printing
labels on a **Brother PT-E560BTVP** (and compatible TZe-tape PT-E/PT-P series
printers) via **Web Bluetooth**.

Built with **Vite 8**, **Tailwind CSS v4**, and vanilla **ES2022+ JavaScript**.
No backend required — everything runs entirely in the browser.

---

## Features

| Feature | Details |
|---|---|
| 🔵 Web Bluetooth | Connects directly to the printer from Chrome / Edge |
| 🖨 Brother Raster Protocol | Full ESC/P command set for PT-E series |
| ✂ Half-Cut | `ESC i K 0x08` between labels for easy tear-off |
| 🔗 Chain Printing | `ESC i M 0x08` to minimise tape waste |
| 🔢 Copies | Print N copies with a single button press |
| 👁 Live Preview | Real-time canvas preview updates as you type |
| 📐 Multi-width tapes | Supports 12 mm, 18 mm, and 24 mm TZe tapes |
| 📱 Mobile-first UI | Responsive dark-mode interface |

---

## Browser Requirements

Web Bluetooth is a **privileged API** with strict requirements:

| Requirement | Notes |
|---|---|
| **HTTPS or `localhost`** | Plain HTTP origins will have `navigator.bluetooth` undefined |
| **Chromium-based browser** | Chrome 90+ or Edge 90+ on Windows, macOS, Android, or ChromeOS |
| **User Activation** | `bluetooth.requestDevice()` must be called from a user gesture (click) |
| **Bluetooth enabled** | System Bluetooth must be on and the OS must grant the browser access |

> Firefox and Safari do **not** currently support Web Bluetooth.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- npm 10+

### Install & Run

```bash
# Clone the repository
git clone https://github.com/the78mole/ptouch-webapp.git
cd ptouch-webapp

# Install dependencies
npm install

# Start development server (served on http://localhost:5173)
npm run dev
```

The dev server runs on `localhost`, which satisfies the HTTPS requirement for
Web Bluetooth.

### Production Build

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

For deployment, host the `dist/` folder on any HTTPS-capable static host
(GitHub Pages, Netlify, Vercel, Cloudflare Pages, etc.).

---

## Project Structure

```
ptouch-webapp/
├── index.html          # App shell; Tailwind v4 entry point
├── vite.config.js      # Vite 8 + @tailwindcss/vite plugin
├── package.json
└── src/
    ├── style.css       # @import "tailwindcss" + custom CSS
    ├── bluetooth.js    # Web Bluetooth connection & chunked writes
    ├── protocol.js     # Brother raster commands & canvas rasterization
    └── app.js          # UI event wiring & canvas rendering
```

---

## Bluetooth Module (`src/bluetooth.js`)

| Property | Value |
|---|---|
| Service UUID | `0000ff00-0000-1000-8000-00805f9b34fb` |
| Write Characteristic | `0000ff01-0000-1000-8000-00805f9b34fb` |
| Chunk Size | 512 bytes (write-without-response) |
| Reconnection | Exponential back-off (3 s → 6 s → … → 30 s max) |

```js
import { BluetoothManager } from './src/bluetooth.js';

const bt = new BluetoothManager();
bt.onStatusChange = (status) => console.log(status);

// Must be called inside a user-gesture handler:
await bt.connect();
await bt.sendData(myUint8Array);
await bt.disconnect();
```

---

## Protocol Module (`src/protocol.js`)

### Tape Configuration

| Width | Printable Dots | Bytes / Line |
|---|---|---|
| 24 mm | 128 | 16 |
| 18 mm | 96 | 12 |
| 12 mm | 64 | 8 |

### Print Job Pipeline

```
buildInvalidation()          100 × 0x00   — reset printer
buildRasterMode()            1B 69 61 01  — enter raster mode
  ┌─ per copy ────────────────────────────────────────────────┐
  │ buildMediaCommand(mm, lines)  1B 69 7A …  — media info    │
  │ buildCutCommand(halfCut)      1B 69 4B …  — cut mode      │
  │ buildModeCommand(chain)       1B 69 4D …  — print mode    │
  │ buildCompressionCommand()     1B 69 41 00 — no compression│
  │ buildMarginCommand(dots)      1B 69 64 …  — feed margin   │
  │ buildRasterLine(data)         47 lo hi …  — raster line   │
  │ buildEmptyLine()              5A          — blank line     │
  │ buildPrint() / buildEject()   0C / 1A     — print / cut   │
  └───────────────────────────────────────────────────────────┘
buildFinalizeJob()           1A           — eject after chain
```

### Canvas → Raster Conversion

```
canvas.width  = label length (dots = number of raster lines)
canvas.height = tape dots    (e.g., 128 for 24 mm)

For each canvas column x → one raster line:
  For each row y → one bit, packed MSB-first into bytes
  Luminance threshold: brightness < 128 → print dot
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `navigator.bluetooth` is undefined | Not HTTPS / unsupported browser | Use localhost in dev, deploy to HTTPS |
| Device not found in picker | Wrong name prefix | Ensure printer name starts with `PT-`; check it is advertising |
| Print garbled / no output | Wrong tape width selected | Match the tape actually loaded in the printer |
| BLE write errors | Packet too large | Reduce CHUNK_SIZE in `bluetooth.js` |

---

## License

MIT — see [LICENSE](LICENSE).
