import struct, sys, zipfile
z = zipfile.ZipFile(sys.argv[1]); bad = 0
for i in z.infolist():
    z.fp.seek(i.header_offset); h = z.fp.read(30); n, m = struct.unpack("<HH", h[26:30])
    start = i.header_offset + 30 + n + m
    if i.compress_type == 0 and start % (4096 if i.filename.endswith(".so") else 4):
        bad += 1; print("MISALIGNED", i.filename, start)
print("alignment OK" if not bad else f"{bad} misaligned")
sys.exit(1 if bad else 0)
