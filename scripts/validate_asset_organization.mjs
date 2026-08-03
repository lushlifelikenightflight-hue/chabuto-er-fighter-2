import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const IDS = ["guitar-boy", "green-slime", "bob-girl", "uncle", "rusty", "kazushige", "norio", "toko"];
const MAPS = ["action-production", "legacy-production", "root-tmp"]
  .map((category) => path.join(ROOT, "docs", `asset-organization-phase2-map-${category}.json`));
const errors = [];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function filesBelow(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

for (const id of IDS) {
  const characterRoot = path.join(ROOT, "assets", "sprites", id);
  const actionsRoot = path.join(characterRoot, "actions");
  for (const file of filesBelow(actionsRoot)) {
    const relative = path.relative(actionsRoot, file).replaceAll("\\", "/");
    if (!/^([^/]+)\/\1-\d+\.png$/.test(relative) && relative !== "character-scale-profile.json") {
      errors.push(`non-runtime file remains in actions: ${id}/${relative}`);
    }
  }

  const manifestPath = path.join(characterRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    errors.push(`missing manifest: ${id}`);
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.character !== id || manifest.runtimeBase !== "actions") errors.push(`invalid manifest identity: ${id}`);
  for (const [group, frames] of Object.entries(manifest.runtimeFrames || {})) {
    for (const frame of frames) {
      if (!fs.existsSync(path.join(characterRoot, frame))) errors.push(`missing runtime frame: ${id}/${group}/${frame}`);
    }
  }
}

for (const mapPath of MAPS) {
  if (!fs.existsSync(mapPath)) {
    errors.push(`missing move map: ${path.basename(mapPath)}`);
    continue;
  }
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  if (map.mode !== "applied" || map.deletedFiles !== 0 || map.runtimePathsChanged !== false) {
    errors.push(`invalid move map summary: ${path.basename(mapPath)}`);
  }
  for (const move of map.moves) {
    const source = path.join(ROOT, move.source);
    const destination = path.join(ROOT, move.destination);
    if (fs.existsSync(source)) errors.push(`old path still exists: ${move.source}`);
    if (!fs.existsSync(destination)) errors.push(`moved file missing: ${move.destination}`);
    else if (sha256(destination) !== move.sha256) errors.push(`moved file hash changed: ${move.destination}`);
  }
}

for (const basename of fs.readdirSync(ROOT)) {
  if (/^tmp_(norio|toko)_.+_raw\.png$/.test(basename) || /^tmp_aligned_(norio|toko)_.+$/.test(basename)) {
    errors.push(`root intermediate remains: ${basename}`);
  }
}

const distSprites = path.join(ROOT, "dist", "client", "assets", "sprites");
if (fs.existsSync(distSprites)) {
  for (const file of filesBelow(distSprites)) {
    const relative = path.relative(distSprites, file).replaceAll("\\", "/");
    if (relative.includes("/source/") || relative.includes("/archive/")) errors.push(`production source copied to dist: ${relative}`);
  }
  for (const id of IDS) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "sprites", id, "manifest.json"), "utf8"));
    for (const frames of Object.values(manifest.runtimeFrames)) {
      for (const frame of frames) {
        if (!fs.existsSync(path.join(distSprites, id, frame))) errors.push(`dist runtime frame missing: ${id}/${frame}`);
      }
    }
  }
}

if (errors.length) throw new Error(`Asset organization validation failed:\n${errors.join("\n")}`);
console.log(`PASS: ${IDS.length} manifests, 984 moved files, unchanged runtime paths, no source/archive files in dist`);
