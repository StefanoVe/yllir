# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow", "numpy", "scipy"]
# ///
"""Cuts the raw Codex generations into the atlas stamp and texture pack.

Run from anywhere: uv run tools/atlas-assets/process.py
Inputs:  .claude/scratchpad/atlas/raw/<id>/result.png (see prompts.json)
Outputs: yllir/skills/library/atlas/assets/ (stamps, textures, manifest.json)
         .claude/scratchpad/atlas/contact-sheet.png
Deterministic: the same raw inputs always give the same files.
"""

import json
import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = ROOT / ".claude" / "scratchpad" / "atlas"
RAW = SCRATCH / "raw"
ASSETS = ROOT / "yllir" / "skills" / "library" / "atlas" / "assets"
CONTACT = SCRATCH / "contact-sheet.png"
PROMPTS = Path(__file__).resolve().parent / "prompts.json"

GENERATED = "2026-11-19"
SIZE_LIMIT_BYTES = 4_000_000

# Stamps removed after the visual self-check. Numbering is kept for every
# component, so an excluded id always refers to the same picture.
# Add an entry here with the reason, then rerun; never edit images by hand.
EXCLUDE: dict[str, str] = {}

# Scale factor for every stamp. Set to 0.85 only if the size check fails.
STAMP_SCALE = 1.0

TARGET = {
    "mountains": 320,
    "hills": 220,
    "trees-broadleaf": 160,
    "trees-conifer": 160,
    "swamp": 160,
    "dunes": 220,
    "icons": 192,
}
ICON_NAMES = ["capital", "city", "town", "village", "fort", "ruin", "landmark", "port"]
LANCZOS = Image.Resampling.LANCZOS


def chroma_key(rgb: np.ndarray):
    """Returns (background mask, alpha in 0..255) for a magenta-background sheet."""
    r = rgb[..., 0].astype(float)
    g = rgb[..., 1].astype(float)
    b = rgb[..., 2].astype(float)
    dist = np.sqrt((r - 255) ** 2 + g**2 + (b - 255) ** 2)
    bg = (dist < 90) | ((r > 150) & (b > 150) & (g < 110))
    opaque = ~bg
    # One-pixel feather on the opaque side; background stays exactly 0.
    feathered = ndimage.gaussian_filter(opaque.astype(float), sigma=0.5)
    alpha = np.where(opaque, np.clip(feathered, 0.0, 1.0), 0.0)
    return bg, (alpha * 255).round().astype(np.uint8)


def despill(rgb: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Removes magenta from opaque pixels next to the background."""
    opaque = ~bg
    edge = opaque & ndimage.binary_dilation(bg, structure=np.ones((3, 3), bool))
    f = rgb.astype(float)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    cond = edge & (r - g > 40) & (b - g > 40)
    out = f.copy()
    out[..., 0] = np.where(cond, np.minimum(r, g + (r - g) * 0.5), r)
    out[..., 2] = np.where(cond, np.minimum(b, g + (b - g) * 0.5), b)
    return np.clip(out, 0, 255).round().astype(np.uint8)


def process_sheet(job: dict, counters: dict, stamps: list, excluded: list) -> None:
    category = job["category"]
    cols, rows = job["grid"]
    rgb = np.array(Image.open(RAW / job["id"] / "result.png").convert("RGB"))
    h, w = rgb.shape[:2]

    bg, alpha = chroma_key(rgb)
    rgb = despill(rgb, bg)

    closed = ndimage.binary_closing(alpha > 128, structure=np.ones((3, 3), bool))
    labels, count = ndimage.label(closed)
    areas = ndimage.sum(closed, labels, index=range(1, count + 1))
    slices = ndimage.find_objects(labels)
    min_area = 0.002 * w * h

    comps = []
    for i in range(1, count + 1):
        if areas[i - 1] < min_area:
            continue
        cy, cx = ndimage.center_of_mass(closed, labels, i)
        # Floor, not round: rounding puts the centroids of a 2-row sheet
        # (near 0.25h and 0.75h) into bands 0 and 2, which mis-orders the icons.
        row = min(rows - 1, int(cy // (h / rows)))
        comps.append((row, cx, i, slices[i - 1]))
    comps.sort(key=lambda c: (c[0], c[1]))
    print(f"{job['id']}: {len(comps)} components (grid {cols}x{rows} = {cols * rows})")

    if category == "icons" and len(comps) != 8:
        raise SystemExit(f"icons sheet {job['id']}: expected 8 components, found {len(comps)}")

    out_dir = ASSETS / "stamps" / category
    out_dir.mkdir(parents=True, exist_ok=True)
    target = TARGET[category] * STAMP_SCALE

    for index, (_, _, label, sl) in enumerate(comps):
        if category == "icons":
            stamp_id = f"icons-{ICON_NAMES[index]}"
            name = ICON_NAMES[index]
        else:
            counters[category] = counters.get(category, 0) + 1
            stamp_id = f"{category}-{counters[category]:02d}"
            name = stamp_id

        if stamp_id in EXCLUDE:
            excluded.append((stamp_id, EXCLUDE[stamp_id]))
            continue

        y0 = max(0, sl[0].start - 4)
        y1 = min(h, sl[0].stop + 4)
        x0 = max(0, sl[1].start - 4)
        x1 = min(w, sl[1].stop + 4)
        own = labels[y0:y1, x0:x1] == label
        box_alpha = alpha[y0:y1, x0:x1] * own
        box_rgb = rgb[y0:y1, x0:x1]
        stamp = Image.fromarray(np.dstack([box_rgb, box_alpha]).astype(np.uint8), "RGBA")

        scale = target / max(stamp.size)
        new_size = (max(1, round(stamp.width * scale)), max(1, round(stamp.height * scale)))
        stamp = stamp.resize(new_size, LANCZOS)

        arr = np.array(stamp)[..., 3].astype(float)
        if category == "icons":
            anchor = [0.5, 0.5]
        else:
            total = arr.sum()
            x_centre = (arr.sum(axis=0) * np.arange(arr.shape[1])).sum() / total
            low_row = np.nonzero((arr > 128).any(axis=1))[0].max()
            anchor = [round(x_centre / arr.shape[1], 4), round(low_row / arr.shape[0], 4)]

        rel = f"stamps/{category}/{name}.webp"
        stamp.save(ASSETS / rel, "WEBP", lossless=True)
        stamps.append({
            "id": stamp_id,
            "category": category,
            "file": rel,
            "width": stamp.width,
            "height": stamp.height,
            "anchor": anchor,
        })


def wrap_blend(img: np.ndarray) -> np.ndarray:
    """Makes an image tileable by blending it with its half-shifted copy.

    The image's own seam lies on its edges, the shifted copy's seam lies on its
    centre. Weight 1 at the centre of the original and 0 at its edges gives an
    image that matches itself across both wrap lines.
    """
    h, w = img.shape[:2]

    def bump(n: int) -> np.ndarray:
        i = np.arange(n)
        return 0.5 * (1 + np.cos(2 * np.pi * (i - n / 2) / n))

    wx = bump(w)[None, :, None]
    wy = bump(h)[:, None, None]
    shifted_x = np.roll(img, w // 2, axis=1)
    a = wx * img + (1 - wx) * shifted_x
    shifted_y = np.roll(a, h // 2, axis=0)
    return wy * a + (1 - wy) * shifted_y


def seam_ratio(img: np.ndarray) -> float:
    """Wrap-line difference divided by the typical neighbour difference (1.0 = no seam)."""
    wrap = np.abs(img[:, 0] - img[:, -1]).mean() + np.abs(img[0] - img[-1]).mean()
    inner = np.abs(np.diff(img, axis=1)).mean() + np.abs(np.diff(img, axis=0)).mean()
    return round(float(wrap / (inner + 1e-9)), 3)


def process_texture(job: dict, textures: list) -> None:
    img = Image.open(RAW / job["id"] / "result.png").convert("RGB")
    if img.width != img.height:
        img = img.resize((1024, 1024), LANCZOS)
    arr = np.asarray(img).astype(float)
    tiled = np.clip(wrap_blend(arr).round(), 0, 255).astype(np.uint8)
    out = Image.fromarray(tiled).resize((512, 512), LANCZOS)
    rel = f"textures/{job['id']}.webp"
    out.save(ASSETS / rel, "WEBP", quality=82)
    print(f"{job['id']}: seam ratio {seam_ratio(np.asarray(out).astype(float))}")
    textures.append({"id": job["id"], "file": rel, "width": 512, "height": 512})


def draw_contact_sheet(stamps: list, textures: list) -> None:
    try:
        font = ImageFont.load_default(size=14)
    except TypeError:
        font = ImageFont.load_default()
    cell_w, cell_h, per_row, width = 200, 210, 8, 1600
    groups: dict[str, list] = {}
    for s in stamps:
        groups.setdefault(s["category"], []).append(s)

    rows_needed = 0
    for members in groups.values():
        rows_needed += 1 + math.ceil(len(members) / per_row)
    tex_rows = math.ceil(len(textures) / 3)
    height = 40 + rows_needed * (cell_h + 30) + 40 + tex_rows * 480 + 40
    sheet = Image.new("RGB", (width, height), (230, 230, 230))
    draw = ImageDraw.Draw(sheet)

    y = 20
    for category in sorted(groups):
        draw.text((20, y), category, fill=(40, 40, 40), font=font)
        y += 30
        for n, s in enumerate(sorted(groups[category], key=lambda s: s["id"])):
            x = 20 + (n % per_row) * cell_w
            cy = y + (n // per_row) * (cell_h + 30)
            stamp = Image.open(ASSETS / s["file"]).convert("RGBA")
            stamp.thumbnail((cell_w - 20, cell_h - 20), LANCZOS)
            sheet.paste(stamp, (x + (cell_w - stamp.width) // 2, cy + (cell_h - 20 - stamp.height)), stamp)
            draw.text((x + 4, cy + cell_h - 4), s["id"], fill=(20, 20, 20), font=font)
        y += (math.ceil(len(groups[category]) / per_row)) * (cell_h + 30) + 10

    y += 20
    draw.text((20, y), "textures (tiled 2 x 2)", fill=(40, 40, 40), font=font)
    y += 30
    for n, t in enumerate(sorted(textures, key=lambda t: t["id"])):
        tex = Image.open(ASSETS / t["file"]).convert("RGB").resize((220, 220), LANCZOS)
        tiled = Image.new("RGB", (440, 440))
        for ox in (0, 220):
            for oy in (0, 220):
                tiled.paste(tex, (ox, oy))
        x = 20 + (n % 3) * 500
        ty = y + (n // 3) * 480
        sheet.paste(tiled, (x, ty))
        draw.text((x, ty + 448), t["id"], fill=(20, 20, 20), font=font)

    sheet = sheet.crop((0, 0, width, y + tex_rows * 480 + 20))
    CONTACT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(CONTACT)
    print(f"contact sheet: {CONTACT}")


def main() -> None:
    jobs = json.loads(PROMPTS.read_text(encoding="utf-8"))
    for stale in ("stamps", "textures"):
        shutil.rmtree(ASSETS / stale, ignore_errors=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / "textures").mkdir(exist_ok=True)

    stamps: list = []
    textures: list = []
    excluded: list = []
    counters: dict = {}
    for job in jobs:
        if job["kind"] == "sheet":
            process_sheet(job, counters, stamps, excluded)
    for job in jobs:
        if job["kind"] == "texture":
            process_texture(job, textures)

    stamps.sort(key=lambda s: (s["category"], s["id"]))
    textures.sort(key=lambda t: t["id"])
    manifest = {
        "schema": 1,
        "style": "fantasy-color",
        "generated": GENERATED,
        "tool": "Codex ImageGen, processed by tools/atlas-assets/process.py",
        "stamps": stamps,
        "textures": textures,
    }
    (ASSETS / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    per_category: dict[str, int] = {}
    for s in stamps:
        per_category[s["category"]] = per_category.get(s["category"], 0) + 1
    print("stamps per category:", dict(sorted(per_category.items())))
    print(f"textures: {len(textures)}")
    for stamp_id, reason in excluded:
        print(f"excluded: {stamp_id} ({reason})")

    draw_contact_sheet(stamps, textures)

    total = sum(p.stat().st_size for p in ASSETS.rglob("*") if p.is_file())
    print(f"total size: {total} bytes ({total / 1_000_000:.2f} MB), limit {SIZE_LIMIT_BYTES} bytes")
    if total >= SIZE_LIMIT_BYTES:
        print("OVER THE SIZE LIMIT: set STAMP_SCALE to 0.85 and rerun")


if __name__ == "__main__":
    main()
