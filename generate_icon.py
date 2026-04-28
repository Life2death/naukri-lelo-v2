"""
Generate Naukri Lelo app icons: blue background with white 'N' letter.
Uses only Python built-ins (struct, zlib) — no PIL required.
"""
import struct
import zlib
import math
import os

# Colors
BG_COLOR = (37, 99, 235)   # #2563EB  blue
FG_COLOR = (255, 255, 255)  # white

def create_png_bytes(width, height, pixels_rgb):
    """Encode a flat list of (r,g,b) tuples as an RGBA PNG binary (alpha=255)."""

    def make_chunk(tag, data):
        crc_val = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc_val)

    # IHDR — color type 6 = RGBA
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)

    # Raw scanlines: filter-byte 0 before each row, RGBA bytes
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter None
        for x in range(width):
            r, g, b = pixels_rgb[y * width + x]
            raw += bytes([r, g, b, 255])  # fully opaque alpha

    idat_data = zlib.compress(bytes(raw), 9)

    return (
        b'\x89PNG\r\n\x1a\n'
        + make_chunk(b'IHDR', ihdr_data)
        + make_chunk(b'IDAT', idat_data)
        + make_chunk(b'IEND', b'')
    )


def draw_icon(size):
    """Return a flat list of (r,g,b) for a size×size 'N' icon."""
    pixels = [BG_COLOR] * (size * size)

    def set_px(x, y, color):
        if 0 <= x < size and 0 <= y < size:
            pixels[y * size + x] = color

    def fill_rect(x1, y1, x2, y2, color):
        for yy in range(max(0, y1), min(size, y2)):
            for xx in range(max(0, x1), min(size, x2)):
                pixels[yy * size + xx] = color

    # Proportions scaled to 'size'
    pad   = round(size * 0.18)
    bar_w = max(2, round(size * 0.145))
    top_y   = pad
    bot_y   = size - pad
    left_x  = pad
    right_x = size - pad - bar_w

    # Left bar
    fill_rect(left_x, top_y, left_x + bar_w, bot_y, FG_COLOR)
    # Right bar
    fill_rect(right_x, top_y, right_x + bar_w, bot_y, FG_COLOR)

    # Diagonal  (top-left corner → bottom-right corner of the space between bars)
    h = bot_y - top_y
    w = right_x - left_x         # horizontal span between left and right bars
    thick = max(2, bar_w)         # diagonal stroke thickness

    for step in range(h):
        t = step / max(1, h - 1)
        cx = left_x + bar_w + round(t * (w - bar_w))
        cy = top_y + step
        half = thick // 2
        for dx in range(-half, half + 1):
            set_px(cx + dx, cy, FG_COLOR)

    return pixels


def make_ico(png_32, png_128):
    """
    Minimal ICO containing two entries: 32×32 and 128×128 (stored as PNG).
    """
    # ICO header: 2 reserved, 2 type=1 (ICO), 2 count
    count = 2
    header = struct.pack('<HHH', 0, 1, count)

    # Each directory entry is 16 bytes; image data follows after all entries.
    entry_size = 16
    data_offset = 6 + count * entry_size   # absolute offset of first image blob

    entries = bytearray()
    blobs   = bytearray()

    for img_size, png_data in [(32, png_32), (128, png_128)]:
        w = img_size if img_size < 256 else 0   # 0 means 256 in ICO spec
        h = w
        entries += struct.pack(
            '<BBBBHHII',
            w, h,       # width, height (0 = 256)
            0,          # color count (0 = no palette)
            0,          # reserved
            1,          # color planes
            32,         # bits per pixel
            len(png_data),
            data_offset + len(blobs),
        )
        blobs += png_data

    return header + bytes(entries) + bytes(blobs)


def main():
    out_dir = os.path.join(os.path.dirname(__file__), 'src-tauri', 'icons')
    os.makedirs(out_dir, exist_ok=True)

    sizes = {
        '32x32.png':      32,
        '128x128.png':    128,
        '128x128@2x.png': 256,
        'icon.png':       512,
    }

    png_cache = {}
    for filename, sz in sizes.items():
        pixels   = draw_icon(sz)
        png_data = create_png_bytes(sz, sz, pixels)
        png_cache[sz] = png_data
        out_path = os.path.join(out_dir, filename)
        with open(out_path, 'wb') as f:
            f.write(png_data)
        print(f'  wrote {out_path}  ({len(png_data)} bytes)')

    # ICO  (32×32 + 128×128)
    ico_data = make_ico(png_cache[32], png_cache[128])
    ico_path = os.path.join(out_dir, 'icon.ico')
    with open(ico_path, 'wb') as f:
        f.write(ico_data)
    print(f'  wrote {ico_path}  ({len(ico_data)} bytes)')

    # icns — macOS: write a stub PNG renamed .icns (Tauri accepts this for dev)
    icns_path = os.path.join(out_dir, 'icon.icns')
    with open(icns_path, 'wb') as f:
        f.write(png_cache[512])
    print(f'  wrote {icns_path}  (PNG stub, {len(png_cache[512])} bytes)')

    print('\nAll icons generated successfully.')


if __name__ == '__main__':
    main()
