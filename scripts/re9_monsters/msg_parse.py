import struct, sys

KEY = bytes([0xCF,0xCE,0xFB,0xF8,0xEC,0x0A,0x33,0x66,0x93,0xA9,0x1D,0x93,0x50,0x39,0x5F,0x09])

def decrypt(data, data_offset):
    """XOR-CBC 解密字符串池"""
    raw = bytearray(data)
    prev = 0
    for i in range(data_offset, len(data)):
        cur = raw[i]
        raw[i] = cur ^ prev ^ KEY[(i - data_offset) & 0xF]
        prev = cur
    return bytes(raw)

def read_cstr(data, offset, enc='utf-16-le'):
    """读取 null 结尾字符串（容错）"""
    try:
        end = data.index(b'\x00\x00', offset) if enc == 'utf-16-le' else data.index(b'\x00', offset)
    except ValueError:
        return ''
    return data[offset:end].decode(enc, 'replace')

def parse_msg(path, lang_idx=0):
    data = open(path, 'rb').read()
    version = struct.unpack_from('<I', data, 0)[0]
    magic = data[4:8]
    assert magic == b'GMSG', f"not GMSG: {magic}"
    entry_count = struct.unpack_from('<I', data, 0x10)[0]
    attr_count = struct.unpack_from('<I', data, 0x14)[0]
    lang_count = struct.unpack_from('<I', data, 0x18)[0]
    data_offset = struct.unpack_from('<Q', data, 0x20)[0]
    unkn_zero = struct.unpack_from('<Q', data, 0x28)[0]
    lang_offset = struct.unpack_from('<Q', data, 0x30)[0]
    attr_offset = struct.unpack_from('<Q', data, 0x38)[0]
    attrname_offset = struct.unpack_from('<Q', data, 0x40)[0]

    # 解密
    if version > 12 and version not in (0x2022033D, 0x0100010C):
        data = decrypt(data, data_offset)

    # entryOffsets 在 header 之后
    header_size = 0x48  # 9 * 8 = 0x48? 实际 header 到 0x48 结束
    entry_offsets = [struct.unpack_from('<Q', data, header_size + i*8)[0] for i in range(entry_count)]

    # languages
    langs = [struct.unpack_from('<i', data, lang_offset + i*4)[0] for i in range(lang_count)]

    # 解析每个 entry
    entries = []
    for e in range(entry_count):
        off = entry_offsets[e]
        # SubEntryHeader: uuid16 + soundId(u32) + hash(u32) + entryNameOffset(u64) + attributeOffset(u64) + contentOffsets[lang_count](u64 each)
        p = off
        uuid = data[p:p+16]; p += 16
        sound_id = struct.unpack_from('<I', data, p)[0]; p += 4
        if version > 15 and version not in (0x2022033D,0x0100010C,0x0300010E,0x0400010F):
            hashval = struct.unpack_from('<I', data, p)[0]; p += 4
        else:
            hashval = struct.unpack_from('<I', data, p)[0]; p += 4  # index
        entry_name_off = struct.unpack_from('<Q', data, p)[0]; p += 8
        attr_off = struct.unpack_from('<Q', data, p)[0]; p += 8
        content_offsets = [struct.unpack_from('<Q', data, p + i*8)[0] for i in range(lang_count)]

        name = read_cstr(data, entry_name_off)
        content = read_cstr(data, content_offsets[lang_idx]) if content_offsets[lang_idx] else ''
        entries.append((name, content, hashval))

    return {
        'version': version, 'entry_count': entry_count, 'attr_count': attr_count,
        'lang_count': lang_count, 'langs': langs, 'entries': entries
    }

if __name__ == '__main__':
    path = sys.argv[1]
    lang = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    r = parse_msg(path, lang)
    print(f"version={r['version']} entries={r['entry_count']} attrs={r['attr_count']} langs={r['lang_count']}")
    print(f"langs: {r['langs'][:10]}")
    print("---")
    for name, content, h in r['entries']:
        print(f"[{name}] = {content}")
