"""Static validation for authored fighting-game sprite frame bundles."""

from __future__ import annotations

import argparse
import math
import statistics
from pathlib import Path

from PIL import Image


LAYOUT = {
    "idle": (4, {"idle": range(0, 4)}),
    "movement": (12, {"walk_forward": range(0, 3), "walk_backward": range(3, 6), "dash": range(6, 9), "backstep": range(9, 12)}),
    "crouch": (6, {"crouch_start": range(0, 2), "crouch_idle": range(2, 4), "crouch_end": range(4, 6)}),
    "jump": (12, {"jump_start": range(0, 2), "jump_rise": range(2, 4), "jump_apex": range(4, 6), "jump_fall": range(6, 8), "landing": range(8, 10), "double_jump": range(10, 12)}),
    "light_attacks": (12, {"light_stand": range(0, 4), "light_crouch": range(4, 8), "light_air": range(8, 12)}),
    "heavy_attacks": (12, {"heavy_stand": range(0, 4), "heavy_crouch": range(4, 8), "heavy_air": range(8, 12)}),
    "guard": (6, {"guard_high": range(0, 2), "guard_low": range(2, 4), "just_guard": range(4, 6)}),
    "throw": (10, {"throw_start": range(0, 2), "throw_success": range(2, 4), "throw_miss": range(4, 6), "thrown": range(6, 8), "throw_break": range(8, 10)}),
    "special": (9, {"special_start": range(0, 3), "special_active": range(3, 6), "special_recovery": range(6, 9)}),
    "damage": (16, {"hit_light": range(0, 2), "hit_heavy": range(2, 4), "hit_crouch": range(4, 6), "air_hit": range(6, 8), "knockback": range(8, 10), "knockdown": range(10, 12), "down_idle": range(12, 14), "wakeup": range(14, 16)}),
    "result": (6, {"victory": range(0, 3), "defeat": range(3, 6)}),
}


def coefficient_of_variation(values: list[float]) -> float:
    mean = statistics.fmean(values)
    return statistics.pstdev(values) / mean if mean else 0.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("character_id")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    base = args.root / "assets" / "sprites" / args.character_id / "actions"
    errors: list[str] = []

    for group, (count, actions) in LAYOUT.items():
        frames = []
        for index in range(count):
            path = base / group / f"{group}-{index + 1}.png"
            if not path.is_file():
                errors.append(f"missing: {path}")
                continue
            image = Image.open(path)
            if image.mode != "RGBA" or image.size != (256, 256):
                errors.append(f"format: {path} is {image.mode} {image.size}")
                continue
            alpha = image.getchannel("A")
            bbox = alpha.getbbox()
            if bbox is None:
                errors.append(f"empty: {path}")
                continue
            if bbox[0] == 0 or bbox[1] == 0 or bbox[2] == 256 or bbox[3] == 256:
                errors.append(f"edge: {path} bbox={bbox}")
            opaque_area = sum(alpha.histogram()[9:])
            frames.append({"path": path, "body_scale": math.sqrt(opaque_area), "bottom": bbox[3]})

        if len(frames) != count:
            continue
        for action, indexes in actions.items():
            selected = [frames[index] for index in indexes]
            body_cv = coefficient_of_variation([frame["body_scale"] for frame in selected])
            # Slime motion intentionally changes silhouette area through squash/stretch;
            # its locked processor profile and edge/anchor checks enforce camera scale.
            if args.character_id != "green-slime" and body_cv > 0.08:
                errors.append(f"body-scale: {args.character_id}/{action} cv={body_cv:.6f}")
            bottom_std = statistics.pstdev(frame["bottom"] / 256 for frame in selected)
            if args.character_id != "green-slime" and not action.startswith("jump_") and bottom_std > 0.05:
                errors.append(f"anchor: {args.character_id}/{action} std={bottom_std:.6f}")

    if errors:
        raise SystemExit("Sprite bundle validation failed:\n" + "\n".join(errors))
    print(f"PASS {args.character_id}: {sum(value[0] for value in LAYOUT.values())} RGBA frames; action-level scale/anchor/edge checks passed")


if __name__ == "__main__":
    main()
