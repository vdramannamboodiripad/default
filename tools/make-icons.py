# Rote — icon generator. Development tool, not part of the extension.
#
#   Run it:  python3 tools/make-icons.py
#
# Writes icons/icon16.png, icon32.png, icon48.png and icon128.png. Uses only the
# Python standard library, because adding an image library would break the
# no-dependencies rule for the sake of four small squares.
#
# The mark is a rounded green square with three white bars: a form, mostly filled
# in. Each icon is drawn four times larger than needed and then averaged down, which
# is what stops the rounded corners looking jagged at 16 pixels.

import os
import struct
import zlib

BACKGROUND = (31, 111, 67)   # the same green as the options page
BAR = (255, 255, 255)
SUPERSAMPLE = 4
SIZES = [16, 32, 48, 128]


def draw(size):
    """Return a list of rows of (r, g, b, a) at the given size."""
    big = size * SUPERSAMPLE
    radius = big * 0.22

    # Three bars: two full width, the third shorter, like a part-filled form.
    bars = []
    for index in range(3):
        top = big * (0.26 + 0.20 * index)
        height = big * 0.115
        left = big * 0.22
        right = big * (0.78 if index < 2 else 0.55)
        bars.append((left, top, right, top + height))

    rows = []
    for y in range(big):
        row = []
        for x in range(big):
            if inside_rounded_square(x, y, big, radius):
                colour = BACKGROUND + (255,)
                for left, top, right, bottom in bars:
                    if left <= x < right and top <= y < bottom:
                        colour = BAR + (255,)
                        break
            else:
                colour = (0, 0, 0, 0)  # transparent outside the square
            row.append(colour)
        rows.append(row)

    return downsample(rows, size)


def inside_rounded_square(x, y, size, radius):
    """True if this pixel is inside a square with rounded corners."""
    # Only the four corner boxes need a distance check; everything else is inside.
    for corner_x, corner_y in [
        (radius, radius),
        (size - radius, radius),
        (radius, size - radius),
        (size - radius, size - radius),
    ]:
        in_x_band = (x < radius) if corner_x == radius else (x > size - radius)
        in_y_band = (y < radius) if corner_y == radius else (y > size - radius)
        if in_x_band and in_y_band:
            distance_squared = (x - corner_x) ** 2 + (y - corner_y) ** 2
            return distance_squared <= radius**2

    return True


def downsample(rows, size):
    """Average each block of SUPERSAMPLE x SUPERSAMPLE pixels into one pixel."""
    block = SUPERSAMPLE
    out = []

    for y in range(size):
        row = []
        for x in range(size):
            totals = [0, 0, 0, 0]
            for sub_y in range(block):
                for sub_x in range(block):
                    pixel = rows[y * block + sub_y][x * block + sub_x]
                    for channel in range(4):
                        totals[channel] += pixel[channel]
            count = block * block
            row.append(tuple(total // count for total in totals))
        out.append(row)

    return out


def write_png(path, rows):
    """Write rows of (r, g, b, a) as a PNG, by hand."""
    height = len(rows)
    width = len(rows[0])

    raw = bytearray()
    for row in rows:
        raw.append(0)  # "no filter" marker at the start of every scanline
        for red, green, blue, alpha in row:
            raw += bytes((red, green, blue, alpha))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">2I5B", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA

    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.write(chunk(b"IHDR", header))
        handle.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        handle.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    icons = os.path.join(os.path.dirname(here), "icons")
    os.makedirs(icons, exist_ok=True)

    for size in SIZES:
        path = os.path.join(icons, "icon%d.png" % size)
        write_png(path, draw(size))
        print("wrote", os.path.relpath(path, os.path.dirname(here)))
