import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { INTERNAL_HEIGHT, INTERNAL_WIDTH, STAGE_BGM_PROFILES } from "../src/data.js";
import { createFighterState } from "../src/engine.js";
import { Game, SCREEN } from "../src/game.js";
import { getSkillConfig } from "../src/skills.js";

test("stage BGM uses supplied tracks and keeps Rusty's existing track", () => {
  assert.deepEqual(STAGE_BGM_PROFILES.map((profile) => profile.source), [
    "assets/audio/bgm-toko.mp3",
    "assets/audio/bgm-norio.mp3",
    "assets/audio/bgm-kazushige.mp3",
    "assets/audio/bgm-title.mp3",
    "assets/audio/bgm-mirror.mp3",
  ]);
  for (const profile of STAGE_BGM_PROFILES) assert.equal(existsSync(profile.source), true, profile.source);
});

test("Rusty charges twice as fast and slime cooldown is two seconds", () => {
  assert.equal(getSkillConfig("rusty").chargeRate, 2);
  assert.equal(getSkillConfig("green-slime").cooldownFrames, 120);
});

test("B recovers after interruption and cancels stale ordinary attack state", () => {
  const game = new Game(null);
  const fighter = createFighterState("toko", 100, 1);
  game.player = fighter;
  game.cpu = createFighterState("rusty", 300, -1);
  Object.assign(fighter, {
    state: "attacking", action: "light_stand", currentMove: { id: "stale-light", kind: "normal" },
    pendingProjectile: { stale: true }, comboBuffer: { frames: 10 },
    skillPhase: "skillUnavailable", skillInterrupted: true, skillInterruptionReason: "hit",
  });

  assert.equal(game.startSkill(fighter, { skillPressed: true }), true);
  assert.equal(fighter.skillInterrupted, false);
  assert.equal(fighter.state, "skillStartup");
  assert.equal(fighter.currentMove, null);
  assert.equal(fighter.pendingProjectile, null);
  assert.equal(fighter.comboBuffer, null);
});

test("B never cancels an active throw into a permanent grabbed state", () => {
  const game = new Game(null);
  const attacker = createFighterState("toko", 100, 1);
  const defender = createFighterState("rusty", 120, -1);
  game.player = attacker;
  game.cpu = defender;
  attacker.state = "throwing";
  attacker.action = "throw_success";
  attacker.throwTarget = defender;
  defender.state = "grabbed";
  defender.thrownBy = attacker;
  assert.equal(game.startSkill(attacker, { skillPressed: true }), false);
  assert.equal(attacker.throwTarget, defender);
  assert.equal(defender.thrownBy, attacker);
});

test("rain only affects configured stages and 1.5 seconds of dashing slips", () => {
  const game = new Game(null);
  game.state.screen = SCREEN.battle;
  game.state.stage = 1;
  game.player = createFighterState("toko", 100, 1);
  game.cpu = createFighterState("rusty", 300, -1);
  game.player.grounded = true;
  for (let frame = 180; frame < 270; frame += 1) {
    game.state.battleFrames = frame;
    game.player.action = "dash";
    game.updateWeather();
  }
  assert.equal(game.state.weather.type, "rain");
  assert.equal(game.state.combatNotice.text, "SLIP!");
  assert.equal(game.player.state, "knockback");

  const dry = new Game(null);
  dry.state.stage = 2;
  dry.player = createFighterState("norio", 100, 1);
  dry.cpu = createFighterState("toko", 300, -1);
  dry.player.action = "dash";
  dry.state.battleFrames = 200;
  dry.updateWeather();
  assert.equal(dry.state.weather.type, "clear");
  assert.equal(dry.player.rainDashFrames, 0);
});

test("KO notice is centered, large, and persistent", () => {
  const game = new Game(null);
  game.showCombatNotice("K.O.", "ko");
  assert.equal(game.state.combatNotice.x, INTERNAL_WIDTH * 0.5);
  assert.equal(game.state.combatNotice.y, INTERNAL_HEIGHT * 0.5);
  assert.ok(game.state.combatNotice.frames > 180);
  const calls = [];
  const ctx = {
    save() {}, restore() {}, fillRect() {}, strokeRect() {}, strokeText() {},
    fillText(text, x, y) { calls.push([text, x, y, this.font]); },
  };
  game.drawHud(ctx);
  const ko = calls.find((entry) => entry[0] === "K.O.");
  assert.deepEqual(ko.slice(1, 3), [INTERNAL_WIDTH * 0.5, INTERNAL_HEIGHT * 0.5]);
  assert.match(ko[3], /48px/);
});

test("Bob mirror startup effect is centered on the fighter body", () => {
  const game = new Game(null);
  const bob = createFighterState("bob-girl", 140, 1);
  game.player = bob;
  game.cpu = createFighterState("toko", 300, -1);
  bob.skillAmmo = 1;
  bob.ammo = 1;
  assert.equal(game.startSkill(bob, { skillPressed: true }), true);
  const mirror = game.state.vfx.find((effect) => effect.effectId === "skill-mirror");
  assert.equal(mirror.x, bob.x);
  assert.equal(mirror.y, bob.y + 82);
});
