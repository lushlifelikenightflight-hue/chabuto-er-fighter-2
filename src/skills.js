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

// A B press is a charge gesture, not an instant action.  Keeping the
// threshold in one data-only module lets keyboard, gamepad, touch and CPU
// inputs share the same deterministic contract (350 ms at the fixed 60 Hz
// simulation rate).
export const SKILL_HOLD_THRESHOLD_MS = 350;
export const SKILL_HOLD_THRESHOLD_FRAMES = Math.ceil(SKILL_HOLD_THRESHOLD_MS / (1000 / 60));

export const SKILL_HUD_MODES = Object.freeze(["charge", "ammo", "uses", "duration"]);

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
  "throwing",
  "grabbed",
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
    skillInputMode: "hold",
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
    skillInputMode: "holdRelease",
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
    // Two seconds at the fixed 60 Hz simulation rate.
    cooldownFrames: 120,
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
    skillInputMode: "hold",
    trigger: "hold",
    releaseActivates: false,
    chargeRate: 1,
    chargeMax: 100,
    initialGauge: 0,
    initialAmmo: 0,
    maxAmmo: 3,
    phase: phase(3, 0, 10, 8),
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "special", "ko"]),
    reflectable: Object.freeze(["normalStrike", "strongStrike", "throw", "projectile", "energy", "linearSpecial", "tackle", "groundAttack", "overheadDrop", "downFollowup", "summon", "status"]),
    nonReflectable: Object.freeze([]),
    effectId: "skill-mirror",
    spriteActions: Object.freeze(["skill_mirror_start", "skill_mirror_hold", "skill_mirror_success", "skill_mirror_fail"]),
  }),
  uncle: Object.freeze({
    id: "uncle",
    skillId: "tackle",
    name: "タックル",
    type: "tackle",
    skillInputMode: "holdRelease",
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
    skillInputMode: "holdRelease",
    hudMode: "charge",
    hudLabel: "DOG",
    trigger: "hold-release",
    releaseActivates: true,
    chargeRate: 2,
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
    skillInputMode: "hold",
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
    phase: phase(6, 0, 12, 20),
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "ko"]),
    effectId: "skill-ramen",
    spriteActions: Object.freeze(["skill_ramen_start", "skill_ramen_loop", "skill_ramen_complete", "skill_ramen_fail"]),
  }),
  norio: Object.freeze({
    id: "norio",
    skillId: "drum-beat",
    name: "ドラムビート",
    type: "drumBeat",
    skillInputMode: "holdRelease",
    trigger: "hold-release",
    releaseActivates: true,
    chargeRate: 1,
    chargeMax: 100,
    initialGauge: 0,
    initialAmmo: 0,
    maxAmmo: 16,
    durationFrames: 480,
    intervalFrames: 30,
    snareCount: 16,
    perTargetHitLimit: 3,
    // Preserve the authored baseline and expose the requested 2x collision range.
    hitboxScale: 2.36,
    phase: phase(8, 0, 12, 24),
    interruption: Object.freeze(["hit", "throw", "down", "knockdown", "ko"]),
    effectId: "skill-drum-beat",
    spriteActions: Object.freeze(["skill_drum_count", "skill_drum_marker", "skill_drum_drop", "skill_drum_end"]),
  }),
  toko: Object.freeze({
    id: "toko",
    skillId: "flash",
    name: "フラッシュ撮影",
    type: "flash",
    // Flash is a discrete shutter press.  It must not inherit the generic
    // charge/hold gesture because a held B would otherwise issue extra shots.
    skillInputMode: "press",
    trigger: "hold",
    releaseActivates: false,
    chargeRate: 0,
    chargeMax: 3,
    initialGauge: 3,
    initialAmmo: 3,
    maxAmmo: 3,
    filmReloadFrames: 36,
    maxHitstopFrames: 180,
    projectileSpeed: 6,
    projectileDurationFrames: 180,
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

/**
 * Return the normalized resource model consumed by the in-game HUD.  The
 * model deliberately keeps value/max separate from presentation so an ammo,
 * uses, duration, or charge skill can all share the same rendering path.
 */
export function getSkillHudState(fighter = {}, configOrId = fighter.id) {
  const config = typeof configOrId === "string" ? getSkillConfig(configOrId) : (configOrId || getSkillConfig(fighter.id));
  if (!config) return Object.freeze({ value: 0, max: 0, mode: "charge", label: "SKILL", ready: false, disabled: true });
  const type = config.type;
  // Ramen needs to show the held charge before activation, then its remaining
  // enhancement time once active.  Treating it as duration at zero hid the
  // actual charge and made a full first charge look like a failed attempt.
  const ramenActive = type === "ramenBuff" && Number(fighter.buff?.frames || 0) > 0;
  const mode = config.hudMode || (type === "copy" ? (Number(fighter.copiedSkillUses || fighter.copyCharges || 0) > 0 ? "uses" : "charge") : type === "drumBeat" ? (fighter.norioVolleyActive ? "ammo" : "charge") : type === "mirror" ? (Number(fighter.skillAmmo || fighter.ammo || 0) > 0 ? "ammo" : "charge") : type === "flash" ? "ammo" : type === "ramenBuff" ? (ramenActive ? "duration" : "charge") : "charge");
  const max = Math.max(0, Number(mode === "duration" ? (config.buffDurationFrames || config.durationFrames || config.chargeMax) : mode === "ammo" || mode === "uses" ? (config.maxAmmo || config.copyCharges || config.copiedSkillUses || config.chargeMax) : config.chargeMax) || 0);
  const resourceValue = type === "copy" ? (fighter.copiedSkillUses ?? fighter.copyCharges ?? fighter.ammo ?? fighter.skillAmmo ?? 0) : (fighter.ammo ?? fighter.skillAmmo ?? 0);
  const value = Math.max(0, Number(mode === "duration" ? (fighter.buff?.frames || 0) : mode === "ammo" || mode === "uses" ? resourceValue : (fighter.skillGauge ?? fighter.skill?.gauge ?? 0)) || 0);
  // `ready` describes the resource itself.  `disabled` separately reflects
  // the action/state lock, so a rusty player can start charging at zero while
  // the HUD still exposes a not-ready meter and a full meter can light up
  // while the release is still pending.
  const phaseAvailable = fighter.skillPhase === "skillUnavailable" || !fighter.skillPhase;
  const cooldownRemaining = config.type === "slimeShot" ? Math.max(0, Number(fighter.slimeCooldown || 0)) : 0;
  const ready = cooldownRemaining <= 0 && fighter.hp > 0 && (mode === "charge" ? max > 0 && value >= max : value > 0);
  const disabled = !phaseAvailable || cooldownRemaining > 0 || !canStartSkill(fighter, config);
  return Object.freeze({
    value: Math.min(value, max || value),
    max,
    mode,
    label: config.hudLabel || config.name || config.skillId || "SKILL",
    ready,
    disabled,
    cooldownRemaining,
  });
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
  if (config.initialAmmo > 0 && Number(fighter.ammo ?? fighter.skillAmmo ?? config.initialAmmo) <= 0 && config.type !== "flash") return false;
  if (config.type === "slimeShot" && Number(fighter.slimeCooldown || 0) > 0) return false;
  if (config.type === "ramenBuff" && Number(fighter.buff?.frames || 0) > 0) return false;
  if (config.type === "drumBeat" && Array.isArray(fighter.skillEntities) && fighter.skillEntities.some((entry) => entry.active && ["snareMarker", "snareImpact"].includes(entry.type))) return false;
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
