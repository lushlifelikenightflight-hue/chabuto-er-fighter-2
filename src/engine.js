/** Pure simulation helpers. No DOM, timing, or browser globals live here. */

import { CHARACTERS, DIFFICULTIES, MAX_HP, MAX_METER, STAGE_BOUNDS, getOpponentId } from "./data.js";

export const FIXED_HZ = 60;
export const FIXED_DT = 1 / FIXED_HZ;
export const FIXED_UPDATE_ORDER = Object.freeze([
  "input",
  "stateTransition",
  "velocityGravity",
  "stageBounds",
  "pushbox",
  "animation",
  "hurtboxHitbox",
  "throw",
  "strike",
  "damageKo",
  "display",
]);

export const BOX_TYPES = Object.freeze(["pushbox", "hurtbox", "hitbox", "throwbox", "projectileHitbox", "stageBounds"]);

export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function makeBox(x = 0, y = 0, w = 0, h = 0, type = "hurtbox", id = "") {
  return { x, y, w, h, type, id };
}

export function rectsOverlap(a, b) {
  return Boolean(a && b && a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 &&
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
}

export const boxesOverlap = rectsOverlap;

/** Convert a local box (origin at the fighter's left-facing center line) to world coordinates. */
export function transformBox(local, facing = 1, originX = 0, originY = 0) {
  if (!local) return null;
  const x = facing >= 0 ? originX + local.x : originX - local.x - local.w;
  return { ...local, x, y: originY + local.y };
}

export function mirrorBox(local, facing = 1) { return transformBox(local, facing, 0, 0); }

const HURTBOX_PROFILES = Object.freeze({
  standing: [makeBox(-18, 16, 36, 42, "hurtbox", "head"), makeBox(-24, 56, 48, 54, "hurtbox", "torso"), makeBox(-20, 108, 40, 66, "hurtbox", "legs")],
  crouch: [makeBox(-18, 28, 36, 34, "hurtbox", "head"), makeBox(-27, 58, 54, 44, "hurtbox", "torso"), makeBox(-24, 98, 48, 40, "hurtbox", "legs")],
  air: [makeBox(-17, 15, 34, 38, "hurtbox", "head"), makeBox(-23, 50, 46, 50, "hurtbox", "torso"), makeBox(-28, 94, 56, 46, "hurtbox", "legs")],
  down: [makeBox(-27, 77, 54, 27, "hurtbox", "head"), makeBox(-35, 99, 70, 27, "hurtbox", "torso"), makeBox(-38, 119, 76, 22, "hurtbox", "legs")],
  special: [makeBox(-19, 17, 38, 44, "hurtbox", "head"), makeBox(-28, 56, 56, 57, "hurtbox", "torso"), makeBox(-24, 110, 48, 60, "hurtbox", "legs")],
});

export function getHurtboxProfile(profile = "standing") {
  return (HURTBOX_PROFILES[profile] || HURTBOX_PROFILES.standing).map((box) => ({ ...box }));
}

export function getFighterBoxes(fighter, move = null) {
  const originX = fighter.x;
  const originY = fighter.y;
  const profile = fighter.boxProfile || (fighter.grounded ? "standing" : "air");
  const hurtboxes = getHurtboxProfile(profile).map((box) => transformBox(box, fighter.facing, originX, originY));
  const pushboxLocal = makeBox(-24, 46, 48, 116, "pushbox", fighter.id);
  const pushbox = transformBox(pushboxLocal, fighter.facing, originX, originY);
  const hitbox = move?.hitbox ? transformBox(move.hitbox, fighter.facing, originX, originY) : null;
  const throwbox = transformBox(makeBox(0, 73, 43, 36, "throwbox", fighter.id), fighter.facing, originX, originY);
  return { pushbox, hurtboxes, hitbox, throwbox };
}

export function resolveStageBounds(fighter, bounds = STAGE_BOUNDS) {
  const before = fighter.x;
  fighter.x = clamp(fighter.x, bounds.left, bounds.right);
  if (fighter.y < 0) { fighter.y = 0; fighter.vy = 0; }
  if (fighter.y > 0) {
    fighter.y = Math.max(0, fighter.y);
  }
  return { x: fighter.x, clamped: before !== fighter.x };
}

export function resolvePushboxes(a, b, bounds = STAGE_BOUNDS) {
  if (!a || !b) return { overlap: 0, moved: false };
  const ba = getFighterBoxes(a).pushbox;
  const bb = getFighterBoxes(b).pushbox;
  if (!rectsOverlap(ba, bb)) return { overlap: 0, moved: false };
  const overlap = Math.min(ba.x + ba.w - bb.x, bb.x + bb.w - ba.x);
  const direction = a.x <= b.x ? -1 : 1;
  const half = overlap / 2;
  a.x = clamp(a.x + direction * half, bounds.left, bounds.right);
  b.x = clamp(b.x - direction * half, bounds.left, bounds.right);
  return { overlap, moved: true };
}

export function activeFrame(move, actionFrame) {
  if (!move || !Number.isFinite(actionFrame)) return false;
  const start = move.startupFrames;
  return actionFrame >= start && actionFrame < start + move.activeFrames;
}

export function hitAlreadyRegistered(registry, moveId, targetId) {
  const key = `${moveId}:${targetId}`;
  return registry instanceof Set ? registry.has(key) : false;
}

export function registerHit(registry, moveId, targetId) {
  const key = `${moveId}:${targetId}`;
  if (registry instanceof Set) registry.add(key);
  return key;
}

export function evaluateStrike(attacker, defender, move, actionFrame, registry = new Set()) {
  if (!activeFrame(move, actionFrame)) return { hit: false, blocked: false, reason: "inactive" };
  if (!attacker || !defender || attacker.hp <= 0 || defender.hp <= 0) return { hit: false, blocked: false, reason: "ko" };
  if ((defender.invulnerableFrames || 0) > 0) return { hit: false, blocked: false, reason: "invulnerable" };
  if (hitAlreadyRegistered(registry, move.id, defender.id)) return { hit: false, blocked: false, reason: "registered" };
  const attackerBoxes = getFighterBoxes(attacker, move);
  const defenderBoxes = getFighterBoxes(defender);
  const hit = attackerBoxes.hitbox && defenderBoxes.hurtboxes.some((part) => rectsOverlap(attackerBoxes.hitbox, part));
  if (!hit) return { hit: false, blocked: false, reason: "miss" };
  registerHit(registry, move.id, defender.id);
  const guarding = defender.state === "guarding" || defender.state === "blockstun";
  const unblockable = move.unblockable === true;
  const hitLevel = move.hitLevel || "mid";
  const lowGuard = defender.action === "guard_low" || defender.boxProfile === "crouch";
  // Standing guard blocks mid/overhead but not low. Crouch guard blocks
  // low/mid but leaves overhead open. Unblockables ignore either guard.
  const guardLevelOk = lowGuard ? hitLevel === "low" || hitLevel === "mid" : hitLevel !== "low";
  const blocked = guarding && guardLevelOk && !unblockable;
  return { hit: true, blocked, damage: blocked ? move.chipDamage : move.damage, unblockable, guardLevelOk };
}

export function evaluateThrow(attacker, defender, frame = 0) {
  if (!attacker || !defender || frame < 0) return false;
  if (!attacker.grounded || !defender.grounded) return false;
  if (defender.hp <= 0 || ["hitstun", "knockdown", "jumping"].includes(defender.state)) return false;
  return rectsOverlap(getFighterBoxes(attacker).throwbox, getFighterBoxes(defender).pushbox);
}

export function facingFor(aX, bX, fallback = 1) { return aX === bX ? fallback : (bX > aX ? 1 : -1); }

export function createFighterState(id, x, facing = 1) {
  const character = CHARACTERS[id] || CHARACTERS["guitar-boy"];
  return {
    id: character.id,
    x,
    y: 0,
    vx: 0,
    vy: 0,
    facing,
    hp: MAX_HP,
    meter: 0,
    state: "idle",
    action: "idle",
    actionFrame: 0,
    grounded: true,
    airFrames: 0,
    crouching: false,
    jumpsUsed: 0,
    doubleJumpAvailable: true,
    guardHeld: false,
    guardStartedFrame: -1,
    hitRegistry: new Set(),
    combo: 0,
    comboTimer: 0,
    invulnerableFrames: 0,
    stunFrames: 0,
    boxProfile: "standing",
    aiMemory: { thinkAt: 0, planned: null, previousState: "idle" },
    pendingProjectile: null,
    projectileSpawned: false,
    lastDirection: 0,
    lastDirectionFrame: -999,
    // A dash/backstep is a short authored locomotion action. Keep it latched
    // for its clip duration instead of replacing it with walk on the first
    // held-input tick after the double tap.
    locomotionAction: "",
    locomotionFramesRemaining: 0,
  };
}

export function applyDamage(defender, amount, { blocked = false, knockbackX = 0, knockbackY = 0, hitstunFrames = 0 } = {}) {
  if (!defender || defender.hp <= 0) return 0;
  const damage = Math.max(0, Number(amount) || 0);
  defender.hp = clamp(defender.hp - damage, 0, MAX_HP);
  if (!blocked) {
    defender.state = defender.hp <= 0 ? "defeat" : "hitstun";
    defender.action = defender.hp <= 0 ? "defeat" : "hit_light";
    defender.stunFrames = hitstunFrames;
    defender.vx += knockbackX * (defender.facing * -1);
    defender.vy = Math.max(defender.vy, knockbackY);
  } else {
    defender.state = defender.hp <= 0 ? "defeat" : "blockstun";
    defender.action = defender.hp <= 0 ? "defeat" : defender.action;
    defender.stunFrames = Math.max(defender.stunFrames, hitstunFrames);
  }
  return damage;
}

export function continueCount(difficulty = "normal") {
  return DIFFICULTIES[difficulty]?.continues ?? DIFFICULTIES.normal.continues;
}

export function canContinue(difficulty, used) {
  const max = continueCount(difficulty);
  return max === Infinity || used < max;
}

export function stageOpponent(stageNumber, selectedId) { return getOpponentId(stageNumber, selectedId); }

export function stageProgress(stageNumber, selectedId, roundWins = 0) {
  const next = Math.max(1, Math.min(5, stageNumber));
  return { stage: next, opponent: stageOpponent(next, selectedId), roundWins };
}

export function resolveRound(player, cpu, remainingSeconds = 0) {
  if (player.hp === cpu.hp && remainingSeconds <= 0) return { result: "draw", winner: null };
  if (player.hp <= 0 && cpu.hp <= 0) return { result: "draw", winner: null };
  if (player.hp <= 0) return { result: "loss", winner: "cpu" };
  if (cpu.hp <= 0) return { result: "win", winner: "player" };
  if (remainingSeconds <= 0) return player.hp > cpu.hp ? { result: "win", winner: "player" } : player.hp < cpu.hp ? { result: "loss", winner: "cpu" } : { result: "draw", winner: null };
  return { result: "ongoing", winner: null };
}

export function advanceRound(progress, roundResult) {
  const next = { ...progress };
  if (roundResult === "win") next.playerRounds = (next.playerRounds || 0) + 1;
  if (roundResult === "loss") next.cpuRounds = (next.cpuRounds || 0) + 1;
  if (roundResult === "draw") next.draws = (next.draws || 0) + 1;
  if (next.playerRounds >= 2) return { ...next, status: "stageWin" };
  if (next.cpuRounds >= 2) return { ...next, status: "stageLoss" };
  return { ...next, status: "rematch" };
}

export function rankForScore(score, stats = {}) {
  const value = Math.max(0, Number(score) || 0);
  const difficulty = stats.difficulty || "normal";
  const difficultyScale = difficulty === "hard" ? 1.18 : difficulty === "easy" ? 0.82 : 1;
  const adjusted = value * difficultyScale;
  const perfect = stats.perfect ? 1 : 0;
  if (adjusted >= 60000 || (perfect && adjusted >= 30000)) return "S";
  if (adjusted >= 40000) return "A";
  if (adjusted >= 22000) return "B";
  if (adjusted >= 10000) return "C";
  return "D";
}

export function scoreForEvent(event, amount = 0) {
  const values = { light: 100, strong: 250, throw: 400, justGuard: 300, counter: 200, special: 2000, round: 3000, perfect: 5000, stage: 5000, noContinue: 10000, clear: 20000, continue: 1000, roundLoss: -350, whiffSpecial: -250, hp: 1, time: 2 };
  const base = values[event] || 0;
  const extra = Number(amount) || 0;
  return base < 0 ? base + Math.min(0, extra) : base + Math.max(0, extra);
}

export function guardCanBlock(defender, move) {
  if (!defender || !move || defender.state !== "guarding" && defender.state !== "blockstun") return false;
  if (move.unblockable) return false;
  const lowGuard = defender.action === "guard_low" || defender.boxProfile === "crouch";
  return lowGuard ? ["low", "mid"].includes(move.hitLevel || "mid") : move.hitLevel !== "low";
}

export function createProjectile(owner, fighter, move, currentFrame = 0) {
  return {
    owner,
    x: fighter.x + fighter.facing * 28,
    y: 88,
    vx: fighter.facing * 5.6,
    w: 24,
    h: 16,
    damage: move.damage,
    hit: false,
    // Projectiles are created when the owning move reaches its first active
    // frame. Do not charge startup twice after the projectile exists.
    activeAt: currentFrame,
    activeUntil: currentFrame + Math.max(1, move.activeFrames || 1) - 1,
    type: "projectileHitbox",
  };
}

export function projectileIsActive(projectile, frame) {
  return Boolean(projectile && !projectile.hit && frame >= (projectile.activeAt || 0) && frame <= (projectile.activeUntil ?? Infinity));
}

/** Deterministic accumulator helper used by the browser loop and node tests. */
export function fixedStep(accumulator, elapsedSeconds, step = FIXED_DT, maxSteps = 5) {
  let acc = Math.max(0, accumulator) + Math.max(0, elapsedSeconds);
  let steps = 0;
  // Decimal frame durations such as 5 / 60 can land a few ulps below the
  // exact boundary. Treat that representational error as an on-time tick.
  const epsilon = Math.max(Number.EPSILON, step * 1e-10);
  while (acc + epsilon >= step && steps < maxSteps) { acc -= step; steps += 1; }
  if (Math.abs(acc) < epsilon) acc = 0;
  return { accumulator: acc, steps, alpha: acc / step };
}

export function aiPlan({ self, opponent, difficulty = "normal", nowFrame = 0, random = Math.random }) {
  const level = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  const memory = self.aiMemory || (self.aiMemory = { thinkAt: 0, planned: null, previousState: "idle" });
  if (nowFrame < memory.thinkAt) return memory.planned;
  memory.thinkAt = nowFrame + level.reactionFrames;
  const distance = Math.abs(self.x - opponent.x);
  const noise = (random() - 0.5) * level.error * 2;
  const threshold = self.id === opponent.id ? 38 : (CHARACTERS[self.id]?.cpu.preferredDistance || 48);
  if (distance > threshold + noise * 20) memory.planned = { action: "walk", direction: facingFor(self.x, opponent.x), issuedAt: nowFrame };
  else if (opponent.state === "jumping" && CHARACTERS[self.id]?.cpu.antiAir) memory.planned = { action: "guard", low: false, justGuard: random() < level.justGuardRate, issuedAt: nowFrame };
  else if (opponent.state === "crouching" && random() < level.guardRate) memory.planned = { action: "guard_low", justGuard: random() < level.justGuardRate, issuedAt: nowFrame };
  else if (random() < level.guardRate && ["attacking", "special"].includes(opponent.state)) memory.planned = { action: random() < 0.55 ? "guard" : "guard_low", justGuard: random() < level.justGuardRate, issuedAt: nowFrame };
  else if (random() < 0.11 && self.grounded && opponent.state === "attacking") memory.planned = { action: "jump", issuedAt: nowFrame };
  else if (random() < 0.12 && self.meter >= MAX_METER) memory.planned = { action: "special", issuedAt: nowFrame };
  else if (random() < 0.18 && CHARACTERS[self.id]?.cpu.throwBias) memory.planned = { action: "throw", issuedAt: nowFrame };
  else memory.planned = { action: random() < (level.comboMax <= 2 ? 0.75 : 0.58) ? "light" : "strong", issuedAt: nowFrame };
  return memory.planned;
}
