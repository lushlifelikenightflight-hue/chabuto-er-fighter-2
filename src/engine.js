/** Pure simulation helpers. No DOM, timing, or browser globals live here. */

import { CHARACTERS, DIFFICULTIES, MAX_HP, MAX_METER, STAGE_BOUNDS, getOpponentId } from "./data.js";
import { getSkillConfig } from "./skills.js";

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

export const DOWN_STATES = Object.freeze([
  "knockback",
  "knockdownLanding",
  "downed",
  "groundHit",
  "knockdown",
  "wakeup",
  "wakeupInvulnerable",
]);

export const DOWN_CONFIG = Object.freeze({
  threshold: 100,
  landingFrames: 10,
  followupWindowFrames: 45,
  autoWakeupStartFrames: 60,
  wakeupFrames: 20,
  wakeupInvulnerableFrames: 42,
  hardWakeupFrames: 30,
});

export const KNOCKDOWN_THRESHOLD = DOWN_CONFIG.threshold;
export const DOWN_THRESHOLD = KNOCKDOWN_THRESHOLD;
export const KNOCKDOWN_LANDING_FRAMES = DOWN_CONFIG.landingFrames;
export const DOWN_FOLLOWUP_WINDOW_FRAMES = DOWN_CONFIG.followupWindowFrames;
export const WAKEUP_FRAMES = DOWN_CONFIG.wakeupFrames;
export const HARD_WAKEUP_FRAMES = DOWN_CONFIG.hardWakeupFrames;
export const WAKEUP_INVULNERABLE_FRAMES = DOWN_CONFIG.wakeupInvulnerableFrames;

export const JUST_GUARD_CONFIG = Object.freeze({
  windowFrames: 4,
  attackerRecoilFrames: 12,
  attackerRecoilRange: Object.freeze([10, 14]),
  defenderRecoveryFrames: 3,
  defenderRecoveryRange: Object.freeze([2, 4]),
  hitstopFrames: 4,
  hitstopRange: Object.freeze([3, 5]),
  damage: 0,
  meterGain: 10,
});

export const JUST_GUARD_WINDOW_FRAMES = JUST_GUARD_CONFIG.windowFrames;
export const JUST_GUARD_RECOIL_FRAMES = JUST_GUARD_CONFIG.attackerRecoilFrames;
export const JUST_GUARD_HITSTOP_FRAMES = JUST_GUARD_CONFIG.hitstopFrames;

export const COMBO_DEFAULT_LIMIT = 6;
export const COMBO_PREINPUT_FRAMES = 8;
export const COMBO_HIT_WINDOW_FRAMES = 70;
export const COMBO_SCALING = Object.freeze({
  minimum: 0.45,
  perHit: 0.08,
  hitstunPerHit: 0.045,
  knockbackPerHit: 0.06,
});

export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function isDownState(stateOrFighter) {
  const state = typeof stateOrFighter === "string" ? stateOrFighter : stateOrFighter?.state;
  return DOWN_STATES.includes(state) || stateOrFighter?.downed === true;
}

export function getKnockdownRecoveryFrames(hardKnockdown = false) {
  return (hardKnockdown ? DOWN_CONFIG.hardWakeupFrames : DOWN_CONFIG.wakeupFrames) + DOWN_CONFIG.landingFrames;
}

export const getDownRecoveryFrames = getKnockdownRecoveryFrames;

export function knockdownValueAfter(currentValue = 0, move = {}, resistance = 1) {
  const current = Math.max(0, Number(currentValue) || 0);
  const value = Math.max(0, Number(move.knockdownValue) || 0);
  const multiplier = Math.max(0.1, Number(resistance) || 1);
  return current + value / multiplier;
}

export function isKnockdownReached(value = 0, threshold = KNOCKDOWN_THRESHOLD) {
  return (Number(value) || 0) >= (Number(threshold) || KNOCKDOWN_THRESHOLD);
}

export function shouldKnockdown(move = {}, accumulatedValue = 0, threshold = KNOCKDOWN_THRESHOLD) {
  return Boolean(move.causesKnockdown || move.hardKnockdown || isKnockdownReached(accumulatedValue, threshold));
}

export const knockdownTriggered = shouldKnockdown;

export function canDownFollowup(fighter = {}, frame = null) {
  if (!fighter || !isDownState(fighter)) return false;
  if (fighter.followupUsed || fighter.downFollowupUsed || fighter.followupCount >= 1) return false;
  if (["wakeup", "wakeupInvulnerable"].includes(fighter.state) || fighter.wakeupTimer > 0) return false;
  const timer = Number(fighter.downedFrames ?? fighter.downTimer ?? 0);
  const window = Number(fighter.followupWindowFrames ?? DOWN_CONFIG.followupWindowFrames);
  if (timer > window) return false;
  if (frame != null && Number.isFinite(fighter.downStartedFrame) && frame - fighter.downStartedFrame > window) return false;
  return true;
}

export const canFollowup = canDownFollowup;

export function isJustGuardEligible(move = {}) {
  if (!move) return false;
  if (["throw", "commandThrow"].includes(move.kind) || move.isThrow === true || move.counterOnly === true) return false;
  if (move.unblockable === true || move.justGuardable === false) return false;
  return true;
}

export const justGuardEligible = isJustGuardEligible;

export function justGuardRecoilFor(move = {}) {
  if (!isJustGuardEligible(move)) return null;
  return {
    attackerFrames: JUST_GUARD_CONFIG.attackerRecoilFrames,
    defenderFrames: JUST_GUARD_CONFIG.defenderRecoveryFrames,
    hitstopFrames: JUST_GUARD_CONFIG.hitstopFrames,
    damage: JUST_GUARD_CONFIG.damage,
    meterGain: JUST_GUARD_CONFIG.meterGain,
    effectId: "just-guard-ring",
  };
}

export const getJustGuardRecoil = justGuardRecoilFor;

export function justGuardWithinWindow(attackFrame = 0, guardPressFrame = 0, window = JUST_GUARD_WINDOW_FRAMES) {
  return Math.abs((Number(attackFrame) || 0) - (Number(guardPressFrame) || 0)) <= Math.max(0, Number(window) || 0);
}

export function getComboLimit(characterOrStats, fallback = COMBO_DEFAULT_LIMIT) {
  const stats = characterOrStats?.stats || characterOrStats || {};
  const value = Number(stats.comboLimit);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function comboDamageScale(comboIndex = 0, characterOrStats = {}) {
  const stats = characterOrStats?.stats || characterOrStats || {};
  const index = Math.max(0, Number(comboIndex) || 0);
  const base = Number.isFinite(stats.hitstunScaling) ? stats.hitstunScaling : 1;
  return clamp(base * (1 - index * COMBO_SCALING.perHit), COMBO_SCALING.minimum, 1.25);
}

export const getComboScaling = comboDamageScale;

export function canAdvanceCombo(fighter = {}, nextIndex = (fighter.combo || 0) + 1) {
  const limit = getComboLimit(fighter);
  const timer = Number(fighter.comboTimer) || 0;
  return fighter.hp > 0 && !isDownState(fighter) && nextIndex >= 1 && nextIndex <= limit && timer <= COMBO_HIT_WINDOW_FRAMES;
}

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

export function getMoveHitbox(move) {
  if (!move) return null;
  if (move.hitbox) return { ...move.hitbox };
  const width = Number(move.hitboxWidth) || 0;
  const height = Number(move.hitboxHeight) || 0;
  if (width <= 0 || height <= 0) return null;
  return makeBox(Number(move.hitboxOffsetX) || 0, Number(move.hitboxOffsetY) || 0, width, height, "hitbox", move.id || "");
}

export function getFighterBoxes(fighter, move = null) {
  const originX = fighter.x;
  const originY = fighter.y;
  const profile = fighter.boxProfile || (fighter.grounded ? "standing" : "air");
  const hurtboxes = getHurtboxProfile(profile).map((box) => transformBox(box, fighter.facing, originX, originY));
  const pushboxLocal = makeBox(-24, 46, 48, 116, "pushbox", fighter.id);
  const pushbox = transformBox(pushboxLocal, fighter.facing, originX, originY);
  const hitbox = getMoveHitbox(move) ? transformBox(getMoveHitbox(move), fighter.facing, originX, originY) : null;
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
  // Separate symmetrically first, then spend any remainder on the fighter
  // that still has room.  The old half-split left both pushboxes overlapping
  // whenever one fighter was already touching a stage edge.
  const half = overlap / 2;
  const leftFighter = direction < 0 ? a : b;
  const rightFighter = direction < 0 ? b : a;
  const leftRoom = Math.max(0, Number(leftFighter.x) - bounds.left);
  const rightRoom = Math.max(0, bounds.right - Number(rightFighter.x));
  const leftMove = Math.min(half, leftRoom);
  const rightMove = Math.min(half, rightRoom);
  leftFighter.x = clamp(leftFighter.x - leftMove, bounds.left, bounds.right);
  rightFighter.x = clamp(rightFighter.x + rightMove, bounds.left, bounds.right);
  let remaining = overlap - leftMove - rightMove;
  if (remaining > 0 && leftRoom > leftMove) {
    const extra = Math.min(remaining, leftRoom - leftMove);
    leftFighter.x = clamp(leftFighter.x - extra, bounds.left, bounds.right);
    remaining -= extra;
  }
  if (remaining > 0 && rightRoom > rightMove) {
    const extra = Math.min(remaining, rightRoom - rightMove);
    rightFighter.x = clamp(rightFighter.x + extra, bounds.left, bounds.right);
  }
  const separated = !rectsOverlap(getFighterBoxes(a).pushbox, getFighterBoxes(b).pushbox);
  return { overlap, moved: true, separated };
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
  const attackId = move.attackId || attacker.currentAttackId || move.id;
  if (hitAlreadyRegistered(registry, attackId, defender.id)) return { hit: false, blocked: false, reason: "registered" };
  const attackerBoxes = getFighterBoxes(attacker, move);
  const defenderBoxes = getFighterBoxes(defender);
  const hit = attackerBoxes.hitbox && defenderBoxes.hurtboxes.some((part) => rectsOverlap(attackerBoxes.hitbox, part));
  if (!hit) return { hit: false, blocked: false, reason: "miss" };
  registerHit(registry, attackId, defender.id);
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
  if (defender.state !== "attacking") return false;
  const strike = defender.currentMove;
  if (!strike || strike.kind !== "normal" || !activeFrame(strike, defender.actionFrame)) return false;
  const strikeHitbox = getFighterBoxes(defender, strike).hitbox;
  const reachesAttacker = Boolean(strikeHitbox && getFighterBoxes(attacker).hurtboxes.some((part) => rectsOverlap(strikeHitbox, part)));
  if (!reachesAttacker) return false;
  if (defender.hp <= 0 || ["hitstun", "knockdown", "jumping"].includes(defender.state)) return false;
  return true;
}

export function facingFor(aX, bX, fallback = 1) { return aX === bX ? fallback : (bX > aX ? 1 : -1); }

export function createFighterState(id, x, facing = 1) {
  const character = CHARACTERS[id] || CHARACTERS["guitar-boy"];
  const stats = character.stats || {};
  const skillConfig = getSkillConfig(character.id);
  const initialSkillGauge = clamp(Number(skillConfig?.initialGauge) || 0, 0, Number(skillConfig?.chargeMax) || 100);
  const initialAmmo = Math.max(0, Number(skillConfig?.initialAmmo) || 0);
  const copyChargesMax = Math.max(0, Number(skillConfig?.copyCharges || skillConfig?.copiedSkillUses) || 0);
  const skillState = {
    phase: "skillUnavailable",
    gauge: initialSkillGauge,
    gaugeMax: Number(skillConfig?.chargeMax) || 100,
    ammo: initialAmmo,
    charging: false,
    interrupted: false,
    interruptionReason: null,
    recoveryFrames: 0,
  };
  return {
    id: character.id,
    x,
    y: 0,
    vx: 0,
    vy: 0,
    facing,
    hp: stats.hp,
    maxHp: stats.hp,
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
    throwTarget: null,
    thrownBy: null,
    throwReleased: false,
    // Monotonic attack instance identity prevents a repeated move from
    // inheriting a prior hit registry entry.  `alreadyHitTargets` is kept as
    // an explicit alias for integrations that inspect the combat state.
    attackInstanceId: 0,
    currentAttackId: null,
    alreadyHitTargets: new Set(),
    // Down/landing/follow-up contract.  Existing `knockdown` state names are
    // intentionally accepted by helpers and the browser loop.
    downValue: 0,
    knockdownValue: 0,
    downState: "standing",
    downed: false,
    downedFrames: 0,
    downTimer: 0,
    downStartedFrame: -1,
    hardKnockdown: false,
    downFollowupUsed: false,
    downAttackBuffer: null,
    followupUsed: false,
    followupCount: 0,
    followupMove: null,
    followupAvailable: false,
    followupWindowFrames: DOWN_CONFIG.followupWindowFrames,
    down: { value: 0, state: "standing", active: false, hard: false, frames: 0 },
    // Wakeup has a separate phase/timer so invulnerability can be consumed
    // without overloading the generic `invulnerableFrames` field.
    wakeupState: "idle",
    wakeupTimer: 0,
    wakeupStartedFrame: -1,
    wakeupInvulnerableFrames: 0,
    wakeupInvulnerable: false,
    wakeup: { state: "idle", timer: 0, invulnerableFrames: 0 },
    // Combo bookkeeping is kept alongside the legacy combo/comboTimer pair.
    comboHits: 0,
    comboLimit: getComboLimit(stats),
    comboScale: 1,
    attackCooldownFrames: 0,
    attackCooldownMax: Math.max(30, 60 - getComboLimit(stats) * 3),
    comboWindowFrames: COMBO_HIT_WINDOW_FRAMES,
    comboStarter: null,
    comboLastMove: null,
    comboPreInputFrames: COMBO_PREINPUT_FRAMES,
    comboState: { hits: 0, limit: getComboLimit(stats), scale: 1, timer: 0, starter: null, lastMove: null },
    // Guard dash is an authored locomotion action with its own cooldown and
    // opening protection window.
    guardDash: { active: false, frames: 0, cooldown: 0, invulnerableFrames: 0 },
    guardDashState: "idle",
    guardDashActive: false,
    guardDashFrames: 0,
    guardDashCooldown: 0,
    guardDashInvulnerableFrames: 0,
    // Hitstop aliases allow the renderer and combat resolver to use whichever
    // naming convention their existing code expects.
    hitstopFrames: 0,
    hitstopRemaining: 0,
    hitstop: { frames: 0, remaining: 0 },
    // Character skill resource and phase state.
    skill: skillState,
    skillPhase: skillState.phase,
    skillState: skillState.phase,
    skillGauge: initialSkillGauge,
    skillGaugeMax: skillState.gaugeMax,
    skillCharging: false,
    skillActive: false,
    skillInterrupted: false,
    skillInterruptionReason: null,
    skillRecoveryFrames: 0,
    slimeCooldown: 0,
    rainDashFrames: 0,
    rainSlipFrames: 0,
    rainSlipTriggered: false,
    rainSlipDirection: 0,
    skillHoldFrames: 0,
    skillHoldThresholdFrames: 21,
    skillHoldActive: false,
    skillCancelled: false,
    skillAmmo: initialAmmo,
    ammo: initialAmmo,
    skillCharges: 0,
    // Guitar-boy's copied skill starts empty and can hold two uses after a
    // full charge; other fighters expose the same fields for a stable schema.
    copyGauge: 0,
    copyCharges: 0,
    copyChargesMax,
    copiedSkillId: null,
    copiedSkillUses: 0,
    copy: { gauge: 0, charges: 0, maxCharges: copyChargesMax, skillId: null, uses: 0 },
    // `meter` remains the existing special-gauge alias.  The object form and
    // roundCarry snapshot are independent mutable records for integrations.
    specialGauge: 0,
    gauge: { special: 0, skill: initialSkillGauge },
    roundCarry: { meter: 0, specialGauge: 0, skillGauge: initialSkillGauge, ammo: initialAmmo, copyCharges: 0 },
    roundCarryState: { meter: 0, specialGauge: 0, skillGauge: initialSkillGauge, ammo: initialAmmo, copyCharges: 0 },
    carryMeter: 0,
    carrySkillGauge: initialSkillGauge,
    carryAmmo: initialAmmo,
    carryCopyCharges: 0,
  };
}

export function applyDamage(defender, amount, { blocked = false, knockbackX = 0, knockbackY = 0, hitstunFrames = 0 } = {}) {
  if (!defender || defender.hp <= 0) return 0;
  const defense = Math.max(0.1, CHARACTERS[defender.id]?.stats.defense || 1);
  const damage = Math.max(0, Number(amount) || 0) / defense;
  defender.hp = clamp(defender.hp - damage, 0, defender.maxHp || MAX_HP);
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
  const width = Math.max(24, Number(move?.hitbox?.w || move?.hitboxWidth || 24));
  const height = Math.max(16, Number(move?.hitbox?.h || move?.hitboxHeight || 16));
  return {
    owner,
    x: fighter.facing > 0 ? fighter.x + 28 : fighter.x - 28 - width,
    y: 88,
    vx: fighter.facing * 5.6,
    facing: fighter.facing,
    w: width,
    h: height,
    damage: move.damage,
    effectId: move.effectId || "attack-special",
    moveKind: move.kind || "special",
    unblockable: move.unblockable === true,
    justGuardable: move.justGuardable !== false,
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
  if (memory.planned?.action === "skill" && !memory.planned.released) {
    if (nowFrame < memory.planned.releaseAt) return memory.planned;
    if (nowFrame === memory.planned.releaseAt) { memory.planned = { ...memory.planned, released: true }; return memory.planned; }
  }
  if (nowFrame < memory.thinkAt) return memory.planned;
  memory.thinkAt = nowFrame + level.reactionFrames;
  const distance = Math.abs(self.x - opponent.x);
  const noise = (random() - 0.5) * level.error * 2;
  const character = CHARACTERS[self.id] || {};
  const preferred = self.id === opponent.id ? 38 : Number(character.cpu?.preferredDistance || 48);
  const normalReach = Math.max(
    Number(character.moves?.light_attack_neutral?.hitboxWidth || character.moves?.light_attack_neutral?.hitbox?.w || 0),
    Number(character.moves?.strong_attack_neutral?.hitboxWidth || character.moves?.strong_attack_neutral?.hitbox?.w || 0),
    preferred,
  );
  const attackReach = Math.max(preferred, normalReach + 12);
  const spacingTarget = Math.min(attackReach * 0.82, preferred + 12);
  const closeEdge = spacingTarget * 0.58;
  const tacticRoll = random();
  const toward = facingFor(self.x, opponent.x);
  if (distance > attackReach + noise * 12) memory.planned = { action: "walk", direction: toward, reason: "approach-reach", issuedAt: nowFrame };
  else if (distance < closeEdge && tacticRoll < 0.34) memory.planned = { action: "walk", direction: -toward, reason: "make-space", issuedAt: nowFrame };
  else if (opponent.state === "jumping" && character.cpu?.antiAir) memory.planned = { action: tacticRoll < 0.45 && self.grounded ? "jump" : "guard", low: false, justGuard: random() < level.justGuardRate, issuedAt: nowFrame };
  else if (["attacking", "special"].includes(opponent.state) && tacticRoll < Math.max(0.24, level.guardRate)) memory.planned = { action: tacticRoll < 0.1 && self.grounded ? "jump" : random() < 0.55 ? "guard" : "guard_low", justGuard: random() < level.justGuardRate, issuedAt: nowFrame };
  else {
    const skill = getSkillConfig(self.id);
    const phase = self.skillPhase || self.skillState || "skillUnavailable";
    const ammo = Number(self.ammo ?? self.skillAmmo ?? skill?.initialAmmo ?? 0);
    const legalSkill = Boolean(skill && !self.downed && !self.flashStunned && ["skillUnavailable", "skillRecovery"].includes(phase) && (skill.initialAmmo <= 0 || ammo > 0 || skill.type === "flash"));
    if (tacticRoll < 0.16) memory.planned = { action: "observe", reason: "watch-spacing", issuedAt: nowFrame };
    else if (tacticRoll < 0.28) memory.planned = { action: "walk", direction: distance < spacingTarget ? -toward : toward, reason: "hold-spacing", issuedAt: nowFrame };
    else if (tacticRoll < 0.39 && self.grounded) memory.planned = { action: "jump", reason: "change-level", issuedAt: nowFrame };
    else if (tacticRoll < 0.49) memory.planned = { action: opponent.state === "crouching" ? "guard_low" : "guard", justGuard: random() < level.justGuardRate, issuedAt: nowFrame };
    else if (legalSkill && tacticRoll < 0.61) {
      const holdFrames = skill.type === "flash" && ammo <= 0 ? Number(skill.filmReloadFrames || 36) : skill.trigger === "hold-release" ? Math.max(1, Number(skill.chargeMax || 1)) : Math.max(1, Number(skill.phase?.activeFrames || 1));
      memory.planned = { action: "skill", issuedAt: nowFrame, releaseAt: nowFrame + holdFrames, released: false };
    } else if (tacticRoll < 0.69 && self.meter >= MAX_METER) memory.planned = { action: "special", issuedAt: nowFrame };
    else if (distance <= Math.min(52, attackReach) && tacticRoll < (character.cpu?.throwBias ? 0.8 : 0.74)) memory.planned = { action: "throw", issuedAt: nowFrame };
    else memory.planned = { action: tacticRoll < 0.88 ? "light" : "strong", reason: "in-reach", issuedAt: nowFrame };
  }
  return memory.planned;
}
