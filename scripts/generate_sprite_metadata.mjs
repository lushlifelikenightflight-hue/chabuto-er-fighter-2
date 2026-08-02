import fs from "node:fs";
import path from "node:path";
import { EXPANDED_FIGHTER_IDS, REQUIRED_ANIMATION_CLIPS, createExpandedAnimationManifest } from "../src/sprite-manifest.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const requestedIds = process.argv.slice(2);
const fighterIds = requestedIds.length ? requestedIds : EXPANDED_FIGHTER_IDS;

function attackPhases(name, frames) {
  if (!name.startsWith("light_") && !name.startsWith("heavy_")) return undefined;
  return {
    startup: frames.slice(0, 1),
    active: frames.slice(1, 2),
    recovery: frames.slice(2),
  };
}

for (const id of fighterIds) {
  const manifest = createExpandedAnimationManifest(id);
  if (!manifest) throw new Error(`Unsupported expanded fighter: ${id}`);
  const missing = REQUIRED_ANIMATION_CLIPS.flatMap((name) =>
    manifest[name].frames.filter((frame) => !fs.existsSync(path.join(projectRoot, frame))));
  if (missing.length) throw new Error(`${id} is missing ${missing.length} animation frames:\n${missing.join("\n")}`);

  const actions = Object.fromEntries(REQUIRED_ANIMATION_CLIPS.map((name) => {
    const clip = manifest[name];
    return [name, {
      group: clip.group,
      frames: clip.frames,
      frameDuration: clip.frameDuration,
      loop: clip.loop,
      origin: clip.origin,
      groundPoint: clip.groundPoint,
      ...(attackPhases(name, clip.frames) ? { phases: attackPhases(name, clip.frames) } : {}),
    }];
  }));
  const metadata = {
    version: 1,
    characterId: id,
    format: "PNG RGBA",
    cell: { width: 256, height: 256 },
    nearestNeighbor: true,
    sourceKeyframes: {
      idle: `assets/sprites/${id}/combat-1.png`,
      movement: `assets/sprites/${id}/combat-2.png`,
      lightStandActive: `assets/sprites/${id}/combat-3.png`,
      heavyStandOrSpecialActive: `assets/sprites/${id}/combat-4.png`,
    },
    actions,
  };
  const outputDir = path.join(projectRoot, "assets", "sprites", id, "metadata");
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, `${id}-animations.json`);
  fs.writeFileSync(output, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(path.relative(projectRoot, output));
}

