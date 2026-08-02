"""Align generated raw grid cells to a shared visual root without redrawing art."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rows", type=int, required=True)
    parser.add_argument("--cols", type=int, required=True)
    parser.add_argument("--cell-size", type=int, default=256)
    parser.add_argument("--anchor-x", type=float, default=128.0)
    parser.add_argument("--bottom-y", type=float, default=238.0)
    parser.add_argument(
        "--target-anchor-y",
        type=float,
        default=None,
        help="Align the lower 98th-percentile feet anchor instead of the visible bbox bottom.",
    )
    parser.add_argument(
        "--target-body-scale",
        type=float,
        default=None,
        help="Uniformly scale each cropped subject toward this area-normalized body scale.",
    )
    args = parser.parse_args()

    source = Image.open(args.input).convert("RGBA")
    cell_width = source.width // args.cols
    cell_height = source.height // args.rows
    if cell_width <= 0 or cell_height <= 0:
        raise ValueError("input grid is smaller than the requested rows/cols")
    output = Image.new("RGBA", source.size, (255, 0, 255, 255))
    rgba = np.asarray(source).copy()
    # Imagegen may return a slightly off-magenta chroma key. Match the same
    # Euclidean key-color distance used by generate2dsprite's processor.
    distance = np.sqrt(
        (rgba[:, :, 0].astype(float) - 255.0) ** 2
        + rgba[:, :, 1].astype(float) ** 2
        + (rgba[:, :, 2].astype(float) - 255.0) ** 2
    )
    magenta = (rgba[:, :, 3] > 0) & (distance < 100.0)
    rgba[magenta] = (0, 0, 0, 0)
    source = Image.fromarray(rgba, mode="RGBA")

    for index in range(args.rows * args.cols):
        row, col = divmod(index, args.cols)
        left, top = col * cell_width, row * cell_height
        frame = source.crop((left, top, left + cell_width, top + cell_height))
        alpha = np.asarray(frame.getchannel("A"))
        ys, xs = np.where(alpha > 0)
        if xs.size == 0:
            raise ValueError(f"empty frame {index + 1}")
        bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        crop = frame.crop(bbox)
        if args.target_body_scale is not None:
            current_body_scale = float(np.sqrt(np.count_nonzero(alpha) / (cell_width * cell_height)))
            if current_body_scale > 0:
                factor = float(args.target_body_scale) / current_body_scale
                width = max(1, int(round(crop.width * factor)))
                height = max(1, int(round(crop.height * factor)))
                crop = crop.resize((width, height), Image.Resampling.NEAREST)
        if args.target_anchor_y is None:
            paste_x = int(round(args.anchor_x - crop.width / 2.0))
            paste_y = int(round(args.bottom_y - crop.height))
        else:
            central = (xs >= cell_width * 0.2) & (xs <= cell_width * 0.8)
            anchor_xs = xs[central] if int(np.count_nonzero(central)) >= 8 else xs
            lower_cutoff = float(np.percentile(ys, 85))
            lower_xs = anchor_xs[ys[central] >= lower_cutoff] if int(np.count_nonzero(central)) >= 8 else xs[ys >= lower_cutoff]
            anchor_x = float(np.median(lower_xs)) if lower_xs.size else float(np.median(xs))
            anchor_y = float(np.percentile(ys, 98))
            anchor_x_rel = (anchor_x - bbox[0]) * (crop.width / max(1, bbox[2] - bbox[0]))
            anchor_y_rel = (anchor_y - bbox[1]) * (crop.height / max(1, bbox[3] - bbox[1]))
            paste_x = int(round(args.anchor_x - anchor_x_rel))
            paste_y = int(round(args.target_anchor_y - anchor_y_rel))
        output.alpha_composite(crop, (left + paste_x, top + paste_y))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.save(args.output)
    print(args.output)


if __name__ == "__main__":
    main()
