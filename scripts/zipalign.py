"""Minimal zipalign: rewrites a zip so every STORED entry's data starts on a 4-byte boundary
(and .so files on 4096), matching Android's zipalign -p behaviour."""
import struct
import sys
import zipfile


def align(src, dst):
    zin = zipfile.ZipFile(src)
    out = open(dst, "wb")
    central = []
    for info in zin.infolist():
        data = zin.open(info).read() if info.compress_type == zipfile.ZIP_STORED else None
        raw = None
        if data is None:
            # copy compressed bytes verbatim
            zin.fp.seek(info.header_offset)
            h = zin.fp.read(30)
            n, m = struct.unpack("<HH", h[26:30])
            zin.fp.seek(info.header_offset + 30 + n + m)
            raw = zin.fp.read(info.compress_size)
        name = info.filename.encode("utf-8")
        offset = out.tell()
        extra = b""
        if info.compress_type == zipfile.ZIP_STORED:
            # Same as modern zipalign/apksigner: a well-formed 0xD935 "alignment" extra record
            # (id, size, u16 alignment, zero padding) instead of raw zero bytes.
            boundary = 4096 if info.filename.endswith(".so") else 4
            data_start = offset + 30 + len(name) + 6
            pad = (-data_start) % boundary
            extra = struct.pack("<HHH", 0xD935, 2 + pad, boundary) + b"\x00" * pad
        flags = info.flag_bits & ~0x08  # no data descriptor
        hdr = struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, flags, info.compress_type,
                          0, 0x21, info.CRC, info.compress_size, info.file_size, len(name), len(extra))
        out.write(hdr + name + extra)
        out.write(data if raw is None else raw)
        central.append((info, name, offset, flags))
    cd_start = out.tell()
    for info, name, offset, flags in central:
        out.write(struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, flags, info.compress_type, 0, 0x21,
                              info.CRC, info.compress_size, info.file_size, len(name), 0, 0, 0, 0, 0, offset) + name)
    cd_size = out.tell() - cd_start
    out.write(struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(central), len(central), cd_size, cd_start, 0))
    out.close()


if __name__ == "__main__":
    align(sys.argv[1], sys.argv[2])
