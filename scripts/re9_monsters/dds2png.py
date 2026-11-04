import struct, os, sys
import numpy as np
from PIL import Image

# 从 DDS (DXT10 扩展头, REtool 输出) 解码 BC1 为 PNG
# dxgiFormat: 71/72/73 = BC1

def decode_bc1(block_data, w, h):
    bw = (w + 3) // 4
    bh = (h + 3) // 4
    out = np.zeros((bh*4, bw*4, 4), dtype=np.uint8)
    bd = np.frombuffer(block_data, dtype=np.uint8).reshape(bh, bw, 8)
    c0 = bd[:,:,0].astype(np.uint16) | (bd[:,:,1].astype(np.uint16) << 8)
    c1 = bd[:,:,2].astype(np.uint16) | (bd[:,:,3].astype(np.uint16) << 8)
    r0 = ((c0 >> 11) & 31) * 255 // 31
    g0 = ((c0 >> 5) & 63) * 255 // 63
    b0 = (c0 & 31) * 255 // 31
    r1 = ((c1 >> 11) & 31) * 255 // 31
    g1 = ((c1 >> 5) & 63) * 255 // 63
    b1 = (c1 & 31) * 255 // 31
    color0 = np.stack([r0, g0, b0], axis=-1)
    color1 = np.stack([r1, g1, b1], axis=-1)
    color2 = (color0*2 + color1) // 3
    color3 = (color0 + color1*2) // 3
    mode4 = (c0 > c1)
    lut = np.zeros((bh, bw, 4, 3), dtype=np.uint8)
    lut[:,:,0] = color0
    lut[:,:,1] = color1
    lut[:,:,2] = np.where(mode4[...,None], color2, (color0+color1)//2)
    lut[:,:,3] = np.where(mode4[...,None], color3, 0)
    for i in range(16):
        byte = bd[:,:,4+i//4]
        shift = (i % 4) * 2
        ci = (byte >> shift) & 3
        py, px = i//4, i%4
        col = lut[np.arange(bh)[:,None], np.arange(bw)[None,:], ci]
        out[py::4, px::4, :3] = col
        a = np.where(mode4, 255, np.where(ci == 3, 0, 255))
        out[py::4, px::4, 3] = a
    return out[:h, :w]

def dds_to_png(ddspath, pngpath):
    d = open(ddspath, 'rb').read()
    assert d[:4] == b'DDS ', 'not DDS'
    h = struct.unpack_from('<I', d, 12)[0]
    w = struct.unpack_from('<I', d, 16)[0]
    fourcc = d[84:88]
    if fourcc == b'DX10':
        fmt = struct.unpack_from('<I', d, 128)[0]
        data_off = 148
    else:
        fmt = fourcc
        data_off = 128
    if fmt in (71, 72, 73):
        # BC1: 每个 4x4 块 8 字节，只取顶层 mip
        mipsize = ((w + 3) // 4) * ((h + 3) // 4) * 8
        img = decode_bc1(d[data_off:data_off + mipsize], w, h)
    elif fmt in (80,):
        # BC4 简化（albedo 一般不会碰到）
        raise ValueError('BC4 not handled')
    elif fmt in (98, 99):
        # BC7 用 Pillow
        im = Image.open(ddspath)
        im.load()
        im.convert('RGBA').save(pngpath)
        return w, h, fmt
    else:
        raise ValueError(f'unsupported fmt {fmt}')
    Image.fromarray(img, 'RGBA').save(pngpath)
    return w, h, fmt

if __name__ == '__main__':
    for p in sys.argv[1:]:
        out = p.rsplit('.dds', 1)[0] + '.png'
        try:
            w, h, f = dds_to_png(p, out)
            print(f'OK {os.path.basename(p)} -> {out} ({w}x{h} fmt={f})')
        except Exception as e:
            print(f'ERR {p}: {e}')
