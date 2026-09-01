#!/usr/bin/env python3
"""Build the Scripting App package with uncompressed UTF-8 ZIP entries."""

from __future__ import annotations

import binascii
import struct
from pathlib import Path


BASE = Path(__file__).resolve().parent
OUTPUT = BASE.parent / "water-bill-widget.scripting"
FILES = ("index.tsx", "widget.tsx", "water-api.ts", "boxjs.ts", "script.json")


def build_package() -> None:
    local_records = bytearray()
    central_records = bytearray()
    offset = 0
    dos_date = ((2020 - 1980) << 9) | (1 << 5) | 1
    dos_time = 0

    for filename in FILES:
        data = (BASE / filename).read_bytes()
        name = filename.encode("utf-8")
        crc = binascii.crc32(data) & 0xFFFFFFFF
        local_header = struct.pack(
            "<IHHHHHIIIHH", 0x04034B50, 20, 2048, 0, dos_time, dos_date,
            crc, len(data), len(data), len(name), 0,
        ) + name
        local_records.extend(local_header)
        local_records.extend(data)
        central_header = struct.pack(
            "<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, 2048, 0,
            dos_time, dos_date, crc, len(data), len(data), len(name), 0,
            0, 0, 0, 0o644 << 16, offset,
        ) + name
        central_records.extend(central_header)
        offset += len(local_header) + len(data)

    end_record = struct.pack(
        "<IHHHHIIH", 0x06054B50, 0, 0, len(FILES), len(FILES),
        len(central_records), offset, 0,
    )
    OUTPUT.write_bytes(local_records + central_records + end_record)
    print(f"Built {OUTPUT.name}: {OUTPUT.stat().st_size} bytes")


if __name__ == "__main__":
    build_package()

