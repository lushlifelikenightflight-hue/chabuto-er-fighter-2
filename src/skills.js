/**
 * Data-only foundation for B-button character skills.
 *
 * This module deliberately contains no DOM, timing, or rendering code.  The
 * game loop can consume the phase contract while a future integration layer
 * decides how input and animation are scheduled.
 */

export const SKILL_PHASES = Object.freeze([
  "skillStartup",
  "skillCharging",
  "skillActive",
  "skillRecovery",
  "skillUnavailable",
]);

export const SKILL_PHASE_TRANSITIONS = Object.freeze({
  skillStartup: Object.freeze(["skillCharging", "skillActive", "skillRecovery", "skillUnavailable"]),
  skillCharging: Object.freeze(["skillActive", "skillRecovery", "skillUnavailable"]),
  skillActive: Object.freeze(["skillRecovery", "skillUnavailable"]),
  skillRecovery: Object.freeze(["skillUnavailable"]),
  skillUnavailable: Object.freeze(["skillStartup"]),
});

export const SKILL_INTERRUPTION_REASONS = Object.freeze([
  "hit",
  "throw",
  "down",
  "knockdown",
  "guard",
  "wakeup",
  "special",
  "ko",
]);

export const SKILL_LOCKOUT_STATES = Object.freeze([
  "guarding",
  "blockstun",
  "downed",
  "knockback",
  "knockdown",
  "knockdownLanding",
  "groundHit",
  "wakeup",
  "wakeupInvulnerable",
  "special",
  "special_start",
  "special_active",
  "special_recovery",
  "defeat",
]);

const phase = (startupFrames, chargingFrames, activeFrames, recoveryFrames) => Object.freeze({
  startupFrames,
  chargingFrames,
  activeFrames,
  recoveryFrames,
});

/** Eight configs are intentionally keyed by the canonical character ids. */
export const SKILL_CONFIGS = Object.freeze({
  "guitar-boy": Object.freeze({
    id: "guitar-boy",
    skillId: "copy",
    name: "コピー",
    type: "copy",
    trigger: "hold",
    releaseActivates: false,
    chargeRate: 1,
    chargeMax: 100,
    initialGauge: 0,
    initialAmmo: 0,
    maxAmmo: 2,
    copyCharges: 2,
    copiedSkillUses: 2,
    persistAcrossRounds: true,
    resetOnStage: true,
    phase: phase(8, 0, 24, 18),
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "special", "ko"]),
    effectId: "skill-copy",
    spriteActions: Object.freeze(["skill_copy_start", "skill_copy_loop", "skill_copy_full", "skill_copy_activate", "skill_copy_fail"]),
  }),
  "green-slime": Object.freeze({
    id: "green-slime",
    skillId: "slime-shot",
    name: "スライム弾",
    type: "slimeShot",
    trigger: "hold-release",
    releaseActivates: true,
    chargeRate: 1,
    chargeMax: 100,
    chargeStages: Object.freeze([
      Object.freeze({ id: "small", minCharge: 0, damageScale: 0.72, sizeScale: 0.78, speedScale: 1.3, knockdownValue: 14 }),
      Object.freeze({ id: "medium", minCharge: 34, damageScale: 1, sizeScale: 1, speedScale: 1, knockdownValue: 28 }),
      Object.freeze({ id: "large", minCharge: 68, damageScale: 1.35, sizeScale: 1.34, speedScale: 0.72, knockdownValue: 70, causesKnockdown: true, hardKnockdown: true }),
    ]),
    initialGauge: 0,
    initialAmmo: 0,
    maxAmmo: 0,
    phase: phase(6, 0, 3, 22),
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "ko"]),
    effectId: "skill-slime-shot",
    spriteActions: Object.freeze(["skill_slime_charge", "skill_slime_small", "skill_slime_medium", "skill_slime_large", "skill_slime_fail"]),
  }),
  "bob-girl": Object.freeze({
    id: "bob-girl",
    skillId: "mirror",
    name: "ミラー",
    type: "mirror",
    trigger: "hold",
    releaseActivates: false,
    chargeRate: 0,
    chargeMax: 1,
    initialGauge: 1,
    initialAmmo: 1,
    maxAmmo: 1,
    phase: phase(5, 0, 2, 14),
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "special", "ko"]),
    reflectable: Object.freeze(["projectile", "energy", "linearSpecial"]),
    nonReflectable: Object.freeze(["throw", "tackle", "groundAttack", "overheadDrop", "downFollowup", "summon", "normalStrike"]),
    effectId: "skill-mirror",
    spriteActions: Object.freeze(["skill_mirror_start", "skill_mirror_hold", "skill_mirror_success", "skill_mirror_fail"]),
  }),
  uncle: Object.freeze({
    id: "uncle",
    skillId: "tackle",
    name: "タックル",
    type: "tackle",
    trigger: "hold-release",
    releaseActivates: true,
    chargeRate: 1,
    chargeMax: 36,
    initialGauge: 0,
    initialAmmo: 0,
    maxAmmo: 0,
    phase: phase(10, 20, 10, 36),
    unblockable: true,
    causesKnockdown: true,
    hardKnockdown: true,
    jumpAvoidable: true,
    projectileLowProfile: true,
    throwInvulnerable: false,
    cooldownFrames: 42,
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "ko"]),
    effectId: "skill-tackle",
    spriteActions: Object.freeze(["skill_tackle_charge", "skill_tackle_active", "skill_tackle_whiff"]),
  }),
  rusty: Object.freeze({
    id: "rusty",
    skillId: "dog-summon",
    name: "でけぇ犬の召喚",
    type: "dogSummon",
    trigger: "hold-release",
    releaseActivates: true,
    chargeRate: 1,
    chargeMax: 100,
    initialGauge: 0,
    initialAmmo: 0,
    maxAmmo: 1,
    simultaneousLimit: 1,
    hardKnockdown: true,
    causesKnockdown: true,
    guardable: true,
    phase: phase(12, 0, 12, 30),
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "ko"]),
    effectId: "skill-dog-summon",
    spriteActions: Object.freeze(["skill_dog_charge", "skill_dog_marker", "skill_dog_drop", "skill_dog_impact"]),
    reference: "large-dog-with-bicycle-reference",
  }),
  kazushige: Object.freeze({
    id: "kazushige",
    skillId: "ramen",
    name: "らーめんを食べる",
    type: "ramenBuff",
    trigger: "hold",
    releaseActivates: false,
    chargeRate: 1,
    chargeMax: 100,
    initialGauge: 0,
    initialAmmo: 0,
    maxAmmo: 0,
    buffDurationFrames: 600,
    buff: Object.freeze({ attackScale: 1.35, hitboxScale: 1.25, effectScale: 1.3, chipScale: 1.2, moveSpeedScale: 1 }),
    interruptedGaugeRetention: 0.5,
    phase: phase(6, 0, 600, 20),
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "ko"]),
    effectId: "skill-ramen",
    spriteActions: Object.freeze(["skill_ramen_start", "skill_ramen_loop", "skill_ramen_complete", "skill_ramen_fail"]),
  }),
  norio: Object.freeze({
    id: "norio",
    skillId: "drum-beat",
    name: "ドラムビート",
    type: "drumBeat",
    trigger: "hold-release",
    releaseActivates: true,
    chargeRate: 1,
    chargeMax: 100,
    initialGauge: 0,
    initialAmmo: 16,
    maxAmmo: 16,
    durationFrames: 480,
    intervalFrames: 30,
    snareCount: 16,
    perTargetHitLimit: 3,
    phase: phase(8, 0, 480, 24),
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "ko"]),
    effectId: "skill-drum-beat",
    spriteActions: Object.freeze(["skill_drum_count", "skill_drum_marker", "skill_drum_drop", "skill_drum_end"]),
  }),
  toko: Object.freeze({
    id: "toko",
    skillId: "flash",
    name: "フラッシュ撮影",
    type: "flash",
    trigger: "hold-release",
    releaseActivates: true,
    chargeRate: 0,
    chargeMax: 3,
    initialGauge: 3,
    initialAmmo: 3,
    maxAmmo: 3,
    filmReloadFrames: 36,
    maxHitstopFrames: 180,
    damage: 0,
    guardable: true,
    justGuardable: true,
    sameComboLimit: 1,
    damageTakenScaleWhileStunned: 0.5,
    throwAllowedWhileStunned: false,
    specialAllowedWhileStunned: false,
    phase: phase(18, 0, 3, 24),
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "ko"]),
    effectId: "skill-flash",
    spriteActions: Object.freeze(["skill_flash_charge", "skill_flash_fire", "skill_flash_fail", "skill_flash_reload"]),
  }),
});

export const CHARACTER_SKILLS = SKILL_CONFIGS;
export const SKILL_IDS = Object.freeze(Object.keys(SKILL_CONFIGS));

export function getSkillConfig(characterId) {
  return SKILL_CONFIGS[characterId] || null;
}

export function isSkillPhase(value) {
  return SKILL_PHASES.includes(value);
}

export function canTransitionSkillPhase(from, to) {
  if (!isSkillPhase(from) || !isSkillPhase(to)) return false;
  if (from === to) return true;
  return SKILL_PHASE_TRANSITIONS[from].includes(to);
}

export function isSkillInterruption(reason) {
  return SKILL_INTERRUPTION_REASONS.includes(reason);
}

export function skillBlockedByState(fighter = {}) {
  const state = fighter.state || fighter.action;
  return SKILL_LOCKOUT_STATES.includes(state) || fighter.downed === true || fighter.wakeupTimer > 0 || fighter.skillInterrupted === true;
}

export function canStartSkill(fighter = {}, configOrId = fighter.id) {
  const config = typeof configOrId === "string" ? getSkillConfig(configOrId) : configOrId;
  if (!config || !fighter || fighter.hp === 0 || skillBlockedByState(fighter)) return false;
  const current = fighter.skillPhase || fighter.skillState || "skillUnavailable";
  if (current !== "skillUnavailable" && current !== "skillRecovery") return false;
  if (fighter.state === "special" || String(fighter.action || "").startsWith("special")) return false;
  if (config.initialAmmo > 0 && Number(fighter.ammo ?? fighter.skillAmmo ?? config.initialAmmo) <= 0 && config.type !== "flash") return false;
  if (config.type === "mirror" && Number(fighter.skillGauge ?? fighter.gauge?.skill ?? config.initialGauge) <= 0) return false;
  return true;
}

export function canContinueSkill(fighter = {}, configOrId = fighter.id, reason = null) {
  const config = typeof configOrId === "string" ? getSkillConfig(configOrId) : configOrId;
  if (!config || !fighter || !isSkillPhase(fighter.skillPhase || fighter.skillState)) return false;
  if (reason && isSkillInterruption(reason) && config.interruption.includes(reason)) return false;
  return !skillBlockedByState({ ...fighter, state: "idle", action: "idle" });
}

/** Return an immutable transition result; integration can apply it to state. */
export function interruptSkill(fighter = {}, reason = "hit") {
  const validReason = isSkillInterruption(reason) ? reason : "hit";
  const nextSkill = fighter.skill ? {
    ...fighter.skill,
    phase: "skillUnavailable",
    interrupted: true,
    interruptionReason: validReason,
    recoveryFrames: 0,
  } : fighter.skill;
  return Object.freeze({
    ...fighter,
    skill: nextSkill,
    skillPhase: "skillUnavailable",
    skillState: "skillUnavailable",
    skillInterrupted: true,
    skillInterruptionReason: validReason,
    skillRecoveryFrames: 0,
  });
}

export const interruptSkillState = interruptSkill;
