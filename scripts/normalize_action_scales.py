"""Normalize upright action groups to each fighter's authored idle scale."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image


FIGHTERS = ("guitar-boy", "green-slime", "bob-girl", "uncle", "rusty", "kazushige", "norio", "toko")
GROUPS = ("movement", "guard", "light_attacks", "heavy_attacks", "throw", "special")
EXCLUDED = {("green-slime", "light_attacks"), ("kazushige", "light_attacks")}
ANCHOR = (128, 233)


def numbered_frames(folder: Path, prefix: str) -> list[Path]:
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)\.png$")
    return sorted((path for path in folder.glob(f"{prefix}-*.png") if pattern.match(path.name)), key=lambda path: int(pattern.match(path.name).group(1)))


def body_scale(path: Path) -> float:
    alpha = np.asarray(Image.open(path).convert("RGBA").getchannel("A"))
    return math.sqrt(float(np.count_nonzero(alpha >= 9)) / float(alpha.size))


def median_scale(paths: list[Path]) -> float:
    return float(np.median([body_scale(path) for path in paths]))


def scaled_frame(path: Path, factor: float) -> Image.Image:
    frame = Image.open(path).convert("RGBA")
    bbox = frame.getbbox()
    if not bbox or abs(factor - 1.0) < 0.005:
        return frame.copy()
    subject = frame.crop(bbox)
    width = max(1, round(subject.width * factor))
    height = max(1, round(subject.height * factor))
    subject = subject.resize((width, height), Image.Resampling.NEAREST)
    source_anchor_x = ANCHOR[0] - bbox[0]
    source_anchor_y = ANCHOR[1] - bbox[1]
    paste_x = round(ANCHOR[0] - source_anchor_x * factor)
    paste_y = round(ANCHOR[1] - source_anchor_y * factor)
    if paste_x < 0 or paste_y < 0 or paste_x + width > frame.width or paste_y + height > frame.height:
        raise ValueError(f"scaled subject would clip: {path}")
    output = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    output.alpha_composite(subject, (paste_x, paste_y))
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("assets/sprites"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report", type=Path, default=Path("assets/sprites/action-scale-normalization.json"))
    args = parser.parse_args()
    report = {"method": "idle median alpha-area scale; uniform factor per upright action group", "anchor": list(ANCHOR), "cap": [0.88, 1.12], "fighters": {}}
    for fighter in FIGHTERS:
        base = args.root / fighter / "actions"
        idle = numbered_frames(base / "idle", "idle")
        target = median_scale(idle)
        fighter_report = {"idle_target": target, "groups": {}}
        for group in GROUPS:
            frames = numbered_frames(base / group, group)
            before = median_scale(frames)
            factor = max(0.88, min(1.12, target / before))
            entry = {"frames": len(frames), "before": before, "factor": factor, "status": "planned"}
            if (fighter, group) in EXCLUDED:
                entry.update(status="excluded_edge_contact", factor=1.0)
            elif args.apply:
                try:
                    outputs = [scaled_frame(path, factor) for path in frames]
                    for path, output in zip(frames, outputs):
                        output.save(path)
                    entry.update(status="applied", after=median_scale(frames))
                except ValueError as error:
                    entry.update(status="excluded_clip_risk", factor=1.0, reason=str(error))
            fighter_report["groups"][group] = entry
        report["fighters"][fighter] = fighter_report
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.report)


if __name__ == "__main__":
    main()
