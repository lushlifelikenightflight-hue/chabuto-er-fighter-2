import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CHARACTERS, STAGES } from "../src/data.js";
import { createFighterState } from "../src/engine.js";
import { Game, SCREEN, skillStatusTextFor } from "../src/game.js";
import { getSkillConfig, getSkillHudState } from "../src/skills.js";
import { createExpandedAnimationManifest, getEffectAssetManifest } from "../src/sprite-manifest.js";

test("held dash loops all three authored running frames", () => {
  const clip = createExpandedAnimationManifest("guitar-boy").dash;
  assert.equal(clip.loop, true);
  assert.deepEqual(clip.frames.map((path) => path.match(/movement-(\d+)\.png$/)?.[1]), ["7", "8", "9"]);
});

test("every stage platform resolves to a runtime PNG and layouts are distinct", () => {
  const layouts = new Set();
  for (const stage of STAGES) {
    assert.ok(stage.platforms.length >= 2);
    layouts.add(stage.platforms.map(({ x, y, w, asset }) => `${x}:${y}:${w}:${asset}`).join("|"));
    for (const platform of stage.platforms) {
      assert.equal(fs.existsSync(new URL(`../assets/platforms/${platform.asset}.png`, import.meta.url)), true, `${stage.id}:${platform.asset}`);
    }
  }
  assert.equal(layouts.size, STAGES.length);
});

test("Kazushige activates on the first full charge and exposes charge then duration HUD", () => {
  const game = new Game(null);
  const fighter = createFighterState("kazushige", 100, 1);
  game.player = fighter; game.cpu = createFighterState("uncle", 330, -1);
  const config = getSkillConfig("kazushige");
  assert.equal(getSkillHudState(fighter, config).mode, "charge");
  assert.equal(game.startSkill(fighter, { skill: true, skillPressed: true }), true);
  for (let frame = 0; frame < 240 && !fighter.buff; frame += 1) game.updateFighter(fighter, { skill: true }, true);
  assert.ok(fighter.buff?.frames > 0);
  assert.equal(getSkillHudState(fighter, config).mode, "duration");
  assert.equal(fighter.state, "idle");
});

test("Guitar copied Flash produces exactly two immediate working shots", () => {
  const game = new Game(null);
  const guitar = createFighterState("guitar-boy", 100, 1);
  game.player = guitar; game.cpu = createFighterState("toko", 300, -1);
  guitar.copiedSkillId = "toko"; guitar.copiedSkillUses = 2; guitar.copyCharges = 2;
  for (let use = 0; use < 2; use += 1) {
    const before = game.skillEntities.filter((entry) => entry.type === "flash").length;
    assert.equal(game.startSkill(guitar, { skillPressed: true }), true);
    assert.equal(game.skillEntities.filter((entry) => entry.type === "flash").length, before + 1);
    guitar.skillPhase = "skillUnavailable"; guitar.skillState = "skillUnavailable"; guitar.skill.phase = "skillUnavailable"; guitar.skillConfig = null; guitar.state = "idle";
  }
  assert.equal(guitar.copiedSkillUses, 0);
});

test("specials use the raster explosion manifest in one facing direction", () => {
  const game = new Game(null);
  const uncle = createFighterState("uncle", 350, -1);
  game.player = uncle; game.cpu = createFighterState("toko", 100, 1);
  game.commitSpecial(uncle, CHARACTERS.uncle.special);
  const explosions = game.state.vfx.filter((entry) => entry.effectId === "super-explosion");
  assert.equal(explosions.length, 1);
  assert.equal(explosions[0].facing, -1);
  assert.equal(getEffectAssetManifest("super-explosion").frames.length, 4);
});

test("a single SPECIAL press commits after its cinematic and reaches the authored startup", () => {
  const game = new Game(null);
  const kazushige = createFighterState("kazushige", 100, 1);
  game.player = kazushige; game.cpu = createFighterState("uncle", 330, -1);
  game.state.screen = SCREEN.battle;
  kazushige.meter = 100;
  const move = CHARACTERS.kazushige.special;
  assert.equal(game.startSpecial(kazushige), true);
  for (let frame = 0; frame < 32; frame += 1) game.tickBattle({});
  assert.equal(game.state.specialCinematic, null);
  assert.equal(kazushige.currentMove, move);
  for (let frame = 0; frame < move.startupFrames; frame += 1) game.tickBattle({});
  assert.equal(kazushige.projectileSpawned, true);
});

test("skill status text is limited to the specified charging and reload states", () => {
  assert.equal(skillStatusTextFor({ id: "guitar-boy", skillPhase: "skillCharging" }), "猛烈に耳コピ中");
  assert.equal(skillStatusTextFor({ id: "rusty", skillPhase: "skillCharging" }), "犬、呼んでます");
  assert.equal(skillStatusTextFor({ id: "kazushige", skillPhase: "skillCharging" }), "バトル中らーめん。");
  assert.equal(skillStatusTextFor({ id: "toko", skillAmmo: 0, flashReloading: true }), "フィルム交換しなくちゃ");
  assert.equal(skillStatusTextFor({ id: "toko", skillAmmo: 1, flashReloading: true }), "");
});

test("virtual input unlocks Web Audio and SE reaches an oscillator", () => {
  const PreviousAudioContext = globalThis.AudioContext;
  let starts = 0;
  class FakeAudioContext {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { type: "", frequency: { value: 0 }, connect: (node) => node, start: () => { starts += 1; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (node) => node }; }
  }
  globalThis.AudioContext = FakeAudioContext;
  try {
    const game = new Game(null);
    game.state.bgmEnabled = false;
    assert.equal(typeof game.touchInput.onInput, "function");
    game.touchInput.onInput();
    game.beep(360, 0.03, "triangle");
    assert.equal(starts, 1);
  } finally {
    globalThis.AudioContext = PreviousAudioContext;
  }
});

test("Kazushige attack buff also scales throw damage", () => {
  const damageFor = (scale) => {
    const game = new Game(null);
    const attacker = createFighterState("kazushige", 100, 1);
    const defender = createFighterState("uncle", 122, -1);
    game.player = attacker; game.cpu = defender;
    game.startThrow(attacker);
    attacker.throwTarget = defender;
    attacker.actionFrame = attacker.currentMove.startupFrames + attacker.currentMove.activeFrames + 6;
    if (scale !== 1) attacker.buff = { attackScale: scale, frames: 60 };
    const before = defender.hp;
    game.updateThrowSequence();
    return before - defender.hp;
  };
  const normal = damageFor(1);
  const buffed = damageFor(1.35);
  assert.ok(buffed > normal * 1.34);
});

test("special cut-ins reserve side lanes while score and training HUD stay centered", () => {
  const game = new Game(null);
  game.state.mode = "training";
  game.state.specialCinematic = { fighter: game.player, move: CHARACTERS[game.player.id].special, frames: 10 };
  const rectangles = []; const labels = [];
  const ctx = {
    save() {}, restore() {}, translate() {}, scale() {}, drawImage() {}, beginPath() {}, arc() {}, stroke() {}, strokeText() {},
    fillRect(...args) { rectangles.push(args); }, strokeRect(...args) { rectangles.push(args); },
    fillText(...args) { labels.push(args); },
  };
  game.drawBattle(ctx);
  assert.equal(rectangles.some(([x, y, w, h]) => x === 16 && y === 54 && w === 116 && h === 54), true);
  for (const prefix of ["000000", "TRAINING", "COMMAND:"]) {
    const label = labels.find(([value]) => String(value).startsWith(prefix));
    assert.ok(label, prefix);
    assert.equal(label[1], 240);
    assert.equal(label[3], 200);
  }
});
