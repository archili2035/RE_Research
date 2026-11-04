import struct, sys

TEX_FORMAT_NAMES = {
    0:"UNKNOWN", 1:"R32G32B32A32_TYPELESS", 2:"R32G32B32A32_FLOAT", 6:"R32G32B32_FLOAT",
    10:"R16G16B16A16_FLOAT", 11:"R16G16B16A16_UNORM", 28:"R8G8B8A8_UNORM", 29:"R8G8B8A8_UNORM_SRGB",
    71:"BC1_UNORM", 72:"BC1_UNORM_SRGB", 73:"BC1_TYPELESS",
    77:"BC3_UNORM", 78:"BC3_UNORM_SRGB",
    80:"BC4_UNORM", 83:"BC5_UNORM",
    95:"BC6H_UF16", 96:"BC6H_SF16",
    98:"BC7_UNORM", 99:"BC7_UNORM_SRGB",
    61:"R8_UNORM", 49:"R32G32B32A32", 65:"R32_FLOAT",
}

def parse_tex(path):
    d = open(path, 'rb').read()
    magic = d[:4]
    assert magic == b'TEX\x00', f"not TEX: {magic}"
    version = struct.unpack_from('<I', d, 4)[0]
    width = struct.unpack_from('<H', d, 8)[0]
    height = struct.unpack_from('<H', d, 10)[0]
    unk00 = struct.unpack_from('<H', d, 12)[0]
    if version > 27:
        numImages = d[14]
        oneImgMipHdrSize = d[15]
        mipCount = oneImgMipHdrSize // 16
    else:
        mipCount = d[14]
        numImages = d[15]
    fmt = struct.unpack_from('<I', d, 16)[0]
    return version, width, height, numImages, mipCount, fmt

if __name__ == '__main__':
    for p in sys.argv[1:]:
        v, w, h, ni, mc, f = parse_tex(p)
        print(f"{p.split('/')[-1]}: {w}x{h} images={ni} mips={mc} format={f}({TEX_FORMAT_NAMES.get(f,'?')})")
