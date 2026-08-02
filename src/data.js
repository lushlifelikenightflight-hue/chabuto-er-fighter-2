import { REQUIRED_ANIMATION_CLIPS, createExpandedAnimationManifest } from "./sprite-manifest.js";

/**
 * Data-only definitions for 茶封筒erファイター2.
 * Every fighter uses the same runtime contract, while the values below keep
 * movement, reach, damage, and the unblockable special meaningfully distinct.
 */

export const GAME_TITLE = "茶封筒erファイター2";
export const INTERNAL_WIDTH = 480;
export const INTERNAL_HEIGHT = 270;
export const STAGE_BOUNDS = Object.freeze({ left: 24, right: 456, floor: 228, ceiling: 248 });
export const MAX_HP = 1000;
export const MAX_METER = 100;
export const ROUND_TIME_SECONDS = 60;
export const ROUNDS_TO_WIN = 2;

export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ id: "easy", label: "EASY", reactionFrames: 24, error: 0.34, guardRate: 0.26, justGuardRate: 0, comboMax: 2, continues: Infinity }),
  normal: Object.freeze({ id: "normal", label: "NORMAL", reactionFrames: 14, error: 0.2, guardRate: 0.43, justGuardRate: 0.08, comboMax: 4, continues: 3 }),
  hard: Object.freeze({ id: "hard", label: "HARD", reactionFrames: 7, error: 0.1, guardRate: 0.6, justGuardRate: 0.2, comboMax: 6, continues: 1 }),
});

export const ANIMATION_CLIPS = REQUIRED_ANIMATION_CLIPS;

export const ANIMATION_CONTRACT = Object.freeze(Object.fromEntries(
  ANIMATION_CLIPS.map((name, index) => [name, Object.freeze({
    name,
    // The generated 2x2 combat sheet is the authoritative visual source.
    // Runtime transforms provide timing and pose differences for the full
    // contract without replacing the supplied PNG art.
    frame: index % 4,
    frames: [index % 4],
    loop: ["idle", "walk_forward", "walk_backward", "crouch", "guard_high", "guard_low"].includes(name),
  })]),
));

const ARCHETYPES = Object.freeze({
  standard: { speed: 2.2, jump: 7.9, power: 1, reach: 1, defense: 1, air: 1, throw: 1, meter: 1, tint: "#f7c94a", special: "rush" },
  speed: { speed: 2.8, jump: 8.4, power: 0.86, reach: 0.92, defense: 0.88, air: 1.24, throw: 0.88, meter: 1.18, tint: "#62e8ff", special: "time" },
  power: { speed: 1.7, jump: 7.1, power: 1.28, reach: 1.08, defense: 1.15, air: 0.78, throw: 1.08, meter: 0.86, tint: "#ff875c", special: "ground" },
  reach: { speed: 2.0, jump: 7.6, power: 0.98, reach: 1.42, defense: 0.98, air: 0.94, throw: 0.92, meter: 1.04, tint: "#b997ff", special: "projectile" },
  air: { speed: 2.35, jump: 9.5, power: 0.93, reach: 1.02, defense: 0.9, air: 1.42, throw: 0.9, meter: 1.1, tint: "#72f2a7", special: "dive" },
  defense: { speed: 1.9, jump: 7.4, power: 1.02, reach: 1.03, defense: 1.35, air: 0.88, throw: 1.02, meter: 0.8, tint: "#9cc5d9", special: "antiAir" },
  throw: { speed: 2.05, jump: 7.6, power: 0.96, reach: 0.9, defense: 1.04, air: 0.98, throw: 1.5, meter: 1.0, tint: "#f28dc5", special: "commandThrow" },
  tricky: { speed: 2.42, jump: 8.2, power: 0.91, reach: 1.16, defense: 0.92, air: 1.16, throw: 1.12, meter: 1.12, tint: "#d7f76c", special: "delayed" },
});

const SPECIAL_TEXT = Object.freeze({
  rush: "封筒ブレイク",
  time: "秒針スライド",
  ground: "床鳴りクラッシュ",
  projectile: "紙片レールガン",
  dive: "急降下スタンプ",
  antiAir: "天井返し",
  commandThrow: "封印スープレックス",
  delayed: "どろどろ時限沼",
});

function box(x, y, w, h) { return { x, y, w, h }; }

function normalMove(name, archetype, overrides = {}) {
  const isLight = name.includes("light");
  const isAir = name.includes("air");
  const isCrouch = name.includes("crouch");
  const reach = (isLight ? 34 : 46) * archetype.reach;
  return {
    id: name,
    kind: "normal",
    startupFrames: isLight ? 5 : 10,
    activeFrames: isLight ? 3 : 4,
    recoveryFrames: isLight ? 8 : 16,
    damage: Math.round((isLight ? 48 : 106) * archetype.power * (isAir ? 0.9 : 1)),
    chipDamage: isLight ? 4 : 9,
    hitstunFrames: isLight ? 15 : 24,
    blockstunFrames: isLight ? 10 : 17,
    knockbackX: isLight ? 1.8 : 4.3,
    knockbackY: isAir ? 2.2 : (isLight ? 0.5 : 1.5),
    hitLevel: isCrouch ? "low" : (isAir ? "overhead" : "mid"),
    cancelRoutes: isLight ? ["light_attack_neutral", "light_attack_crouch", "strong_attack_neutral"] : ["special"],
    hitboxFrames: [isLight ? 5 : 10, isLight ? 6 : 11, isLight ? 7 : 12],
    hurtboxProfile: isCrouch ? "crouch" : (isAir ? "air" : "standing"),
    meterGainOnHit: isLight ? 4 : 7,
    meterGainOnBlock: isLight ? 2 : 3,
    scoreValue: isLight ? 100 : 250,
    hitbox: box(22, isAir ? 68 : 84, reach, isAir ? 25 : 20),
    ...overrides,
  };
}

function makeSpecial(archetype, id, index) {
  const profile = {
    rush: { hitbox: box(30, 79, 76, 28), startupFrames: 18, activeFrames: 8, recoveryFrames: 28, damage: 310, movement: 4.7 },
    time: { hitbox: box(30, 83, 62, 26), startupFrames: 14, activeFrames: 10, recoveryFrames: 22, damage: 280, movement: 6.2 },
    ground: { hitbox: box(18, 104, 150, 18), startupFrames: 24, activeFrames: 8, recoveryFrames: 34, damage: 350, movement: 1.1 },
    projectile: { hitbox: box(30, 95, 110, 18), startupFrames: 20, activeFrames: 24, recoveryFrames: 30, damage: 260, movement: 0 },
    dive: { hitbox: box(24, 82, 58, 42), startupFrames: 16, activeFrames: 12, recoveryFrames: 24, damage: 300, movement: 3.8 },
    antiAir: { hitbox: box(20, 36, 58, 76), startupFrames: 11, activeFrames: 10, recoveryFrames: 28, damage: 295, movement: 1.2 },
    commandThrow: { hitbox: box(14, 73, 42, 30), startupFrames: 22, activeFrames: 5, recoveryFrames: 36, damage: 390, movement: 2.4 },
    delayed: { hitbox: box(10, 102, 118, 24), startupFrames: 30, activeFrames: 12, recoveryFrames: 26, damage: 325, movement: 0 },
  }[archetype.special];
  return {
    id: "special",
    name: SPECIAL_TEXT[archetype.special],
    kind: "special",
    specialType: archetype.special,
    unblockable: true,
    justGuardable: false,
    throwInvulnerable: false,
    meterCost: 100,
    telegraphFrames: 16 + index,
    ...profile,
    chipDamage: 0,
    hitstunFrames: 40,
    blockstunFrames: 0,
    knockbackX: 7,
    knockbackY: 5,
    hitLevel: "unblockable",
    cancelRoutes: [],
    hitboxFrames: [profile.startupFrames, profile.startupFrames + 1],
    hurtboxProfile: "special",
    meterGainOnHit: 0,
    meterGainOnBlock: 0,
    scoreValue: 2000,
  };
}

function makeMoves(archetype, index) {
  const moves = {
    light_attack_neutral: normalMove("light_attack_neutral", archetype),
    light_attack_crouch: normalMove("light_attack_crouch", archetype),
    light_attack_air: normalMove("light_attack_air", archetype),
    strong_attack_neutral: normalMove("strong_attack_neutral", archetype),
    strong_attack_crouch: normalMove("strong_attack_crouch", archetype),
    strong_attack_air: normalMove("strong_attack_air", archetype),
    special: makeSpecial(archetype, "special", index),
  };
  // Friendly aliases keep the data API ergonomic for tools and tests.
  return { ...moves, light: moves.light_attack_neutral, strong: moves.strong_attack_neutral };
}

const CHARACTER_ROWS = [
  ["guitar-boy", "ギター少年", "standard"],
  ["green-slime", "どろどろスライム", "tricky"],
  ["bob-girl", "ボブの女の子", "speed"],
  ["uncle", "おじさん", "defense"],
  ["rusty", "らすてぃー", "power"],
  ["kazushige", "かずしげ", "reach"],
  ["norio", "のりお", "air"],
  ["toko", "トコ", "throw"],
];

function createCharacter([id, name, archetypeName], index) {
  const archetype = ARCHETYPES[archetypeName];
  const palette1 = [archetype.tint, "#f5f1d6", "#1d2433", "#d94c54"];
  const palette2 = ["#f4f4f4", archetype.tint, "#16121d", "#47a6d4"];
  const fallbackAnimation = Object.fromEntries(ANIMATION_CLIPS.map((clip) => [clip, {
    ...ANIMATION_CONTRACT[clip],
    frames: [ANIMATION_CONTRACT[clip].frame],
    sheet: `assets/sprites/${id}/sheet-transparent.png`,
    combatFrames: [1, 2, 3, 4],
  }]));
  const animation = createExpandedAnimationManifest(id) || fallbackAnimation;
  return Object.freeze({
    id,
    name,
    displayName: name,
    archetype: archetypeName,
    type: archetypeName,
    sprite: Object.freeze({
      sheet: `assets/sprites/${id}/sheet-transparent.png`,
      frames: [1, 2, 3, 4].map((frame) => `assets/sprites/${id}/combat-${frame}.png`),
      cellWidth: 256,
      cellHeight: 256,
      anchor: { x: 128, y: 233 },
      nearestNeighbor: true,
    }),
    palettes: Object.freeze({ color1: palette1, color2: palette2 }),
    stats: Object.freeze({
      hp: MAX_HP,
      speed: archetype.speed,
      jumpVelocity: archetype.jump,
      power: archetype.power,
      reach: archetype.reach,
      defense: archetype.defense,
      airControl: archetype.air,
      throwPower: archetype.throw,
      meterGain: archetype.meter,
    }),
    moves: Object.freeze(makeMoves(archetype, index)),
    special: Object.freeze(makeSpecial(archetype, id, index)),
    cpu: Object.freeze({
      preferredDistance: 48 + index * 3,
      aggression: 0.38 + (index % 3) * 0.13,
      antiAir: archetype.air > 1.15,
      throwBias: archetype.throw > 1.2,
    }),
    poses: Object.freeze({ victory: 3, defeat: 4 }),
    animation: Object.freeze(animation),
  });
}

export const CHARACTERS = Object.freeze(Object.fromEntries(CHARACTER_ROWS.map((row, index) => [row[0], createCharacter(row, index)])));
export const CHARACTER_IDS = Object.freeze(CHARACTER_ROWS.map(([id]) => id));
export const CHARACTER_NAMES = Object.freeze(CHARACTER_ROWS.map(([, name]) => name));

export const STAGES = Object.freeze([
  Object.freeze({ number: 1, id: "toko", name: "トコ戦", opponent: "toko", background: "assets/stages/stage-toko.png" }),
  Object.freeze({ number: 2, id: "norio", name: "のりお戦", opponent: "norio", background: "assets/stages/stage-norio.png" }),
  Object.freeze({ number: 3, id: "kazushige", name: "かずしげ戦", opponent: "kazushige", background: "assets/stages/stage-kazushige.png" }),
  Object.freeze({ number: 4, id: "rusty", name: "らすてぃー戦", opponent: "rusty", background: "assets/stages/stage-rusty.png" }),
  Object.freeze({ number: 5, id: "mirror", name: "ミラーマッチ", opponent: "mirror", background: "assets/stages/stage-mirror.png" }),
]);

export const MENU_ITEMS = Object.freeze(["GAME START", "TRAINING MODE", "HOW TO PLAY", "SCORE", "SETTINGS"]);
export const SETTINGS_ITEMS = Object.freeze(["SOUND", "BGM", "SE", "DEBUG OVERLAY", "RESET DATA", "BACK"]);
export const TRAINING_SETTINGS_ITEMS = Object.freeze(["CPU MOVE", "CPU ATTACK", "START TRAINING", "BACK"]);

export function getOpponentId(stageNumber, selectedId) {
  const stage = STAGES[Math.max(1, Math.min(STAGES.length, stageNumber)) - 1];
  return stage.opponent === "mirror" ? selectedId : stage.opponent;
}

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.normal;
}
