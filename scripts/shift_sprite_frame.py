"""Translate one transparent sprite frame without changing its pixels."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dx", type=int, default=0)
    parser.add_argument("--dy", type=int, default=0)
    args = parser.parse_args()
    source = Image.open(args.input).convert("RGBA")
    if source.size != (256, 256):
        raise ValueError(f"Expected a 256x256 frame, got {source.size}")
    translated = Image.new("RGBA", source.size, (0, 0, 0, 0))
    translated.alpha_composite(source, (args.dx, args.dy))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    translated.save(args.output)
    print(args.output)


if __name__ == "__main__":
    main()

