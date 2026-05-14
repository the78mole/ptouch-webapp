# ptouch-webapp

A modern, client-side Single-Page Application (SPA) for designing and printing
labels on a **Brother PT-E560BTVP** (and compatible TZe-tape PT-E/PT-P series
printers) via **Web Serial**.

Works over both **USB** (direct connection) and **Bluetooth Classic (SPP)** via
the operating system's virtual COM port — no driver installation required on
modern operating systems.

Built with **Vite 8**, **Tailwind CSS v4**, and vanilla **ES2022+ JavaScript**.
No backend required — everything runs entirely in the browser.

> **Why Web Serial instead of Web Bluetooth?**
> The PT-E560BT uses Bluetooth Classic (SPP profile), not Bluetooth Low Energy
> (BLE). Web Bluetooth only supports BLE, making it incompatible with this
> device. Web Serial works because both USB and paired Bluetooth SPP connections
> are exposed by the OS as standard virtual serial ports.

---

## Features

| Feature                    | Details                                         |
| -------------------------- | ----------------------------------------------- |
| 🔌 Web Serial              | Connects via USB or paired Bluetooth COM port   |
| 🖨 Brother Raster Protocol | Full ESC/P command set for PT-E series          |
| ✂ Half-Cut                 | `ESC i K 0x08` between labels for easy tear-off |
| 🔗 Chain Printing          | `ESC i M 0x08` to minimise tape waste           |
| 🔢 Copies                  | Print N copies with a single button press       |
| 👁 Live Preview            | Real-time canvas preview updates as you type    |
| 📐 Multi-width tapes       | Supports 12 mm, 18 mm, and 24 mm TZe tapes      |
| 📱 Mobile-first UI         | Responsive dark-mode interface                  |

---

## Browser Requirements

Web Serial is a **privileged API** with strict requirements:

| Requirement                | Notes                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| **HTTPS or `localhost`**   | Plain HTTP origins will have `navigator.serial` undefined                |
| **Chromium-based browser** | Chrome 89+, Edge 89+, or Opera 75+ on Windows, macOS, Linux, or ChromeOS |
| **User Activation**        | `serial.requestPort()` must be called from a user gesture (click)        |

> **Firefox and Safari do not support Web Serial.** Use Chrome, Edge, or Opera.

---

## How to Connect

### USB Connection

1. Plug the printer into a USB port on your computer.
2. Open the web app and click **Connect Printer**.
3. A browser dialog lists all available serial/USB devices. Select the entry
   for the Brother printer (it may appear as _USB Serial Device_, _USB VID:PID_,
   or similar, depending on the OS).
4. Click **Connect** in the dialog. The status indicator turns green.

### Bluetooth — Windows / macOS

Bluetooth Classic (SPP) creates a virtual COM port through the OS. The browser
then treats it like any other serial port.

1. **Pair the printer first:** Open the system Bluetooth settings, scan for
   devices, and pair with `PT-E560BT_xxxx`. Accept any PIN prompt (default
   PIN is usually `0000`).
2. After pairing, a virtual COM port is automatically created
   (e.g., `COM5` on Windows, `/dev/cu.PT-E560BT_xxxx-SerialPort` on macOS).
3. Open the web app and click **Connect Printer**.
4. Select the COM port that corresponds to the printer in the browser dialog.

### Bluetooth & USB — Linux

#### Serial Port Permissions

By default, serial/USB devices on Linux are owned by the `dialout` group.
Without membership in that group the browser will either fail silently or the
port will not appear in the picker.

```bash
# Add your user to the dialout group (Debian, Ubuntu, Mint, Fedora, …)
sudo usermod -a -G dialout $USER

# On Arch-based distros (Manjaro, EndeavourOS, …) use uucp instead:
sudo usermod -a -G uucp $USER
```

> **A logout/login (or full reboot) is required for the group change to take
> effect.** Verify with `groups $USER` — `dialout` (or `uucp`) must appear.

#### USB on Linux

Once in the `dialout` group, plug in the printer. It will appear as
`/dev/ttyUSB0` or `/dev/ttyACM0`. Click **Connect Printer** in the app and
select that device from the port picker.

#### Bluetooth on Linux

The OS does not create a virtual serial port for Bluetooth devices
automatically. You need to bind the printer to an `rfcomm` device first.

**Step 1 — Pair the printer:**

```bash
bluetoothctl
# Inside the interactive shell:
power on
scan on
# Wait until PT-E560BT_xxxx appears, note the MAC address, then:
pair   94:DD:F8:A1:35:80   # replace with your printer's MAC address
trust  94:DD:F8:A1:35:80
quit
```

**Step 2 — Bind to an rfcomm device:**

```bash
sudo rfcomm bind 0 94:DD:F8:A1:35:80
# Creates /dev/rfcomm0
```

To make this persistent across reboots, add it to `/etc/rc.local` or create a
small systemd service.

**Step 3 —** Open the web app, click **Connect Printer**, and select
`/dev/rfcomm0` in the port picker.

> **Troubleshooting — port picker is empty:**
>
> - Ensure `dialout` group membership is active (`groups $USER`).
> - Check whether `ModemManager` has claimed the port:
>   `sudo systemctl stop ModemManager`
> - Confirm the rfcomm binding exists: `ls -l /dev/rfcomm*`

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [npm](https://www.npmjs.com/) 10+

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
Web Serial.

### Production Build

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

For deployment, host the `dist/` folder on any HTTPS-capable static host
(GitHub Pages, Netlify, Vercel, Cloudflare Pages, etc.).

---

## Deployment — GitHub Pages

The app is automatically deployed to
**<https://the78mole.github.io/ptouch-webapp/>** via the
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) workflow.

### One-time repository setup

1. Go to **Settings → Pages** in the GitHub repository.
2. Under _Build and deployment / Source_, select **GitHub Actions** (not the
   legacy "Deploy from a branch" option).
3. Save. That's it — no `gh-pages` branch needed.

### Automated deployments

| Trigger        | Action                                              |
| -------------- | --------------------------------------------------- |
| Push to `main` | Build + deploy automatically                        |
| Manual         | **Actions → Deploy to GitHub Pages → Run workflow** |

The workflow uses three official GitHub Actions:

```text
actions/configure-pages        — reads Pages settings, injects base URL
actions/upload-pages-artifact  — packages dist/ as a Pages artifact
actions/deploy-pages           — publishes the artifact to GitHub Pages
```

Only one deployment runs at a time; a newer push automatically cancels any
in-progress run (`concurrency: group: pages, cancel-in-progress: true`).

---

## Project Structure

```text
ptouch-webapp/
├── index.html          # App shell; Tailwind v4 entry point
├── vite.config.js      # Vite 8 + @tailwindcss/vite plugin
├── package.json
├── scripts/
│   └── scan_ptouch.py  # BLE/BT diagnostic script (uv run)
└── src/
    ├── style.css       # @import "tailwindcss" + custom CSS
    ├── serial.js       # Web Serial connection & chunked writes
    ├── protocol.js     # Brother raster commands & canvas rasterization
    └── app.js          # UI event wiring & canvas rendering
```

---

## Serial Module (`src/serial.js`)

| Property          | Value                                                         |
| ----------------- | ------------------------------------------------------------- |
| Baud Rate         | 115200 (required by the API; ignored by USB/BT virtual ports) |
| Chunk Size        | 512 bytes                                                     |
| Inter-chunk delay | 10 ms                                                         |

```js
import { SerialManager } from "./src/serial.js";

const serial = new SerialManager();
serial.onStatusChange = (status) => console.log(status);

// Must be called inside a user-gesture handler:
await serial.connect();
await serial.sendData(myUint8Array);
await serial.disconnect();
```

---

## Protocol Module (`src/protocol.js`)

### Tape Configuration

Dot counts from the `libptouch` reference implementation (`tape_info[]`). The
print head is always 128 dots wide; narrower tapes are **centred** automatically.

| Width | Printable Dots | Offset (dots) | Bytes / Line |
| ----- | -------------- | ------------- | ------------ |
| 24 mm | 128            | 0             | 16           |
| 18 mm | 120            | 4             | 16           |
| 12 mm | 76             | 26            | 16           |
| 9 mm  | 52             | 38            | 16           |
| 6 mm  | 32             | 48            | 16           |

### Print Job Pipeline (PT-E560BT / D460BT)

```text
buildInvalidation()          100 × 0x00 + ESC @  — reset printer
  ┌─ per copy ─────────────────────────────────────────────────┐
  │ buildRasterMode()           1B 69 61 01  — raster mode     │
  │ buildMediaCommand(mm, n)    1B 69 7A …   — media info      │
  │   └─ n9 = 0x02 (required for D460BT/E560BT)               │
  │ buildD460btMagic()          1B 69 64 01 00 4D 00           │
  │ buildCutCommand(false)      1B 69 4B 00  — chain (if chain)│
  │ buildRasterLine(data)       47 lo hi …   — raster line     │
  │ buildEject()                1A           — always for D460BT│
  └────────────────────────────────────────────────────────────┘
```

### Canvas → Raster Conversion

```text
canvas.width  = label length (dots = number of raster lines)
canvas.height = tape dots    (e.g., 128 for 24 mm)

Bit packing (LSB-first, matches libptouch rasterline_setpixel):
  pixel     = offsetDots + (tapeDots - 1 - dot)   ← centred, Y-flipped
  byteIndex = (15) - floor(pixel / 8)             ← reverse-indexed
  bitIndex  = pixel & 7                           ← LSB-first
  line[byteIndex] |= 1 << bitIndex
```

---

## Troubleshooting

| Symptom                          | Likely Cause                              | Fix                                                                   |
| -------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `navigator.serial` is undefined  | Not HTTPS / unsupported browser           | Use localhost in dev, deploy to HTTPS; use Chrome/Edge/Opera          |
| Port picker is empty             | No serial port permission                 | `sudo usermod -a -G dialout $USER`, then re-login                     |
| Port picker is empty (BT, Linux) | rfcomm not bound                          | `sudo rfcomm bind 0 <MAC>` first                                      |
| Port picker is empty (BT)        | Printer not paired via OS                 | Pair through OS Bluetooth settings before opening the app             |
| Port claimed by ModemManager     | ModemManager auto-connects serial devices | `sudo systemctl stop ModemManager`                                    |
| Print garbled / no output        | Wrong tape width selected                 | Match the tape actually loaded in the printer                         |
| Write errors during print        | Buffer overflow                           | Reduce `CHUNK_SIZE` or increase `INTER_CHUNK_DELAY_MS` in `serial.js` |

---

## License

MIT — see [LICENSE](LICENSE).
