import test from "node:test";
import assert from "node:assert/strict";
import {
  CHARACTERS,
  CHARACTER_IDS,
} from "../src/data.js";
import {
  COMBO_PREINPUT_FRAMES,
  DOWN_CONFIG,
  KNOCKDOWN_THRESHOLD,
  JUST_GUARD_CONFIG,
  canDownFollowup,
  comboDamageScale,
  createFighterState,
  getKnockdownRecoveryFrames,
  isJustGuardEligible,
  isKnockdownReached,
  shouldKnockdown,
} from "../src/engine.js";
import {
  SKILL_CONFIGS,
  SKILL_INTERRUPTION_REASONS,
  SKILL_PHASES,
  canStartSkill,
  canTransitionSkillPhase,
  getSkillConfig,
  interruptSkill,
} from "../src/skills.js";
import { EFFECT_REGISTRY, effectForMove } from "../src/vfx.js";

test("all eight fighters expose required combat stats and normalized move data", () => {
  const stats = [
    "maxHp", "walkSpeed", "dashSpeed", "backstepDistance", "jumpPower", "airControl",
    "lightDamage", "heavyDamage", "attackStartupModifier", "attackRecoveryModifier",
    "comboLimit", "hitstunScaling", "guardStun", "throwDamage", "specialGainRate",
    "skillChargeRate", "weight", "knockdownResistance",
  ];
  const moves = ["light_attack_neutral", "light_attack_crouch", "light_attack_air", "strong_attack_neutral", "strong_attack_crouch", "strong_attack_air", "forward_light", "special"];
  for (const id of CHARACTER_IDS) {
    const fighter = CHARACTERS[id];
    for (const key of stats) assert.equal(Number.isFinite(fighter.stats[key]), true, `${id}.${key}`);
    assert.equal(fighter.stats.maxHp, fighter.stats.hp);
    assert.equal(fighter.stats.walkSpeed, fighter.stats.speed);
    assert.equal(fighter.stats.jumpPower, fighter.stats.jumpVelocity);
    for (const moveId of moves) {
      const move = fighter.moves[moveId] || fighter.special;
      for (const key of ["knockdownValue", "causesKnockdown", "hardKnockdown", "effectId", "effectScale", "effectOffsetX", "effectOffsetY", "hitboxWidth", "hitboxHeight", "hitboxOffsetX", "hitboxOffsetY"]) {
        assert.ok(key in move, `${id}.${moveId}.${key}`);
      }
      assert.ok(EFFECT_REGISTRY[move.effectId], `${id}.${moveId} effect ${move.effectId}`);
      assert.equal(move.hitbox.w, move.hitboxWidth);
      assert.equal(move.hitbox.h, move.hitboxHeight);
      assert.notEqual(effectForMove(move), move.hitbox);
    }
  }
});

test("fighter state initializes down, wakeup, combo, guard-dash, skill, and round carry fields", () => {
  const fighter = createFighterState("guitar-boy", 100, 1);
  for (const key of ["downValue", "downedFrames", "downFollowupUsed", "wakeupTimer", "followupCount", "comboScale", "guardDashCooldown", "hitstopFrames", "skillGauge", "ammo", "copyCharges", "roundCarry"]) {
    assert.ok(key in fighter, key);
  }
  assert.equal(fighter.state, "idle");
  assert.equal(fighter.grounded, true);
  assert.equal(fighter.skillPhase, "skillUnavailable");
  assert.deepEqual(fighter.roundCarry, { meter: 0, specialGauge: 0, skillGauge: 0, ammo: 0, copyCharges: 0 });
  assert.notEqual(createFighterState("guitar-boy", 100).gauge, fighter.gauge);
});

test("knockdown threshold and recovery helpers follow normal versus hard down rules", () => {
  assert.equal(isKnockdownReached(KNOCKDOWN_THRESHOLD - 1), false);
  assert.equal(isKnockdownReached(KNOCKDOWN_THRESHOLD), true);
  assert.equal(shouldKnockdown({ causesKnockdown: true }, 0), true);
  assert.equal(shouldKnockdown({ causesKnockdown: false }, KNOCKDOWN_THRESHOLD), true);
  assert.equal(getKnockdownRecoveryFrames(false), DOWN_CONFIG.landingFrames + DOWN_CONFIG.wakeupFrames);
  assert.ok(getKnockdownRecoveryFrames(true) > getKnockdownRecoveryFrames(false));
  const downed = createFighterState("uncle", 100);
  downed.state = "downed";
  downed.downed = true;
  assert.equal(canDownFollowup(downed), true);
  downed.followupUsed = true;
  assert.equal(canDownFollowup(downed), false);
});

test("just guard eligibility excludes unblockables and throws", () => {
  assert.equal(isJustGuardEligible(CHARACTERS["guitar-boy"].moves.light), true);
  assert.equal(isJustGuardEligible(CHARACTERS["guitar-boy"].special), false);
  assert.equal(isJustGuardEligible({ kind: "throw" }), false);
  assert.ok(JUST_GUARD_CONFIG.attackerRecoilFrames >= 10 && JUST_GUARD_CONFIG.attackerRecoilFrames <= 14);
});

test("skill phases, interruption, and eight exact character configs are data-only", () => {
  assert.deepEqual(SKILL_PHASES, ["skillStartup", "skillCharging", "skillActive", "skillRecovery", "skillUnavailable"]);
  assert.equal(Object.keys(SKILL_CONFIGS).length, 8);
  assert.equal(canTransitionSkillPhase("skillUnavailable", "skillStartup"), true);
  assert.equal(canTransitionSkillPhase("skillActive", "skillStartup"), false);
  assert.equal(SKILL_INTERRUPTION_REASONS.includes("hit"), true);
  for (const id of CHARACTER_IDS) {
    const config = getSkillConfig(id);
    assert.equal(config.id, id);
    assert.ok(config.effectId);
    assert.ok(EFFECT_REGISTRY[config.effectId]);
  }
  const ready = createFighterState("guitar-boy", 100);
  assert.equal(canStartSkill(ready), true);
  const guard = { ...ready, state: "guarding" };
  assert.equal(canStartSkill(guard), false);
  const interrupted = interruptSkill(ready, "hit");
  assert.equal(interrupted.skillPhase, "skillUnavailable");
  assert.equal(interrupted.skillInterrupted, true);
});

test("combo limits and pre-input scaling are bounded per fighter", () => {
  assert.equal(COMBO_PREINPUT_FRAMES >= 6 && COMBO_PREINPUT_FRAMES <= 10, true);
  const fast = comboDamageScale(1, CHARACTERS["bob-girl"]);
  const heavy = comboDamageScale(4, CHARACTERS.rusty);
  assert.ok(fast <= 1.25 && fast >= 0.45);
  assert.ok(heavy <= 1.25 && heavy >= 0.45);
  assert.ok(CHARACTERS["bob-girl"].stats.comboLimit > CHARACTERS.rusty.stats.comboLimit);
});
