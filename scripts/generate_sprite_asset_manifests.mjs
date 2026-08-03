import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const IDS = ["guitar-boy", "green-slime", "bob-girl", "uncle", "rusty", "kazushige", "norio", "toko"];
const GROUP_COUNTS = Object.freeze({
  idle: 4,
  movement: 12,
  crouch: 6,
  jump: 12,
  light_attacks: 12,
  heavy_attacks: 12,
  guard: 6,
  throw: 10,
  special: 9,
  damage: 16,
  result: 6,
  skill_body: 6,
});

function existingDirectories(characterRoot) {
  return ["source/action-production", "source/legacy-production", "source/root-tmp", "archive"]
    .filter((entry) => fs.existsSync(path.join(characterRoot, entry)));
}

for (const character of IDS) {
  const characterRoot = path.join(ROOT, "assets", "sprites", character);
  const runtimeFrames = Object.fromEntries(Object.entries(GROUP_COUNTS).map(([group, count]) => [
    group,
    Array.from({ length: count }, (_, index) => `actions/${group}/${group}-${index + 1}.png`),
  ]));
  for (const frames of Object.values(runtimeFrames)) {
    for (const frame of frames) {
      if (!fs.existsSync(path.join(characterRoot, frame))) throw new Error(`Missing runtime frame: ${character}/${frame}`);
    }
  }
  const manifest = {
    version: 1,
    character,
    status: "active",
    runtimeAuthority: "src/sprite-manifest.js",
    runtimeBase: "actions",
    runtimeFrames,
    canvasSize: [256, 256],
    anchor: [128, 233],
    compatibilityAssets: [
      "combat-1.png", "combat-2.png", "combat-3.png", "combat-4.png", "sheet-transparent.png",
    ],
    productionSourceRoots: existingDirectories(characterRoot),
    provenanceStatus: "partial",
    notes: [
      "Runtime action paths are intentionally unchanged.",
      "Files under source preserve production inputs, previews, QC outputs, and historical path names.",
      "Use docs/asset-organization-phase2-map-*.json to resolve pre-organization paths.",
    ],
  };
  fs.writeFileSync(path.join(characterRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
