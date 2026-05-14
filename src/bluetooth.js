/**
 * bluetooth.js — Web Bluetooth connection manager for Brother PT-E560BTVP
 *
 * Handles device discovery, GATT connection, automatic reconnection, and
 * MTU-limited chunked writes (≤512 bytes per write without response).
 */

const SERVICE_UUID   = '0000ff00-0000-1000-8000-00805f9b34fb';
const WRITE_CHAR_UUID = '0000ff01-0000-1000-8000-00805f9b34fb';

/** Maximum bytes per BLE write-without-response packet */
const CHUNK_SIZE = 512;

/** Delay (ms) between consecutive chunks to avoid receiver buffer overflow */
const INTER_CHUNK_DELAY_MS = 10;

/** Base delay (ms) before first reconnection attempt */
const RECONNECT_DELAY_MS = 3_000;

export class BluetoothManager {
  #device = null;
  #writeChar = null;
  #intentionalDisconnect = false;

  /** @type {((status: 'connected'|'reconnecting'|'disconnected') => void)|null} */
  onStatusChange = null;

  /** Returns true when the GATT server is actively connected. */
  isConnected() {
    return this.#device?.gatt?.connected ?? false;
  }

  /** @returns {string|null} Friendly device name, or null if not connected. */
  get deviceName() {
    return this.#device?.name ?? null;
  }

  /**
   * Prompt the user to select a Brother P-Touch printer via Web Bluetooth,
   * then establish a GATT connection.
   *
   * MUST be called from a user-activation context (click handler etc.) because
   * Web Bluetooth requires a transient user gesture.
   *
   * @returns {Promise<string>} Resolves with the device name on success.
   * @throws If Bluetooth is unavailable or the user cancels the picker.
   */
  async connect() {
    if (!navigator.bluetooth) {
      throw new Error(
        'Web Bluetooth API is not supported in this browser. ' +
        'Use Chrome/Edge over HTTPS or localhost.',
      );
    }

    this.#intentionalDisconnect = false;

    this.#device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'PT-' }],
      optionalServices: [SERVICE_UUID],
    });

    this.#device.addEventListener('gattserverdisconnected', () => {
      this.#onGattDisconnected();
    });

    await this.#connectGatt();
    return this.#device.name;
  }

  /**
   * Cleanly disconnect from the printer and suppress automatic reconnection.
   */
  async disconnect() {
    this.#intentionalDisconnect = true;
    if (this.#device?.gatt?.connected) {
      this.#device.gatt.disconnect();
    }
    this.#writeChar = null;
    this.#notifyStatus('disconnected');
  }

  /**
   * Write a binary buffer to the printer's write characteristic.
   * Automatically splits data into CHUNK_SIZE-byte packets.
   *
   * @param {Uint8Array|ArrayBuffer} buffer - Raw bytes to send.
   */
  async sendData(buffer) {
    if (!this.isConnected()) {
      throw new Error('Printer is not connected.');
    }

    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let offset = 0;

    while (offset < data.length) {
      const chunk = data.slice(offset, offset + CHUNK_SIZE);
      await this.#writeChar.writeValueWithoutResponse(chunk);
      offset += CHUNK_SIZE;
      if (offset < data.length) {
        await new Promise(resolve => setTimeout(resolve, INTER_CHUNK_DELAY_MS));
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────

  async #connectGatt() {
    const server  = await this.#device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.#writeChar = await service.getCharacteristic(WRITE_CHAR_UUID);
    this.#notifyStatus('connected');
  }

  #onGattDisconnected() {
    this.#writeChar = null;
    if (this.#intentionalDisconnect) {
      this.#notifyStatus('disconnected');
      return;
    }
    // Unexpected disconnect — attempt reconnection with back-off
    this.#notifyStatus('disconnected');
    this.#scheduleReconnect(RECONNECT_DELAY_MS);
  }

  #scheduleReconnect(delayMs) {
    if (!this.#device || this.#intentionalDisconnect) return;
    setTimeout(async () => {
      if (this.isConnected() || this.#intentionalDisconnect) return;
      this.#notifyStatus('reconnecting');
      try {
        await this.#connectGatt();
      } catch {
        // Back-off: double the delay, cap at 30 s
        this.#scheduleReconnect(Math.min(delayMs * 2, 30_000));
      }
    }, delayMs);
  }

  #notifyStatus(status) {
    this.onStatusChange?.(status);
  }
}
