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
  standard: { hp: 1000, speed: 2.2, jump: 7.9, power: 1, reach: 1, defense: 1, air: 1, throw: 1, meter: 1, tint: "#f7c94a", special: "rush" },
  speed: { hp: 880, speed: 2.8, jump: 8.4, power: 0.86, reach: 0.92, defense: 0.88, air: 1.24, throw: 0.88, meter: 1.18, tint: "#62e8ff", special: "time" },
  power: { hp: 1120, speed: 1.7, jump: 7.1, power: 1.28, reach: 1.08, defense: 1.15, air: 0.78, throw: 1.08, meter: 0.86, tint: "#ff875c", special: "ground" },
  reach: { hp: 960, speed: 2.0, jump: 7.6, power: 0.98, reach: 1.42, defense: 0.98, air: 0.94, throw: 0.92, meter: 1.04, tint: "#b997ff", special: "projectile" },
  air: { hp: 900, speed: 2.35, jump: 9.5, power: 0.93, reach: 1.02, defense: 0.9, air: 1.42, throw: 0.9, meter: 1.1, tint: "#72f2a7", special: "dive" },
  defense: { hp: 1180, speed: 1.9, jump: 7.4, power: 1.02, reach: 1.03, defense: 1.35, air: 0.88, throw: 1.02, meter: 0.8, tint: "#9cc5d9", special: "antiAir" },
  throw: { hp: 1040, speed: 2.05, jump: 7.6, power: 0.96, reach: 0.9, defense: 1.04, air: 0.98, throw: 1.5, meter: 1.0, tint: "#f28dc5", special: "commandThrow" },
  tricky: { hp: 940, speed: 2.42, jump: 8.2, power: 0.91, reach: 1.16, defense: 0.92, air: 1.16, throw: 1.12, meter: 1.12, tint: "#d7f76c", special: "delayed" },
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

export const NORMAL_ATTACK_REACH_MULTIPLIER = 1.75;

function complementaryHueHex(hex) {
  const value = String(hex || "").replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return hex;
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  const max = Math.max(...channels); const min = Math.min(...channels); const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return `#${value}`;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = max === channels[0] ? ((channels[1] - channels[2]) / delta) % 6 : max === channels[1] ? (channels[2] - channels[0]) / delta + 2 : (channels[0] - channels[1]) / delta + 4;
  hue = (hue * 60 + 180) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const match = lightness - chroma / 2;
  const rgb = hue < 60 ? [chroma, secondary, 0] : hue < 120 ? [secondary, chroma, 0] : hue < 180 ? [0, chroma, secondary] : hue < 240 ? [0, secondary, chroma] : hue < 300 ? [secondary, 0, chroma] : [chroma, 0, secondary];
  return `#${rgb.map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Normalize authored combat data without coupling the visual effect to the
 * collision geometry.  Older callers still receive `hitbox`, while the
 * explicit fields are the canonical values for new systems.
 */
function normalizeMove(move, archetype, index = 0) {
  const kind = move.kind || "normal";
  const id = move.id || "move";
  const isSpecial = kind === "special" || id === "special";
  const isLight = id.includes("light") && !id.includes("strong");
  const isStrong = id.includes("strong") || id.includes("forward_light") || isSpecial;
  const isAir = id.includes("air");
  const hit = move.hitbox || box(0, 0, 0, 0);
  const legacyWidth = Number.isFinite(hit.w) ? hit.w : 0;
  const legacyHeight = Number.isFinite(hit.h) ? hit.h : 0;
  // Normals retain their previous light/heavy reach shaping, then receive the
  // explicit 1.75 multiplier at authoring time. This makes the new hitbox
  // genuinely 1.75x the former runtime width while the tip-anchored VFX stays
  // aligned with the resulting collision edge.
  const widthBias = isSpecial ? (id === "special" ? 1.08 + (index % 3) * 0.03 : 1.06) : isStrong ? 1.2 : 1.1;
  const hitboxWidth = Math.max(1, Math.round((move.hitboxWidth ?? legacyWidth) * widthBias));
  const heightBias = isSpecial ? 1.06 : isAir ? 1.04 : isStrong ? 1.03 : 1.02;
  const hitboxHeight = Math.max(1, Math.round((move.hitboxHeight ?? legacyHeight) * heightBias));
  const hitboxOffsetX = Number.isFinite(move.hitboxOffsetX) ? move.hitboxOffsetX : (Number.isFinite(hit.x) ? hit.x : 0);
  const hitboxOffsetY = Number.isFinite(move.hitboxOffsetY) ? move.hitboxOffsetY : (Number.isFinite(hit.y) ? hit.y : 0);
  const knockdownValue = Number.isFinite(move.knockdownValue) ? move.knockdownValue :
    (isSpecial ? 100 : id.includes("strong_attack_air") ? 34 : id.includes("strong_attack") ? 30 : id.includes("forward_light") ? 18 : isLight ? 8 : 14);
  const causesKnockdown = move.causesKnockdown ?? (isSpecial || id.includes("strong_attack_neutral") || id.includes("strong_attack_air"));
  const hardKnockdown = move.hardKnockdown ?? isSpecial;
  const effectId = move.effectId || (isSpecial ? `special-${archetype.special}` : id.includes("forward_light") ? `attack-kick-${archetype.special}` : id.includes("strong") ? `attack-heavy-${archetype.special}` : id.includes("light") ? `attack-light-${archetype.special}` : `attack-${kind}-${archetype.special}`);
  const effectScale = Number.isFinite(move.effectScale) ? move.effectScale :
    (isSpecial ? 1.5 + (index % 3) * 0.08 : isStrong ? 1.15 + (index % 2) * 0.06 : isLight ? 0.9 + (index % 3) * 0.04 : 1);
  const effectOffsetX = Number.isFinite(move.effectOffsetX) ? move.effectOffsetX :
    Math.round(hitboxOffsetX + hitboxWidth * (isSpecial ? 0.34 : isStrong ? 0.28 : 0.18));
  const effectOffsetY = Number.isFinite(move.effectOffsetY) ? move.effectOffsetY :
    Math.round(hitboxOffsetY + hitboxHeight * (isAir ? 0.24 : 0.18));
  return {
    ...move,
    knockdownValue,
    causesKnockdown: Boolean(causesKnockdown),
    hardKnockdown: Boolean(hardKnockdown),
    effectId,
    effectScale,
    effectOffsetX,
    effectOffsetY,
    hitboxWidth,
    hitboxHeight,
    hitboxOffsetX,
    hitboxOffsetY,
    // Keep this legacy alias synchronized, but as a distinct object so
    // changing VFX descriptors never mutates hit detection data.
    hitbox: box(hitboxOffsetX, hitboxOffsetY, hitboxWidth, hitboxHeight),
  };
}

function normalMove(name, archetype, overrides = {}) {
  const isLight = name.includes("light");
  const isAir = name.includes("air");
  const isCrouch = name.includes("crouch");
  const reach = (isLight ? 34 : 46) * archetype.reach * NORMAL_ATTACK_REACH_MULTIPLIER;
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
    wakeupAttackInvulnerableFrames: isCrouch ? 8 : 0,
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
  return normalizeMove({
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
    // The cinematic is a presentation-only freeze.  Once it ends, the move
    // uses its authored profile timing so it remains responsive in combat.
    startupFrames: profile.startupFrames,
    activeFrames: profile.activeFrames,
    recoveryFrames: profile.recoveryFrames,
    hitbox: box(profile.hitbox.x, profile.hitbox.y, profile.hitbox.w * 5, profile.hitbox.h),
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
  }, archetype, index);
}

function makeMoves(archetype, index) {
  const commandProfiles = {
    rush: { name: "ギタースライド", damage: 78, startupFrames: 7, activeFrames: 4, recoveryFrames: 12, reach: 48, movement: 1.8, knockbackX: 3.2, hitLevel: "mid", animation: "light_stand" },
    delayed: { name: "のびるどろパンチ", damage: 68, startupFrames: 9, activeFrames: 6, recoveryFrames: 13, reach: 70, movement: 0.7, knockbackX: 2.6, hitLevel: "mid", animation: "heavy_stand" },
    time: { name: "ボブステップキック", damage: 62, startupFrames: 5, activeFrames: 3, recoveryFrames: 10, reach: 42, movement: 2.4, knockbackX: 2.8, hitLevel: "mid", animation: "light_stand" },
    antiAir: { name: "おじさん掌底", damage: 88, startupFrames: 8, activeFrames: 4, recoveryFrames: 15, reach: 40, movement: 1.1, knockbackX: 4.1, hitLevel: "mid", animation: "heavy_stand" },
    ground: { name: "フランスパン二塁打", damage: 104, startupFrames: 11, activeFrames: 5, recoveryFrames: 18, reach: 55, movement: 1.2, knockbackX: 5.2, hitLevel: "overhead", animation: "heavy_stand" },
    projectile: { name: "ロングリーチピック", damage: 74, startupFrames: 8, activeFrames: 5, recoveryFrames: 14, reach: 82, movement: 0.5, knockbackX: 3.4, hitLevel: "mid", animation: "light_stand" },
    dive: { name: "のりお昇り打ち", damage: 72, startupFrames: 6, activeFrames: 5, recoveryFrames: 15, reach: 46, movement: 1.5, knockbackX: 2.8, knockbackY: 3.8, hitLevel: "mid", animation: "heavy_stand" },
    commandThrow: { name: "トコ踏み込み蹴り", damage: 82, startupFrames: 7, activeFrames: 4, recoveryFrames: 13, reach: 44, movement: 2.0, knockbackX: 3.8, hitLevel: "low", animation: "light_stand" },
  };
  const command = commandProfiles[archetype.special];
  const moves = {
    light_attack_neutral: normalMove("light_attack_neutral", archetype),
    light_attack_crouch: normalMove("light_attack_crouch", archetype),
    light_attack_air: normalMove("light_attack_air", archetype),
    strong_attack_neutral: normalMove("strong_attack_neutral", archetype),
    strong_attack_crouch: normalMove("strong_attack_crouch", archetype),
    strong_attack_air: normalMove("strong_attack_air", archetype),
    forward_light: normalMove("forward_light", archetype, {
      name: command.name,
      startupFrames: command.startupFrames,
      activeFrames: command.activeFrames,
      recoveryFrames: command.recoveryFrames,
      damage: Math.round(command.damage * archetype.power),
      knockbackX: command.knockbackX,
      knockbackY: command.knockbackY || 0.8,
      hitLevel: command.hitLevel,
      movement: command.movement,
      animation: command.animation,
      hitboxFrames: Array.from({ length: command.activeFrames }, (_, frame) => command.startupFrames + frame),
      hitbox: box(22, 82, command.reach * archetype.reach * NORMAL_ATTACK_REACH_MULTIPLIER, 24),
      scoreValue: 180,
    }),
    special: makeSpecial(archetype, "special", index),
  };
  const normalized = Object.fromEntries(Object.entries(moves).map(([id, move]) => [id, move.kind === "special" ? move : normalizeMove(move, archetype, index)]));
  // Friendly aliases keep the data API ergonomic for tools and tests.
  return { ...normalized, light: normalized.light_attack_neutral, strong: normalized.strong_attack_neutral };
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

// Explicit combat-facing stats.  The legacy aliases below remain the source
// used by the existing renderer/AI, while these fields provide stable values
// for the upgraded combat systems.
export const COMBAT_STATS = Object.freeze({
  "guitar-boy": { maxHp: 1000, walkSpeed: 2.2, dashSpeed: 5.2, backstepDistance: 42, jumpPower: 7.9, airControl: 1, lightDamage: 48, heavyDamage: 106, attackStartupModifier: 1, attackRecoveryModifier: 1, comboLimit: 6, hitstunScaling: 1, guardStun: 10, throwDamage: 150, specialGainRate: 1, skillChargeRate: 1, weight: 1, knockdownResistance: 1 },
  "green-slime": { maxHp: 940, walkSpeed: 2.42, dashSpeed: 5.8, backstepDistance: 40, jumpPower: 8.2, airControl: 1.16, lightDamage: 43, heavyDamage: 97, attackStartupModifier: 0.94, attackRecoveryModifier: 0.94, comboLimit: 7, hitstunScaling: 0.92, guardStun: 9, throwDamage: 168, specialGainRate: 1.12, skillChargeRate: 1.2, weight: 0.92, knockdownResistance: 0.9 },
  "bob-girl": { maxHp: 880, walkSpeed: 2.8, dashSpeed: 6.5, backstepDistance: 38, jumpPower: 8.4, airControl: 1.24, lightDamage: 40, heavyDamage: 91, attackStartupModifier: 0.86, attackRecoveryModifier: 0.9, comboLimit: 8, hitstunScaling: 0.9, guardStun: 8, throwDamage: 132, specialGainRate: 1.18, skillChargeRate: 1.25, weight: 0.82, knockdownResistance: 0.84 },
  uncle: { maxHp: 1180, walkSpeed: 1.9, dashSpeed: 4.5, backstepDistance: 34, jumpPower: 7.4, airControl: 0.88, lightDamage: 50, heavyDamage: 114, attackStartupModifier: 1.1, attackRecoveryModifier: 1.12, comboLimit: 4, hitstunScaling: 1.12, guardStun: 13, throwDamage: 153, specialGainRate: 0.84, skillChargeRate: 0.86, weight: 1.24, knockdownResistance: 1.2 },
  rusty: { maxHp: 1120, walkSpeed: 1.7, dashSpeed: 4.1, backstepDistance: 32, jumpPower: 7.1, airControl: 0.78, lightDamage: 58, heavyDamage: 136, attackStartupModifier: 1.18, attackRecoveryModifier: 1.24, comboLimit: 3, hitstunScaling: 1.2, guardStun: 14, throwDamage: 162, specialGainRate: 0.8, skillChargeRate: 0.8, weight: 1.3, knockdownResistance: 1.26 },
  kazushige: { maxHp: 960, walkSpeed: 2, dashSpeed: 4.8, backstepDistance: 36, jumpPower: 7.6, airControl: 0.94, lightDamage: 47, heavyDamage: 103, attackStartupModifier: 1.03, attackRecoveryModifier: 1.04, comboLimit: 5, hitstunScaling: 1.04, guardStun: 11, throwDamage: 138, specialGainRate: 1.04, skillChargeRate: 1, weight: 1.05, knockdownResistance: 1.06 },
  norio: { maxHp: 900, walkSpeed: 2.35, dashSpeed: 5.7, backstepDistance: 40, jumpPower: 9.5, airControl: 1.42, lightDamage: 44, heavyDamage: 98, attackStartupModifier: 0.94, attackRecoveryModifier: 0.96, comboLimit: 6, hitstunScaling: 0.95, guardStun: 9, throwDamage: 135, specialGainRate: 1.1, skillChargeRate: 1.15, weight: 0.9, knockdownResistance: 0.9 },
  toko: { maxHp: 1040, walkSpeed: 2.05, dashSpeed: 5, backstepDistance: 35, jumpPower: 7.6, airControl: 0.98, lightDamage: 46, heavyDamage: 100, attackStartupModifier: 1, attackRecoveryModifier: 1, comboLimit: 5, hitstunScaling: 1, guardStun: 10, throwDamage: 225, specialGainRate: 1, skillChargeRate: 1, weight: 1.1, knockdownResistance: 1.06 },
});

function createCharacter([id, name, archetypeName], index) {
  const archetype = ARCHETYPES[archetypeName];
  const combat = COMBAT_STATS[id] || COMBAT_STATS["guitar-boy"];
  const palette1 = [archetype.tint, "#f5f1d6", "#1d2433", "#d94c54"];
  const palette2 = palette1.map(complementaryHueHex);
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
    normalAttackVfx: Object.freeze(({
      "guitar-boy": { color: "#a855f7", scale: 1.0 },
      "green-slime": { color: "#22d3ee", scale: 0.7, offsetY: -22 },
      "bob-girl": { color: "#ff75b5", scale: 1.2 },
      uncle: { color: "#8b5a2b", scale: 0.8 },
      rusty: { color: "#dc2626", scale: 0.9 },
      kazushige: { color: "#111111", scale: 1.1 },
      norio: { color: "#facc15", scale: 0.9 },
      toko: { color: "#22c55e", scale: 1.1 },
    })[id]),
    stats: Object.freeze({
      // Legacy aliases (hp/speed/jumpVelocity/etc.) intentionally remain
      // stable for the current renderer and AI.
      hp: archetype.hp,
      speed: archetype.speed,
      jumpVelocity: archetype.jump,
      power: archetype.power,
      reach: archetype.reach,
      defense: archetype.defense,
      airControl: archetype.air,
      throwPower: archetype.throw,
      meterGain: archetype.meter,
      ...combat,
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
// Stable data extraction surface for result/stat screens and tooling.
export const FIGHTER_STATS_DAMAGE = Object.freeze(Object.fromEntries(CHARACTER_IDS.map((id) => {
  const fighter = CHARACTERS[id];
  return [id, Object.freeze({ stats: fighter.stats, damage: Object.freeze({ light: fighter.moves.light.damage, heavy: fighter.moves.strong.damage, throw: fighter.stats.throwDamage, special: fighter.special.damage }) })];
})));

export const STAGES = Object.freeze([
  Object.freeze({ number: 1, id: "toko", name: "トコ戦", opponent: "toko", dialogue: "メンバーサイン付き写真２万８千円になりまーす！", background: "assets/stages/stage-toko.png", platforms: Object.freeze([{ x: 58, w: 34, y: 42, label: "PODIUM", asset: "light-podium" }, { x: 384, w: 38, y: 42, label: "LADDER", asset: "step-ladder" }]) }),
  Object.freeze({ number: 2, id: "norio", name: "のりお戦", opponent: "norio", dialogue: "始めます。", background: "assets/stages/stage-norio.png", platforms: Object.freeze([{ x: 20, w: 81, y: 70, label: "AMP", asset: "amp" }, { x: 404, w: 48, y: 42, label: "AMP", asset: "amp" }]) }),
  Object.freeze({ number: 3, id: "kazushige", name: "かずしげ戦", opponent: "kazushige", dialogue: "どうも,かずしげです", background: "assets/stages/stage-kazushige.png", platforms: Object.freeze([{ x: 96, w: 132, y: 116, label: "STALL", asset: "ramen-stand" }, { x: 252, w: 132, y: 116, label: "STALL", asset: "ramen-stand" }]) }),
  Object.freeze({ number: 4, id: "rusty", name: "らすてぃー戦", opponent: "rusty", dialogue: "今日も一日　フランスパンで二塁打", background: "assets/stages/stage-rusty.png", platforms: Object.freeze([{ x: 62, w: 93, y: 104, label: "LADDER", asset: "step-ladder" }, { x: 212, w: 81, y: 70, label: "AMP", asset: "amp" }]) }),
  Object.freeze({ number: 5, id: "mirror", name: "ミラーマッチ", opponent: "mirror", dialogue: "…。", background: "assets/stages/stage-mirror.png", platforms: Object.freeze([]) }),
]);

export const MENU_ITEMS = Object.freeze(["STORY MODE", "VS MODE", "TRAINING MODE", "HOW TO PLAY", "SETTINGS", "SCORE"]);
export const SETTINGS_ITEMS = Object.freeze(["SOUND", "BGM", "SE", "CONTROLLER SETTINGS", "DEBUG OVERLAY", "RESET DATA", "BACK"]);
export const TRAINING_SETTINGS_ITEMS = Object.freeze(["START TRAINING", "CPU FIGHTER", "STAGE", "CPU MOVE", "CPU ATTACK", "BACK"]);

// Only two runtime tracks are currently shipped.  These profiles
// deliberately give every stage a distinct audible arrangement without
// introducing an unlicensed external asset: source, rate, gain, and start
// position are all data-owned and deterministic for the audio controller.
export const STAGE_BGM_PROFILES = Object.freeze([
  Object.freeze({ source: "assets/audio/bgm-toko.mp3", playbackRate: 1, volume: 0.32, startTime: 0 }),
  Object.freeze({ source: "assets/audio/bgm-norio.mp3", playbackRate: 1, volume: 0.30, startTime: 0 }),
  Object.freeze({ source: "assets/audio/bgm-kazushige.mp3", playbackRate: 1, volume: 0.30, startTime: 0 }),
  Object.freeze({ source: "assets/audio/bgm-title.mp3", playbackRate: 0.98, volume: 0.23, startTime: 54 }),
  Object.freeze({ source: "assets/audio/bgm-mirror.mp3", playbackRate: 1, volume: 0.30, startTime: 0 }),
]);

export function getOpponentId(stageNumber, selectedId) {
  const stage = STAGES[Math.max(1, Math.min(STAGES.length, stageNumber)) - 1];
  return stage.opponent === "mirror" ? selectedId : stage.opponent;
}

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.normal;
}
