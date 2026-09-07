# Gradient Reader — icon generator. Development tool, not part of the extension.
#
#   Run it:  python3 gradient-reader/tools/make-icons.py
#
# Writes icons/icon16.png, icon32.png, icon48.png and icon128.png. Standard
# library only: adding an image library to draw four small squares would break
# the no-dependencies rule for no good reason. The PNG is assembled by hand at
# the bottom of the file, which is less work than it sounds — a PNG is a header,
# one zlib-compressed block of scanlines, and a footer.
#
# The mark is three bars, each one a gradient, and each one ending on the colour
# the bar below it begins with. That is the whole product in twelve pixels: the
# bars are lines of text and the shared colour is the thing the eye follows from
# the end of one to the start of the next. The third bar is short, the way a
# last line of a paragraph is short.
#
# Regenerate rather than editing the PNGs.

import os
import struct
import zlib

PAPER = (251, 251, 249)
RULE = (222, 222, 214)

# The Bright palette from palettes.js. Blue, amber and teal — the three
# directions that stay distinct under deuteranopia and protanopia, which is
# also what makes them stay distinct at sixteen pixels.
STOPS = [
    (27, 27, 26),     # ink
    (10, 88, 194),    # blue
    (143, 71, 0),     # amber
    (14, 111, 120),   # teal
]

SUPERSAMPLE = 4
SIZES = [16, 32, 48, 128]

# Three bars: left edge, right edge, top, height — all as fractions of the icon.
BARS = [
    (0.20, 0.82, 0.255, 0.105),
    (0.20, 0.82, 0.445, 0.105),
    (0.20, 0.60, 0.635, 0.105),
]


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw(size):
    """Return a list of rows of (r, g, b, a) at the given size."""
    big = size * SUPERSAMPLE
    radius = big * 0.22

    rows = []
    for y in range(big):
        row = []
        for x in range(big):
            if not inside_rounded_square(x, y, big, radius):
                row.append((0, 0, 0, 0))  # transparent outside the square
                continue

            colour = PAPER
            for index, (left, right, top, height) in enumerate(BARS):
                x0, x1 = left * big, right * big
                y0, y1 = top * big, (top + height) * big
                if x0 <= x < x1 and y0 <= y < y1:
                    # Bar i runs from stop i to stop i+1, so the colour it ends
                    # on is the colour the next bar starts with.
                    start = STOPS[index % len(STOPS)]
                    end = STOPS[(index + 1) % len(STOPS)]
                    colour = mix(start, end, (x - x0) / (x1 - x0))
                    break
            else:
                # Not on a bar. A hairline inside the edge keeps the mark from
                # dissolving into a light toolbar.
                if near_edge(x, y, big, radius):
                    colour = RULE

            row.append(colour + (255,))
        rows.append(row)

    return downsample(rows, size)


def inside_rounded_square(x, y, size, radius):
    """True if this pixel is inside a square with rounded corners."""
    for corner_x, corner_y in [
        (radius, radius),
        (size - radius, radius),
        (radius, size - radius),
        (size - radius, size - radius),
    ]:
        in_x_band = (x < radius) if corner_x == radius else (x > size - radius)
        in_y_band = (y < radius) if corner_y == radius else (y > size - radius)
        if in_x_band and in_y_band:
            return (x - corner_x) ** 2 + (y - corner_y) ** 2 <= radius**2

    return True


def near_edge(x, y, size, radius):
    """True just inside the outline, for a one-pixel border at 16px."""
    inset = max(1.0, size * 0.035)
    return not inside_rounded_square_inset(x, y, size, radius, inset)


def inside_rounded_square_inset(x, y, size, radius, inset):
    if x < inset or y < inset or x >= size - inset or y >= size - inset:
        return False
    return inside_rounded_square(x - inset, y - inset, size - 2 * inset,
                                 max(1.0, radius - inset))


def downsample(rows, size):
    """Average each block of SUPERSAMPLE x SUPERSAMPLE pixels into one pixel.

    This is what stops the rounded corners and the gradients looking jagged at
    16 pixels."""
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
