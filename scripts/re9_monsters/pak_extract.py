import struct, sys, os

# ============ Murmur3 x86_32 ============
def rotl32(x, r):
    return ((x << r) | (x >> (32 - r))) & 0xFFFFFFFF

def fmix32(h):
    h &= 0xFFFFFFFF
    h ^= h >> 16
    h = (h * 0x85ebca6b) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 0xc2b2ae35) & 0xFFFFFFFF
    h ^= h >> 16
    return h & 0xFFFFFFFF

def murmur3_32(data, seed=0xFFFFFFFF):
    c1 = 0xcc9e2d51
    c2 = 0x1b873593
    h1 = seed & 0xFFFFFFFF
    length = len(data)
    nblocks = length // 4
    for i in range(nblocks):
        k1 = data[i*4] | (data[i*4+1] << 8) | (data[i*4+2] << 16) | (data[i*4+3] << 24)
        k1 = (k1 * c1) & 0xFFFFFFFF
        k1 = rotl32(k1, 15)
        k1 = (k1 * c2) & 0xFFFFFFFF
        h1 ^= k1
        h1 = rotl32(h1, 13)
        h1 = (h1 * 5 + 0xe6546b64) & 0xFFFFFFFF
    k1 = 0
    tail = data[nblocks*4:]
    if len(tail) >= 3:
        k1 = tail[0] | (tail[1] << 8) | (tail[2] << 16)
        k1 = (k1 * c1) & 0xFFFFFFFF
        k1 = rotl32(k1, 15)
        k1 = (k1 * c2) & 0xFFFFFFFF
        h1 ^= k1
    elif len(tail) == 2:
        k1 = tail[0] | (tail[1] << 8)
        k1 = (k1 * c1) & 0xFFFFFFFF
        k1 = rotl32(k1, 15)
        k1 = (k1 * c2) & 0xFFFFFFFF
        h1 ^= k1
    elif len(tail) == 1:
        k1 = tail[0]
        k1 = (k1 * c1) & 0xFFFFFFFF
        k1 = rotl32(k1, 15)
        k1 = (k1 * c2) & 0xFFFFFFFF
        h1 ^= k1
    h1 ^= length
    h1 = fmix32(h1)
    return h1 & 0xFFFFFFFF

def path_hash(path):
    lo = murmur3_32(path.lower().encode('utf-16-le'))
    hi = murmur3_32(path.upper().encode('utf-16-le'))
    return (hi << 32) | lo

# ============ RSA key 解密 ============
MODULUS = bytes([
    0x7D,0x0B,0xF8,0xC1,0x7C,0x23,0xFD,0x3B,0xD4,0x75,0x16,0xD2,0x33,0x21,0xD8,0x10,
    0x71,0xF9,0x7C,0xD1,0x34,0x93,0xBA,0x77,0x26,0xFC,0xAB,0x2C,0xEE,0xDA,0xD9,0x1C,
    0x89,0xE7,0x29,0x7B,0xDD,0x8A,0xAE,0x50,0x39,0xB6,0x01,0x6D,0x21,0x89,0x5D,0xA5,
    0xA1,0x3E,0xA2,0xC0,0x8C,0x93,0x13,0x36,0x65,0xEB,0xE8,0xDF,0x06,0x17,0x67,0x96,
    0x06,0x2B,0xAC,0x23,0xED,0x8C,0xB7,0x8B,0x90,0xAD,0xEA,0x71,0xC4,0x40,0x44,0x9D,
    0x1C,0x7B,0xBA,0xC4,0xB6,0x2D,0xD6,0xD2,0x4B,0x62,0xD6,0x26,0xFC,0x74,0x20,0x07,
    0xEC,0xE3,0x59,0x9A,0xE6,0xAF,0xB9,0xA8,0x35,0x8B,0xE0,0xE8,0xD3,0xCD,0x45,0x65,
    0xB0,0x91,0xC4,0x95,0x1B,0xF3,0x23,0x1E,0xC6,0x71,0xCF,0x3E,0x35,0x2D,0x6B,0xE3,
    0x00])

def rsa_decrypt_key(encrypted_key):
    e = 0x10001
    n = int.from_bytes(MODULUS, 'little')
    c = int.from_bytes(encrypted_key + b'\x00', 'little')
    m = pow(c, e, n)
    nbytes = (m.bit_length() + 7) // 8
    return m.to_bytes(nbytes, 'little')

def decrypt_entry_table(table, key):
    out = bytearray(table)
    for i in range(len(table)):
        out[i] ^= (i + key[i % 32] * key[i % 29]) & 0xFF
    return bytes(out)

# ============ PAK 解析 ============
def parse_pak(path):
    f = open(path, 'rb')
    magic = struct.unpack('<I', f.read(4))[0]
    major = struct.unpack('<b', f.read(1))[0]
    minor = struct.unpack('<b', f.read(1))[0]
    feature = struct.unpack('<h', f.read(2))[0]
    total = struct.unpack('<i', f.read(4))[0]
    fingerprint = struct.unpack('<I', f.read(4))[0]
    assert magic == 0x414B504B, f"bad magic {magic:#x}"
    entry_size = 48 if major == 4 else 24
    table = f.read(total * entry_size)
    pos = f.tell()
    encrypted = feature in (8, 12, 24, 40, 44, 104)
    chunk_map = None
    if encrypted:
        if feature == 24:
            f.seek(4, 1)
        elif feature in (12, 44):
            f.seek(9, 1)
        key = f.read(128)
        table = decrypt_entry_table(table, rsa_decrypt_key(key))
        if feature in (40, 44):
            maxblk = struct.unpack('<i', f.read(4))[0]
            chunks_count = struct.unpack('<i', f.read(4))[0]
            chunk_map = []
            for i in range(chunks_count):
                off = struct.unpack('<I', f.read(4))[0]
                sz = struct.unpack('<I', f.read(4))[0]
                chunk_map.append((off + ((sz & 0x3FF) << 32), sz >> 10))
    entries = []
    for i in range(total):
        lo, hi, offset, csize, dsize, attr, checksum = struct.unpack('<IIqqqqQ', table[i*entry_size:(i+1)*entry_size])
        h64 = (hi << 32) | lo
        entries.append((h64, offset, csize, dsize, attr, checksum))
    return f, entries, feature, chunk_map

def extract(f, entry, feature, chunk_map):
    h64, offset, csize, dsize, attr, checksum = entry
    comp = attr & 0xF
    enc = (attr & 0x00FF0000) >> 16
    f.seek(offset, 0)
    if comp == 0:  # NONE
        if feature in (40, 44) and attr in (0x1000000, 0x1000400, 0x1000800, 0x1000C00):
            # chunked
            data = unwrap_chunks(f, csize, dsize, offset, chunk_map)
        else:
            data = f.read(csize)
    elif comp in (1, 2):
        raw = f.read(csize)
        if enc != 0 and enc <= 5:
            raw = decrypt_resource(raw)
        if comp == 1:
            import zlib
            data = zlib.decompress(raw, -15)  # raw deflate
        else:
            import zstandard
            data = zstandard.ZstdDecompressor().decompress(raw, max_output_size=dsize)
    else:
        raise Exception(f"unknown comp {comp}")
    return data

def unwrap_chunks(f, csize, dsize, start_chunk_id, chunk_map):
    import zstandard
    remain = csize
    cid = start_chunk_id
    out = bytearray()
    MAXC = 524288
    dctx = zstandard.ZstdDecompressor()
    while remain > 0:
        coff, csz = chunk_map[cid]
        f.seek(coff, 0)
        buf = f.read(csz)
        if csz == MAXC:
            out += buf
        else:
            out += dctx.decompress(buf)
        cid += 1
        remain -= csz
    return bytes(out[:dsize])

def decrypt_resource(buf):
    # RE Engine resource cipher (chacha-like) - not needed for most; placeholder
    return buf

if __name__ == '__main__':
    pak = sys.argv[1]
    f, entries, feature, chunk_map = parse_pak(pak)
    print(f"feature={feature} total={len(entries)} chunk_map={len(chunk_map) if chunk_map else 0}")
    # 验证 hash
    test = 'natives/stm/message/gamesystem/charaname.msg.23'
    h = path_hash(test)
    found = [e for e in entries if e[0] == h]
    print(f"test hash {h:#x} found={len(found)}")
    if found:
        e = found[0]
        print(f"  offset={e[1]} csize={e[2]} dsize={e[3]} attr={e[4]:#x}")
