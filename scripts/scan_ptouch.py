#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "bleak>=0.22",
# ]
# ///
"""
scan_ptouch.py — Sucht nach Brother P-Touch Druckern via BLE.

Verwendung:
    uv run scripts/scan_ptouch.py
    uv run scripts/scan_ptouch.py --timeout 15
    uv run scripts/scan_ptouch.py --all           # zeigt alle BLE-Geräte
    uv run scripts/scan_ptouch.py --adapter hci1  # expliziter Adapter

Das Script:
  1. Erkennt automatisch den richtigen BT-Adapter (hci0/hci1/…).
  2. Scannt `--timeout` Sekunden nach BLE-Geräten.
  3. Filtert Geräte mit Name-Prefix "PT-" (wie die Web-App).
  4. Versucht für gefundene P-Touch-Geräte die GATT-Services auszulesen.
"""

import asyncio
import argparse
import glob
import os
import sys
from bleak import BleakScanner, BleakClient
from bleak.exc import BleakError

PT_SERVICE_UUID  = "0000ff00-0000-1000-8000-00805f9b34fb"
PT_WRITE_CHAR    = "0000ff01-0000-1000-8000-00805f9b34fb"
SPP_UUID         = "00001101-0000-1000-8000-00805f9b34fb"  # Classic BT Serial Port


def detect_adapter() -> str | None:
    """Gibt den Namen des ersten verfügbaren hci-Adapters zurück (z.B. 'hci1')."""
    adapters = sorted(glob.glob("/sys/class/bluetooth/hci*"))
    if adapters:
        return os.path.basename(adapters[0])
    return None


async def scan(timeout: float, show_all: bool, adapter: str | None) -> None:
    # Adapter automatisch ermitteln wenn nicht angegeben
    if adapter is None:
        adapter = detect_adapter()
        if adapter:
            print(f"ℹ️   Verwende BT-Adapter: {adapter} (auto-erkannt)")
        else:
            print("⚠️  Kein BT-Adapter unter /sys/class/bluetooth/ gefunden.")

    print(f"Scanne {timeout:.0f}s nach BLE-Geräten …\n")

    scanner_kwargs = {}
    if adapter:
        scanner_kwargs["adapter"] = adapter

    devices = await BleakScanner.discover(timeout=timeout, return_adv=True, **scanner_kwargs)

    if not devices:
        print("❌  Keine BLE-Geräte gefunden.")
        print("    Tipps:")
        print("    • Bluetooth aktiviert? (bluetoothctl power on)")
        print("    • Drucker eingeschaltet und im Pairing-Modus?")
        print("    • Benutzer in Gruppe 'bluetooth'? (groups $USER)")
        return

    pt_devices = {
        addr: (dev, adv)
        for addr, (dev, adv) in devices.items()
        if dev.name and dev.name.upper().startswith("PT-")
    }

    if show_all:
        print(f"{'Alle gefundenen Geräte':─<60}")
        for addr, (dev, adv) in sorted(devices.items(), key=lambda x: x[1][1].rssi or -99, reverse=True):
            name = dev.name or "(unbekannt)"
            rssi = adv.rssi if adv.rssi is not None else "?"
            marker = " ◄ P-Touch" if addr in pt_devices else ""
            print(f"  {rssi:>4} dBm  {addr}  {name}{marker}")
        print()

    if not pt_devices:
        print("❌  Kein P-Touch Gerät (Prefix 'PT-') gefunden.")
        if not show_all:
            print(f"    Insgesamt {len(devices)} BLE-Gerät(e) sichtbar.")
            print("    Starte mit --all um alle Geräte anzuzeigen.")
        return

    print(f"✅  {len(pt_devices)} P-Touch Gerät(e) gefunden:\n")
    for addr, (dev, adv) in pt_devices.items():
        rssi = adv.rssi if adv.rssi is not None else "?"
        print(f"  Name    : {dev.name}")
        print(f"  Adresse : {addr}")
        print(f"  RSSI    : {rssi} dBm")
        # Herstellerdaten aus Advertisement
        if adv.manufacturer_data:
            for company_id, data in adv.manufacturer_data.items():
                print(f"  Hersteller-ID 0x{company_id:04X}: {data.hex()}")
        # Service-UUIDs aus Advertisement
        if adv.service_uuids:
            print(f"  Advertised Services:")
            for uuid in adv.service_uuids:
                marker = " ← P-Touch Drucker-Service ✓" if uuid.lower() == PT_SERVICE_UUID else ""
                if uuid.lower() == SPP_UUID:
                    marker = " ← Classic BT Serial Port (SPP) ⚠️  kein BLE!"
                print(f"    {uuid}{marker}")

        print()
        await probe_gatt(addr, dev.name)
        print()


async def probe_gatt(address: str, name: str) -> None:
    """Verbindet kurz und liest GATT-Services aus."""
    print(f"  Verbinde mit {name} ({address}) …")
    try:
        async with BleakClient(address, timeout=10.0) as client:
            print(f"  Verbunden ✓  (MTU {client.mtu_size} Bytes)")
            found_service   = False
            found_write_char = False
            for service in client.services:
                is_pt = service.uuid.lower() == PT_SERVICE_UUID
                marker = " ← Drucker-Service ✓" if is_pt else ""
                print(f"    Service: {service.uuid}{marker}")
                if is_pt:
                    found_service = True
                for char in service.characteristics:
                    is_wc = char.uuid.lower() == PT_WRITE_CHAR
                    wm = " ← Write-Characteristic ✓" if is_wc else ""
                    print(f"      Char: {char.uuid}  [{', '.join(char.properties)}]{wm}")
                    if is_wc:
                        found_write_char = True

            if found_service and found_write_char:
                print("\n  ✅  Alle benötigten UUIDs vorhanden – Gerät sollte funktionieren.")
            elif found_service:
                print("\n  ⚠️  Drucker-Service gefunden, aber Write-Characteristic fehlt.")
            else:
                # Prüfen ob SPP-Dienst vorhanden (Classic BT)
                spp_found = any(
                    s.uuid.lower() == SPP_UUID for s in client.services
                )
                if spp_found:
                    print(f"\n  ❌  Gerät nutzt Classic Bluetooth SPP ({SPP_UUID}).")
                    print("      Web Bluetooth (Browser) unterstützt NUR BLE,")
                    print("      NICHT Classic BT / SPP.")
                    print("      → Die Web-App kann diesen Drucker nicht direkt ansprechen.")
                    print("      → Alternative: rfcomm / SerialPort-Bridge oder nativer Treiber.")
                else:
                    print(f"\n  ⚠️  Service {PT_SERVICE_UUID} nicht gefunden.")
                    print("      Das Gerät könnte trotzdem ein P-Touch sein (Service erst nach Pairing sichtbar).")

    except BleakError as exc:
        print(f"  ⚠️  GATT-Verbindung fehlgeschlagen: {exc}")
        print("      Mögliche Ursachen: Gerät bereits verbunden, Pairing erforderlich,")
        print("      oder fehlende Berechtigungen (sudo / bluetooth-Gruppe).")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sucht nach Brother P-Touch Druckern via BLE.",
    )
    parser.add_argument(
        "--timeout", type=float, default=10.0,
        help="Scan-Dauer in Sekunden (Standard: 10)",
    )
    parser.add_argument(
        "--all", dest="show_all", action="store_true",
        help="Alle BLE-Geräte anzeigen, nicht nur P-Touch",
    )
    parser.add_argument(
        "--adapter", type=str, default=None,
        help="BT-Adapter explizit angeben, z.B. hci1 (Standard: auto)",
    )
    args = parser.parse_args()

    try:
        asyncio.run(scan(args.timeout, args.show_all, args.adapter))
    except KeyboardInterrupt:
        print("\nAbgebrochen.")
        sys.exit(0)
    except BleakError as exc:
        print(f"\n❌  Bluetooth-Fehler: {exc}", file=sys.stderr)
        print("    Ist der Bluetooth-Daemon aktiv? (systemctl status bluetooth)", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
