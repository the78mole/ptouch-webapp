/**
 * serial.js — Web Serial connection manager for Brother PT-E560BTVP
 *
 * Handles port selection, opening, chunked writes, and clean teardown.
 * Works with both directly connected USB printers and Bluetooth Classic (SPP)
 * virtual COM ports that have been paired through the operating system.
 *
 * The Brother PT-E560BT uses Classic Bluetooth (SPP), not BLE, making
 * Web Bluetooth incompatible. Web Serial works with both transport types
 * because the OS exposes them as standard virtual serial ports.
 */

/** Maximum bytes per single write call to avoid receiver buffer overflow */
const CHUNK_SIZE = 512;

/** Delay (ms) between consecutive chunks */
const INTER_CHUNK_DELAY_MS = 10;

export class SerialManager {
  #port = null;
  #writer = null;
  #log = null;

  /** @type {((status: 'connected'|'disconnected') => void)|null} */
  onStatusChange = null;

  /** Returns true when the port is open and the writer is ready. */
  isConnected() {
    return this.#port !== null && this.#writer !== null;
  }

  /**
   * Human-readable port description derived from USB metadata.
   * Returns a VID:PID string for USB devices, or 'Serial Port' for
   * Bluetooth COM ports (which carry no USB identifiers).
   *
   * @returns {string|null}
   */
  get deviceName() {
    if (!this.#port) return null;
    const { usbVendorId, usbProductId } = this.#port.getInfo();
    if (usbVendorId != null) {
      const vid = usbVendorId.toString(16).toUpperCase().padStart(4, "0");
      const pid = usbProductId.toString(16).toUpperCase().padStart(4, "0");
      return `USB ${vid}:${pid}`;
    }
    return "Serial Port";
  }

  /**
   * Prompt the user to select a serial port, then open it.
   *
   * Shows ALL available ports (USB and virtual COM / rfcomm) so the user
   * can pick whichever transport they are using.
   *
   * MUST be called from a user-activation context (click handler etc.)
   * because Web Serial requires a transient user gesture.
   *
   * @returns {Promise<string>} Resolves with a port description on success.
   * @throws If Web Serial is unavailable or the user cancels the picker.
   */
  async connect() {
    if (!navigator.serial) {
      throw new Error(
        "Web Serial API is not supported in this browser. " +
          "Use Chrome 89+, Edge 89+, or Opera 75+ over HTTPS or localhost.",
      );
    }

    // No filters — show all ports so the user can pick USB or BT COM port.
    this.#port = await navigator.serial.requestPort();

    // Log port metadata before attempting to open.
    const info = this.#port.getInfo();
    const portDesc =
      info.usbVendorId != null
        ? `USB ${info.usbVendorId.toString(16).toUpperCase().padStart(4, "0")}:${info.usbProductId.toString(16).toUpperCase().padStart(4, "0")}`
        : "Serial/BT port (no USB metadata)";
    this.#log?.("info", `Port selected: ${portDesc}`);
    this.#log?.("info", "Opening port at 115200 baud…");

    try {
      await this.#port.open({ baudRate: 115200 });
    } catch (err) {
      this.#port = null;
      // Produce an actionable message depending on the error text.
      const msg = err.message ?? String(err);
      let hint = "";
      if (msg.includes("open serial port") || msg.includes("Failed to open")) {
        hint =
          " Possible causes: (1) Serial port permission denied — run " +
          "`sudo usermod -a -G dialout $USER` and re-login; " +
          "(2) Port in use by another app (ModemManager?) — try " +
          "`sudo systemctl stop ModemManager`; " +
          "(3) For Bluetooth: bind rfcomm first with " +
          "`sudo rfcomm bind 0 <MAC>`.";
      }
      throw new Error(msg + hint);
    }

    this.#writer = this.#port.writable.getWriter();
    this.#notifyStatus("connected");
    return portDesc;
  }

  /**
   * Attach an optional logger callback (receives level + ...args).
   * Called by app.js to forward messages to the UI log panel.
   *
   * @param {(level: string, ...args: string[]) => void} fn
   */
  setLogger(fn) {
    this.#log = fn;
  }

  /**
   * Release the writer lock and close the serial port.
   */
  async disconnect() {
    if (this.#writer) {
      this.#writer.releaseLock();
      this.#writer = null;
    }
    if (this.#port) {
      try {
        await this.#port.close();
      } catch {
        // Ignore errors from already-closed ports.
      }
      this.#port = null;
    }
    this.#notifyStatus("disconnected");
  }

  /**
   * Write a binary buffer to the serial port in CHUNK_SIZE-byte packets.
   * Automatically splits data and inserts inter-chunk delays.
   *
   * @param {Uint8Array|ArrayBuffer} buffer - Raw bytes to send.
   */
  async sendData(buffer) {
    if (!this.isConnected()) {
      throw new Error("Printer is not connected.");
    }

    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let offset = 0;

    try {
      while (offset < data.length) {
        const chunk = data.slice(offset, offset + CHUNK_SIZE);
        await this.#writer.write(chunk);
        offset += CHUNK_SIZE;
        if (offset < data.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, INTER_CHUNK_DELAY_MS),
          );
        }
      }
    } catch (err) {
      // Port closed unexpectedly — clean up state so isConnected() returns false.
      this.#writer.releaseLock();
      this.#writer = null;
      this.#port = null;
      this.#notifyStatus("disconnected");
      throw err;
    }
  }

  /**
   * Read a fixed number of bytes from the printer's response stream.
   *
   * If `headerByte` is provided the reader will discard incoming bytes until
   * it encounters a byte equal to `headerByte`, then collect `expectedBytes`
   * bytes starting from (and including) that header byte.  This makes the
   * method robust against stale bytes left in the receive buffer from a
   * previous command.
   *
   * @param {number} expectedBytes - number of bytes to collect
   * @param {number} [timeoutMs=3000] - max wait time in milliseconds
   * @param {number|null} [headerByte=null] - if set, skip until this byte
   * @returns {Promise<Uint8Array>}
   */
  async readResponse(expectedBytes, timeoutMs = 3000, headerByte = null) {
    if (!this.#port?.readable) {
      throw new Error("Port not readable — is the printer connected?");
    }

    const reader = this.#port.readable.getReader();
    const result = new Uint8Array(expectedBytes);
    let received = 0;
    let timedOut = false;
    let synced = headerByte === null; // if no header required, start collecting immediately

    const timer = setTimeout(() => {
      timedOut = true;
      reader.cancel();
    }, timeoutMs);

    try {
      outer: while (received < expectedBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.length) continue;

        for (let i = 0; i < value.length; i++) {
          const byte = value[i];

          if (!synced) {
            // Discard bytes until we see the expected header byte.
            if (byte === headerByte) {
              synced = true;
              result[received++] = byte;
            }
            continue;
          }

          result[received++] = byte;
          if (received >= expectedBytes) break outer;
        }
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }

    if (timedOut) {
      throw new Error(
        `Status query timed out after ${timeoutMs} ms — no response from printer`,
      );
    }
    if (received < expectedBytes) {
      throw new Error(
        `Incomplete response: expected ${expectedBytes} bytes, got ${received}`,
      );
    }

    return result;
  }

  // ─── Private helpers ──────────────────────────────────────────

  #notifyStatus(status) {
    this.onStatusChange?.(status);
  }
}
