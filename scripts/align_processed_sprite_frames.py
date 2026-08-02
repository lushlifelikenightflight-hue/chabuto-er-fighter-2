"""Align already-processed transparent sprite frames to one root and feet line.

This is a deterministic postprocessor only: it never creates or redraws sprite
art. It is used for a targeted QC correction when generated poses have small
root drift after the first processing pass.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--input-prefix", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--output-prefix", required=True)
    parser.add_argument("--count", type=int, required=True)
    parser.add_argument("--anchor-x", type=float, default=128.0)
    parser.add_argument("--bottom-y", type=float, default=238.0)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for index in range(args.count):
        source = args.input_dir / f"{args.input_prefix}-{index + 1}.png"
        image = Image.open(source).convert("RGBA")
        alpha = np.asarray(image.getchannel("A"))
        ys, xs = np.where(alpha > 0)
        if xs.size == 0:
            raise ValueError(f"empty frame: {source}")
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        crop = image.crop((x0, y0, x1, y1))
        # After cropping, placement is relative to the cropped subject size.
        # Use the visible center and lower edge as the root, not the source
        # image coordinates (which would incorrectly place the crop at x=0).
        paste_x = int(round(args.anchor_x - crop.width / 2.0))
        paste_y = int(round(args.bottom_y - crop.height))
        aligned = Image.new("RGBA", image.size, (0, 0, 0, 0))
        aligned.alpha_composite(crop, (paste_x, paste_y))
        aligned.save(args.output_dir / f"{args.output_prefix}-{index + 1}.png")


if __name__ == "__main__":
    main()
