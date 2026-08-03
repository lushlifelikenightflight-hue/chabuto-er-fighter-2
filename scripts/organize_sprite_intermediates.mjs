import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const IDS = Object.freeze([
  "guitar-boy", "green-slime", "bob-girl", "uncle",
  "rusty", "kazushige", "norio", "toko",
]);
const TOP_LEVEL_INTERMEDIATES = new Set([
  "animation.gif", "pipeline-meta.json", "raw-sheet-clean.png", "raw-sheet.png",
]);
const APPLY = process.argv.includes("--apply");
const categoryArgument = process.argv.find((argument) => argument.startsWith("--category="));
const CATEGORY = categoryArgument?.slice("--category=".length) || null;
const MAP_PATH = path.join(ROOT, "docs", `asset-organization-phase2-map-${CATEGORY || "all"}.json`);
if (APPLY && !CATEGORY) throw new Error("--apply requires --category=action-production|legacy-production|root-tmp");

function normalize(value) {
  return value.replaceAll("\\", "/");
}

function relative(absolute) {
  return normalize(path.relative(ROOT, absolute));
}

function filesBelow(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function trackedPaths() {
  return new Set(execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).split("\0").filter(Boolean).map(normalize));
}

function addMove(plan, tracked, category, source, destination) {
  if (!fs.existsSync(source)) return;
  if (!fs.statSync(source).isFile()) throw new Error(`Expected file: ${relative(source)}`);
  plan.push({
    category,
    source: relative(source),
    destination: relative(destination),
    tracked: tracked.has(relative(source)),
    sizeBytes: fs.statSync(source).size,
    sha256: sha256(source),
  });
}

function createPlan() {
  const tracked = trackedPaths();
  const plan = [];

  for (const id of IDS) {
    const characterRoot = path.join(ROOT, "assets", "sprites", id);
    const actionsRoot = path.join(characterRoot, "actions");
    for (const source of filesBelow(actionsRoot)) {
      const actionRelative = normalize(path.relative(actionsRoot, source));
      const canonical = /^([^/]+)\/\1-\d+\.png$/.test(actionRelative)
        || actionRelative === "character-scale-profile.json";
      if (canonical) continue;
      addMove(
        plan,
        tracked,
        "action-production",
        source,
        path.join(characterRoot, "source", "action-production", actionRelative),
      );
    }

    for (const basename of TOP_LEVEL_INTERMEDIATES) {
      addMove(
        plan,
        tracked,
        "legacy-production",
        path.join(characterRoot, basename),
        path.join(characterRoot, "source", "legacy-production", basename),
      );
    }
  }

  for (const basename of fs.readdirSync(ROOT)) {
    const raw = /^tmp_(norio|toko)_.+_raw\.png$/.exec(basename);
    if (raw) {
      const id = raw[1];
      addMove(
        plan,
        tracked,
        "root-tmp",
        path.join(ROOT, basename),
        path.join(ROOT, "assets", "sprites", id, "source", "root-tmp", basename),
      );
      continue;
    }
    const aligned = /^tmp_aligned_(norio|toko)_.+$/.exec(basename);
    if (aligned) {
      const id = aligned[1];
      const directory = path.join(ROOT, basename);
      for (const source of filesBelow(directory)) {
        addMove(
          plan,
          tracked,
          "root-tmp",
          source,
          path.join(ROOT, "assets", "sprites", id, "source", "root-tmp", basename, path.relative(directory, source)),
        );
      }
    }
  }

  const imagegenRoot = path.join(ROOT, "tmp", "imagegen");
  if (fs.existsSync(imagegenRoot)) {
    for (const dirname of fs.readdirSync(imagegenRoot)) {
      const match = /^(guitar-boy|green-slime|bob-girl|uncle|rusty|kazushige|norio|toko)-skill(?:-repair)?$/.exec(dirname);
      if (!match) continue;
      const id = match[1];
      const directory = path.join(imagegenRoot, dirname);
      for (const source of filesBelow(directory)) {
        addMove(
          plan,
          tracked,
          "root-tmp",
          source,
          path.join(ROOT, "assets", "sprites", id, "source", "root-tmp", "imagegen", dirname, path.relative(directory, source)),
        );
      }
    }
  }

  const norioReview = path.join(ROOT, "tmp", "review-norio-skill-shift");
  for (const source of filesBelow(norioReview)) {
    addMove(
      plan,
      tracked,
      "root-tmp",
      source,
      path.join(ROOT, "assets", "sprites", "norio", "source", "root-tmp", "review-norio-skill-shift", path.relative(norioReview, source)),
    );
  }

  plan.sort((left, right) => left.source.localeCompare(right.source));
  const duplicateSources = plan.filter((item, index) => plan.findIndex((candidate) => candidate.source === item.source) !== index);
  const duplicateDestinations = plan.filter((item, index) => plan.findIndex((candidate) => candidate.destination === item.destination) !== index);
  if (duplicateSources.length || duplicateDestinations.length) throw new Error("Move plan contains duplicate paths");
  for (const item of plan) {
    if (fs.existsSync(path.join(ROOT, item.destination))) throw new Error(`Destination exists: ${item.destination}`);
  }
  return plan;
}

function removeEmptyDirectories(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(path.join(directory, entry.name));
  }
  if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
}

function move(item, reverse = false) {
  const sourceRelative = reverse ? item.destination : item.source;
  const destinationRelative = reverse ? item.source : item.destination;
  const source = path.join(ROOT, sourceRelative);
  const destination = path.join(ROOT, destinationRelative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (item.tracked) {
    execFileSync("git", ["mv", "--", sourceRelative, destinationRelative], { cwd: ROOT, stdio: "pipe" });
  } else {
    fs.renameSync(source, destination);
  }
}

function summarize(plan) {
  const categories = [...new Set(plan.map((item) => item.category))];
  const byCategory = Object.fromEntries(categories.map((category) => {
    const selected = plan.filter((item) => item.category === category);
    return [category, {
      files: selected.length,
      bytes: selected.reduce((sum, item) => sum + item.sizeBytes, 0),
    }];
  }));
  return {
    version: 1,
    mode: APPLY ? "applied" : "dry-run",
    runtimePathsChanged: false,
    deletedFiles: 0,
    files: plan.length,
    bytes: plan.reduce((sum, item) => sum + item.sizeBytes, 0),
    trackedFiles: plan.filter((item) => item.tracked).length,
    untrackedFiles: plan.filter((item) => !item.tracked).length,
    byCategory,
  };
}

const fullPlan = createPlan();
const plan = CATEGORY ? fullPlan.filter((item) => item.category === CATEGORY) : fullPlan;
if (CATEGORY && plan.length === 0) throw new Error(`No moves found for category: ${CATEGORY}`);
const summary = summarize(plan);
if (!APPLY) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });
fs.writeFileSync(MAP_PATH, `${JSON.stringify({ ...summary, mode: "planned", moves: plan }, null, 2)}\n`, "utf8");
const completed = [];
try {
  for (const item of plan) {
    move(item);
    completed.push(item);
  }
} catch (error) {
  for (const item of completed.reverse()) {
    try { move(item, true); } catch { /* The map still identifies recovery paths. */ }
  }
  throw error;
}

for (const id of IDS) removeEmptyDirectories(path.join(ROOT, "assets", "sprites", id, "actions"));
for (const basename of fs.readdirSync(ROOT)) {
  if (/^tmp_aligned_(norio|toko)_.+$/.test(basename)) removeEmptyDirectories(path.join(ROOT, basename));
}
const imagegenRootAfterMove = path.join(ROOT, "tmp", "imagegen");
if (fs.existsSync(imagegenRootAfterMove)) {
  for (const dirname of fs.readdirSync(imagegenRootAfterMove)) {
    if (/^(guitar-boy|green-slime|bob-girl|uncle|rusty|kazushige|norio|toko)-skill(?:-repair)?$/.test(dirname)) {
      removeEmptyDirectories(path.join(imagegenRootAfterMove, dirname));
    }
  }
}
removeEmptyDirectories(path.join(ROOT, "tmp", "review-norio-skill-shift"));

fs.writeFileSync(MAP_PATH, `${JSON.stringify({ ...summary, moves: plan }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, map: relative(MAP_PATH) }, null, 2));
