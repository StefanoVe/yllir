#!/usr/bin/env python3
# Draws a regular square grid over a PNG map. Pillow only, Python 3.10+.
# Usage: python map-grid.py --input <png> --output <png> --cell <px>
#        [--color "#000000"] [--opacity 0.35] [--width 2]
# Exit codes: 0 grid drawn, 1 refused (one line `error: ...` on stdout).
# The output is deterministic: the same input and options give identical bytes.

import argparse
import json
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def refuse(message):
    print(f"error: {message}")
    return 1


def parse_args(argv):
    parser = argparse.ArgumentParser(prog="map-grid.py")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--cell", required=True, type=int)
    parser.add_argument("--color", default="#000000")
    parser.add_argument("--opacity", default=0.35, type=float)
    parser.add_argument("--width", default=2, type=int)
    return parser.parse_args(argv)


def main(argv):
    args = parse_args(argv)

    if args.cell < 8:
        return refuse("cell must be at least 8 pixels")
    if not 0.0 <= args.opacity <= 1.0:
        return refuse("opacity must be between 0 and 1")
    if args.width < 1:
        return refuse("width must be at least 1")
    if not HEX_COLOR.match(args.color):
        return refuse("color must be #RRGGBB")
    if os.path.exists(args.output):
        return refuse("output already exists")

    try:
        base = Image.open(args.input).convert("RGBA")
    except Exception as exc:
        return refuse(f"cannot read input: {exc}")

    width, height = base.size
    if width % args.cell or height % args.cell:
        return refuse(f"image size {width}x{height} is not a multiple of cell {args.cell}")

    cols = width // args.cell
    rows = height // args.cell
    red = int(args.color[1:3], 16)
    green = int(args.color[3:5], 16)
    blue = int(args.color[5:7], 16)
    alpha = round(args.opacity * 255)
    line_color = (red, green, blue, alpha)

    # Lines are drawn on a transparent overlay, then composited over the map.
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    xs = [k * args.cell for k in range(cols)] + [width - 1]
    ys = [k * args.cell for k in range(rows)] + [height - 1]
    for x in xs:
        draw.line([(x, 0), (x, height - 1)], fill=line_color, width=args.width)
    for y in ys:
        draw.line([(0, y), (width - 1, y)], fill=line_color, width=args.width)

    result = Image.alpha_composite(base, overlay).convert("RGB")
    try:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        result.save(args.output, format="PNG", optimize=False)
    except Exception as exc:
        return refuse(f"cannot write output: {exc}")

    print(json.dumps({
        "status": "pass",
        "output": os.path.abspath(args.output),
        "cols": cols,
        "rows": rows,
        "cell": args.cell,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
