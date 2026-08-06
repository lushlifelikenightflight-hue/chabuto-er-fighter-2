/** Versioned, failure-tolerant localStorage helpers. */
import { normalizeControllerBindings } from "./controller-bindings.js";

export const STORAGE_KEY = "chabuto-er-fighter2.save.v1";
export const STORAGE_VERSION = 1;

export const DEFAULT_SAVE = Object.freeze({
  version: STORAGE_VERSION,
  sound: true,
  bgmEnabled: true,
  seEnabled: true,
  debug: false,
  highScores: [],
  last: null,
  controllerBindings: normalizeControllerBindings(),
});

function resolveStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function cloneDefault() {
  return {
    ...DEFAULT_SAVE,
    highScores: [],
    controllerBindings: normalizeControllerBindings(DEFAULT_SAVE.controllerBindings),
  };
}

export function validateSave(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return cloneDefault();
  const result = cloneDefault();
  result.version = STORAGE_VERSION;
  result.sound = value.sound !== false;
  result.bgmEnabled = value.bgmEnabled === undefined ? result.sound : value.bgmEnabled !== false;
  result.seEnabled = value.seEnabled === undefined ? result.sound : value.seEnabled !== false;
  result.debug = value.debug === true;
  result.highScores = Array.isArray(value.highScores) ? value.highScores.filter((row) => row && typeof row === "object").slice(0, 10).map((row) => ({
    score: Math.max(0, Number(row.score) || 0),
    rank: typeof row.rank === "string" ? row.rank.slice(0, 1) : "D",
    character: typeof row.character === "string" ? row.character : "",
    difficulty: typeof row.difficulty === "string" ? row.difficulty : "normal",
    color: row.color === 2 ? 2 : 1,
    durationMs: Math.max(0, Number(row.durationMs) || 0),
    timestamp: typeof row.timestamp === "string" ? row.timestamp : new Date(0).toISOString(),
  })) : [];
  result.last = value.last && typeof value.last === "object" ? { ...value.last } : null;
  result.controllerBindings = normalizeControllerBindings(value.controllerBindings);
  return result;
}

export function loadSave(storage) {
  const store = resolveStorage(storage);
  if (!store) return cloneDefault();
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return cloneDefault();
    return validateSave(JSON.parse(raw));
  } catch {
    return cloneDefault();
  }
}

export function saveData(value, storage) {
  const store = resolveStorage(storage);
  const normalized = validateSave(value);
  if (!store) return normalized;
  try { store.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch { /* private mode/quota: gameplay continues */ }
  return normalized;
}

export const saveSave = saveData;

export function resetSave(storage) {
  const store = resolveStorage(storage);
  if (store) {
    try { store.removeItem(STORAGE_KEY); } catch { /* ignore unavailable storage */ }
  }
  return cloneDefault();
}

export function appendHighScore(save, entry, storage) {
  const current = validateSave(save);
  current.highScores = [...current.highScores, {
    score: Math.max(0, Number(entry?.score) || 0),
    rank: typeof entry?.rank === "string" ? entry.rank.slice(0, 1) : "D",
    character: typeof entry?.character === "string" ? entry.character : "",
    difficulty: typeof entry?.difficulty === "string" ? entry.difficulty : "normal",
    color: entry?.color === 2 ? 2 : 1,
    durationMs: Math.max(0, Number(entry?.durationMs) || 0),
    timestamp: typeof entry?.timestamp === "string" ? entry.timestamp : new Date().toISOString(),
  }].sort((a, b) => b.score - a.score).slice(0, 10);
  current.last = { ...current.highScores[0] };
  saveData(current, storage);
  return current;
}

/** Small adapter useful to simulation tests and embedding hosts. */
export function safeStorage(storage) {
  return Object.freeze({
    load: () => loadSave(storage),
    save: (value) => saveData(value, storage),
    reset: () => resetSave(storage),
  });
}
