"""Recompose generated transparent frames into an aligned magenta QC grid."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--frame-dir", type=Path)
    source_group.add_argument("--input-grid", type=Path)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--rows", type=int, required=True)
    parser.add_argument("--cols", type=int, required=True)
    parser.add_argument("--cell-size", type=int, default=256)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--pre-scale",
        type=float,
        default=1.0,
        help="Scale visible pixels around the configured ground anchor before recomposition.",
    )
    parser.add_argument("--anchor-x", type=float, default=128.0)
    parser.add_argument("--anchor-y", type=float, default=233.0)
    parser.add_argument(
        "--frame-scales",
        default="",
        help="Optional comma-separated per-frame scale corrections applied after --pre-scale.",
    )
    args = parser.parse_args()

    count = args.rows * args.cols
    frame_scales = [float(value) for value in args.frame_scales.split(",") if value.strip()]
    if frame_scales and len(frame_scales) != count:
        raise ValueError(f"Expected {count} frame scales, got {len(frame_scales)}")
    canvas = Image.new("RGBA", (args.cols * args.cell_size, args.rows * args.cell_size), (255, 0, 255, 255))
    input_grid = Image.open(args.input_grid).convert("RGBA") if args.input_grid else None
    for index in range(count):
        if input_grid is not None:
            source = args.input_grid
            left = (index % args.cols) * args.cell_size
            top = (index // args.cols) * args.cell_size
            frame = input_grid.crop((left, top, left + args.cell_size, top + args.cell_size))
            pixels = frame.load()
            for py in range(frame.height):
                for px in range(frame.width):
                    red, green, blue, alpha = pixels[px, py]
                    if alpha and red >= 245 and green <= 10 and blue >= 245:
                        pixels[px, py] = (0, 0, 0, 0)
        else:
            source = args.frame_dir / f"{args.prefix}-{index + 1}.png"
            frame = Image.open(source).convert("RGBA")
        if frame.size != (args.cell_size, args.cell_size):
            raise ValueError(f"Unexpected frame size for {source}: {frame.size}")
        effective_scale = args.pre_scale * (frame_scales[index] if frame_scales else 1.0)
        if effective_scale != 1.0:
            bbox = frame.getbbox()
            scaled_frame = Image.new("RGBA", frame.size, (0, 0, 0, 0))
            if bbox:
                subject = frame.crop(bbox)
                width = max(1, round(subject.width * effective_scale))
                height = max(1, round(subject.height * effective_scale))
                subject = subject.resize((width, height), Image.Resampling.NEAREST)
                source_anchor_x = args.anchor_x - bbox[0]
                source_anchor_y = args.anchor_y - bbox[1]
                paste_x = round(args.anchor_x - source_anchor_x * effective_scale)
                paste_y = round(args.anchor_y - source_anchor_y * effective_scale)
                scaled_frame.alpha_composite(subject, (paste_x, paste_y))
            frame = scaled_frame
        x = (index % args.cols) * args.cell_size
        y = (index // args.cols) * args.cell_size
        canvas.alpha_composite(frame, (x, y))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output)
    print(args.output)


if __name__ == "__main__":
    main()
