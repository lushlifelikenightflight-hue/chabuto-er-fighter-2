import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CHARACTERS, TRAINING_SETTINGS_ITEMS } from "../src/data.js";
import { createFighterState, evaluateStrike, evaluateThrow } from "../src/engine.js";
import { Game } from "../src/game.js";
import { getSkillConfig } from "../src/skills.js";
import { getEffectAssetManifest } from "../src/sprite-manifest.js";

test("every screen keeps menu controls available outside battle and pause is header-owned", () => {
  const gameSource = fs.readFileSync(new URL("../src/game.js", import.meta.url), "utf8");
  const touchSource = fs.readFileSync(new URL("../src/touch-input.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(gameSource, /touchMode = touchBattleScreens\.has\(screen\) \? "battle" : "menu"/);
  assert.match(html, /data-header-pause[^>]*disabled[^>]*>PAUSE<\/button>/);
  assert.doesNotMatch(touchSource, /createButton\("pause"/);
  assert.deepEqual(TRAINING_SETTINGS_ITEMS, ["START TRAINING", "CPU MOVE", "CPU ATTACK", "BACK"]);
});

test("attack wind appears on whiff and a contact burst uses the overlap position", () => {
  const game = new Game(null);
  const attacker = createFighterState("guitar-boy", 100, 1);
  game.player = attacker;
  game.cpu = createFighterState("toko", 450, -1);
  assert.equal(game.startAttack(attacker, { lightPressed: true }), true);
  for (let i = 0; i <= attacker.currentMove.startupFrames; i += 1) game.updateFighter(attacker, {}, true);
  assert.equal(game.state.vfx.some((effect) => effect.effectId === "attack-wind"), true);

  const defender = createFighterState("uncle", 126, -1);
  game.cpu = defender;
  attacker.state = "attacking";
  attacker.currentMove = CHARACTERS[attacker.id].moves.strong_attack_neutral;
  attacker.currentAttackId = "contact-test";
  attacker.actionFrame = attacker.currentMove.startupFrames;
  attacker.hitRegistry.clear();
  game.handleCombat(attacker, defender);
  const burst = game.state.vfx.findLast((effect) => effect.effectId === "hit-burst");
  assert.ok(burst);
  assert.notEqual(Math.round(burst.x), Math.round(defender.x));
  assert.equal(getEffectAssetManifest("attack-wind").frames.length, 4);
  assert.equal(getEffectAssetManifest("hit-burst").frames.length, 4);
});

test("knockdown launches, lands, and holds the down state before wakeup", () => {
  const game = new Game(null);
  const fighter = createFighterState("toko", 160, -1);
  game.launchKnockdown(fighter, { knockbackY: 4.5, hardKnockdown: false });
  assert.equal(fighter.state, "knockback");
  assert.equal(fighter.grounded, false);
  for (let i = 0; i < 90 && !fighter.downed; i += 1) game.updateFighter(fighter, {}, false);
  assert.equal(fighter.downed, true);
  assert.ok(["knockdownLanding", "downed"].includes(fighter.state));
  const landedState = fighter.state;
  for (let i = 0; i < 12; i += 1) game.updateFighter(fighter, {}, false);
  assert.notEqual(fighter.state, "idle");
  assert.ok(landedState === "knockdownLanding" || fighter.state === "downed");
});

test("combo cap starts cooldown and attack/guard/throw priority is deterministic", () => {
  const game = new Game(null);
  const attacker = createFighterState("rusty", 100, 1);
  const defender = createFighterState("toko", 126, -1);
  game.player = attacker; game.cpu = defender;
  attacker.comboHits = CHARACTERS.rusty.stats.comboLimit - 1;
  attacker.state = "attacking";
  attacker.currentMove = CHARACTERS.rusty.moves.light_attack_neutral;
  attacker.currentAttackId = "combo-cap";
  attacker.actionFrame = attacker.currentMove.startupFrames;
  game.handleCombat(attacker, defender);
  assert.ok(attacker.attackCooldownFrames > 0);
  attacker.state = "idle"; attacker.currentMove = null;
  assert.equal(game.startAttack(attacker, { lightPressed: true }), false);

  const guard = createFighterState("uncle", 126, -1);
  guard.state = "guarding"; guard.action = "guard_high"; guard.guardHeld = true;
  const strike = CHARACTERS.rusty.moves.light_attack_neutral;
  attacker.state = "attacking"; attacker.currentMove = strike; attacker.actionFrame = strike.startupFrames;
  assert.equal(evaluateStrike(attacker, guard, strike, strike.startupFrames, new Set()).blocked, true);
  assert.equal(evaluateThrow(attacker, guard, 0), true);
  guard.state = "attacking"; guard.currentMove = CHARACTERS.uncle.moves.light_attack_neutral;
  assert.equal(evaluateThrow(attacker, guard, 0), false);
});

test("partial charge persists, Norio auto-fires, Toko repeats, and Uncle travels by charge", () => {
  const game = new Game(null);
  const rusty = createFighterState("rusty", 100, 1);
  game.player = rusty; game.cpu = createFighterState("guitar-boy", 400, -1);
  game.startSkill(rusty, { skill: true, skillPressed: true });
  for (let i = 0; i < 45; i += 1) game.updateFighter(rusty, { skill: true }, true);
  game.updateFighter(rusty, { skill: false, skillReleased: true }, true);
  assert.ok(rusty.skillGauge > 0);

  const norio = createFighterState("norio", 100, 1);
  game.player = norio; game.cpu = createFighterState("uncle", 400, -1); game.skillEntities = [];
  game.startSkill(norio, { skill: true, skillPressed: true });
  for (let i = 0; i < 220 && !game.skillEntities.some((entity) => entity.type === "snareMarker"); i += 1) game.updateFighter(norio, { skill: true }, true);
  assert.equal(game.skillEntities.some((entity) => entity.type === "snareMarker"), true);
  assert.equal(game.skillEntities.find((entity) => entity.type === "snareMarker").y, 88);

  const kazushige = createFighterState("kazushige", 100, 1);
  game.player = kazushige; game.cpu = createFighterState("uncle", 400, -1); game.skillEntities = [];
  game.startSkill(kazushige, { skill: true, skillPressed: true });
  for (let i = 0; i < 220; i += 1) game.updateFighter(kazushige, { skill: true }, true);
  assert.equal(kazushige.skillPhase, "skillUnavailable");
  assert.ok(kazushige.buff?.frames > 0);

  const toko = createFighterState("toko", 100, 1);
  const target = createFighterState("guitar-boy", 141, -1);
  game.player = toko; game.cpu = target; game.skillEntities = [];
  game.activateSkill(toko, getSkillConfig("toko"));
  game.updateSkillEntities();
  assert.equal(target.flashStunned, true);
  target.flashStunFrames = 1; target.stunFrames = 1; target.state = "hitstun";
  game.updateFighter(target, {}, false);
  assert.equal(target.flashComboHit, false);
  game.activateSkill(toko, getSkillConfig("toko"));
  target.x = game.skillEntities.at(-1).x + game.skillEntities.at(-1).vx;
  game.updateSkillEntities();
  assert.equal(target.flashStunned, true);

  const uncle = createFighterState("uncle", 24, 1);
  game.player = uncle; game.cpu = createFighterState("toko", -1000, -1); game.skillEntities = [];
  uncle.skillGauge = getSkillConfig("uncle").chargeMax;
  game.activateSkill(uncle, getSkillConfig("uncle"));
  const fullSpeed = Math.abs(game.skillEntities[0].vx);
  for (let i = 0; i < 30; i += 1) game.updateSkillEntities();
  assert.ok(uncle.x >= 450);
  const partialUncle = createFighterState("uncle", 24, 1);
  game.player = partialUncle; game.cpu = createFighterState("toko", -1000, -1); game.skillEntities = [];
  partialUncle.skillGauge = getSkillConfig("uncle").chargeMax * 0.25;
  game.activateSkill(partialUncle, getSkillConfig("uncle"));
  assert.ok(Math.abs(game.skillEntities[0].vx) < fullSpeed);
});

test("title panel uses the supplied logo asset", () => {
  const gameSource = fs.readFileSync(new URL("../src/game.js", import.meta.url), "utf8");
  assert.match(gameSource, /assets\/ui\/title-logo\.png/);
  assert.equal(fs.existsSync(new URL("../assets/ui/title-logo.png", import.meta.url)), true);
});
