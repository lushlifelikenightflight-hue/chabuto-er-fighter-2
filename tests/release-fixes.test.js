import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CHARACTERS, INTERNAL_WIDTH, STAGES, STAGE_BGM_PROFILES, STAGE_BOUNDS } from "../src/data.js";
import { createFighterState } from "../src/engine.js";
import { Game, SCREEN, skillStatusTextFor } from "../src/game.js";
import { getSkillConfig, getSkillHudState } from "../src/skills.js";
import { createExpandedAnimationManifest, getEffectAssetManifest } from "../src/sprite-manifest.js";

test("held dash alternates the two authored leg phases without standing frames", () => {
  const clip = createExpandedAnimationManifest("guitar-boy").dash;
  assert.equal(clip.loop, true);
  assert.deepEqual(clip.frames.map((path) => path.match(/movement-(\d+)\.png$/)?.[1]), ["9", "10"]);
});

test("supplied combat WAVs are mapped, loud, and playable through the SE toggle", () => {
  const previousAudio = globalThis.Audio;
  const played = [];
  class FakeAudio {
    constructor(src = "") { this.src = src; this.volume = 0; }
    cloneNode() { const clone = new FakeAudio(this.src); clone.play = () => { played.push({ src: clone.src, volume: clone.volume }); return Promise.resolve(); }; return clone; }
    play() { return Promise.resolve(); }
    pause() {}
  }
  globalThis.Audio = FakeAudio;
  try {
    const game = new Game(null);
    game.state.bgmEnabled = false;
    for (const id of ["light", "strong", "super", "skill", "jump"]) assert.equal(game.playSe(id), true, id);
    assert.deepEqual(played.map(({ src }) => src), [
      "assets/audio/se/light-attack.wav", "assets/audio/se/strong-attack.wav", "assets/audio/se/super.wav",
      "assets/audio/se/skill.wav", "assets/audio/se/jump.wav",
    ]);
    assert.ok(played.every(({ volume }) => volume >= 0.9));
    game.state.seEnabled = false;
    assert.equal(game.playSe("light"), false);
  } finally { globalThis.Audio = previousAudio; }
  for (const name of ["light-attack.wav", "strong-attack.wav", "super.wav", "skill.wav", "jump.wav"]) {
    assert.equal(fs.existsSync(new URL(`../assets/audio/se/${name}`, import.meta.url)), true, name);
  }
});

test("special SE waits for the cinematic to finish", () => {
  const game = new Game(null);
  game.state.screen = SCREEN.battle;
  game.player.meter = 100;
  const played = [];
  game.playSe = (id) => { played.push(id); return true; };
  assert.equal(game.startSpecial(game.player), true);
  assert.deepEqual(played, []);
  for (let frame = 0; frame < 31; frame += 1) game.tickBattle({});
  assert.deepEqual(played, []);
  game.tickBattle({});
  assert.deepEqual(played, ["super"]);
});

test("training selections choose the requested enemy and stage", () => {
  const game = new Game(null);
  game.state.selectedId = "guitar-boy";
  game.state.trainingOpponentId = "kazushige";
  game.state.trainingStage = 4;
  game.startTraining();
  assert.equal(game.cpu.id, "kazushige");
  assert.equal(game.state.stage, 4);
  game.cycleTrainingOpponent();
  assert.equal(game.state.trainingOpponentId, "norio");
  game.cycleTrainingStage();
  assert.equal(game.state.trainingStage, 5);
});

test("every stage has a distinct audible BGM profile", () => {
  assert.equal(STAGE_BGM_PROFILES.length, STAGES.length);
  assert.equal(new Set(STAGE_BGM_PROFILES.map((profile) => `${profile.source}:${profile.playbackRate}:${profile.volume}:${profile.startTime}`)).size, STAGES.length);
});

test("a training stage profile seeks even when it reuses the title track", () => {
  const previousAudio = globalThis.Audio;
  class FakeAudio {
    constructor(src = "") { this.src = src; this.currentTime = 0; this.readyState = 1; this.volume = 0; this.playbackRate = 1; }
    play() { return Promise.resolve(); }
    pause() {}
  }
  globalThis.Audio = FakeAudio;
  try {
    const game = new Game(null);
    game.syncBgm();
    game.state.trainingStage = 2;
    game.startTraining();
    assert.equal(game.bgm.src, STAGE_BGM_PROFILES[1].source);
    assert.equal(game.bgm.currentTime, STAGE_BGM_PROFILES[1].startTime);
  } finally { globalThis.Audio = previousAudio; }
});

test("locomotion rendering keeps its facing stable and Kazushige aura is behind the fighter", () => {
  const game = new Game(null);
  const sprite = { complete: true, naturalWidth: 64, naturalHeight: 64, tag: "sprite" };
  const aura = { complete: true, naturalWidth: 64, naturalHeight: 64, tag: "aura" };
  game.loadSprite = () => sprite;
  game.loadEffectFrame = () => ({ image: aura });
  const calls = [];
  const ctx = { save() {}, restore() {}, translate() {}, scale(x, y) { calls.push(["scale", x, y]); }, drawImage(image, ...args) { calls.push(["draw", image.tag, ...args]); }, fillText() {}, imageSmoothingEnabled: false, globalAlpha: 1, filter: "none" };
  const runner = createFighterState("guitar-boy", 100, -1);
  runner.action = "dash"; runner.actionFrame = 2; runner.locomotionFacing = 1;
  game.drawFighter(ctx, runner);
  assert.equal(calls.some((entry) => entry[0] === "scale" && entry[1] === -1), false);
  calls.length = 0;
  const kazushige = createFighterState("kazushige", 100, 1);
  kazushige.buff = { frames: 60 };
  game.drawFighter(ctx, kazushige);
  assert.deepEqual(calls.filter((entry) => entry[0] === "draw").map((entry) => entry[1]), ["aura", "sprite"]);
  const auraDraw = calls.find((entry) => entry[0] === "draw" && entry[1] === "aura");
  assert.deepEqual(auraDraw.slice(2, 6), [26, 42, 204, 171]);
  assert.ok(auraDraw.at(-1) <= 240);
  assert.equal(auraDraw.at(-3) + auraDraw.at(-1), 0);
  assert.ok(Math.abs(auraDraw.at(-2) / auraDraw.at(-1) - 204 / 171) < 0.001);
  for (const edgeX of [STAGE_BOUNDS.left, STAGE_BOUNDS.right]) {
    calls.length = 0;
    kazushige.x = edgeX;
    game.drawFighter(ctx, kazushige);
    const edgeAura = calls.find((entry) => entry[0] === "draw" && entry[1] === "aura");
    assert.ok(edgeX + edgeAura.at(-4) >= 0);
    assert.ok(edgeX + edgeAura.at(-4) + edgeAura.at(-2) <= INTERNAL_WIDTH);
  }
});

test("supers use a smaller VFX and damage, variety, combos, and skills accelerate meter", () => {
  const game = new Game(null);
  const specialUser = createFighterState("uncle", 100, 1);
  game.player = specialUser; game.cpu = createFighterState("toko", 150, -1); specialUser.meter = 100;
  assert.equal(game.startSpecial(specialUser), true);
  assert.equal(game.state.vfx.find((entry) => entry.effectId === "super-explosion").scale, 1.7);

  const attacker = createFighterState("guitar-boy", 100, 1);
  const defender = createFighterState("uncle", 125, -1);
  game.player = attacker; game.cpu = defender;
  const move = CHARACTERS[attacker.id].moves.light_attack_neutral;
  attacker.state = "attacking"; attacker.currentMove = move; attacker.actionFrame = move.startupFrames;
  attacker.comboHits = 3; attacker.lastMeterMoveId = "different_move";
  game.handleCombat(attacker, defender);
  assert.ok(attacker.meter > Number(move.meterGainOnHit || 4));
  assert.ok(defender.meter > 0);
  const beforeSkill = attacker.meter;
  game.activateSkill(attacker, getSkillConfig(attacker.id));
  assert.ok(attacker.meter > beforeSkill);
  assert.equal(attacker.specialGauge, attacker.meter);
});

test("every stage platform resolves to a runtime PNG and layouts are distinct", () => {
  const layouts = new Set();
  for (const stage of STAGES) {
    assert.equal(stage.platforms.length, stage.number === 5 ? 0 : 2);
    layouts.add(stage.platforms.map(({ x, y, w, asset }) => `${x}:${y}:${w}:${asset}`).join("|"));
    for (const platform of stage.platforms) {
      assert.equal(fs.existsSync(new URL(`../assets/platforms/${platform.asset}.png`, import.meta.url)), true, `${stage.id}:${platform.asset}`);
    }
  }
  assert.equal(layouts.size, STAGES.length);
  assert.deepEqual(STAGES.map((stage) => stage.platforms.map(({ asset, x, y }) => [asset, x, y])), [
    [["light-podium", 58, 42], ["step-ladder", 384, 42]],
    [["amp", 20, 70], ["amp", 404, 42]],
    [["ramen-stand", 128, 70], ["ramen-stand", 252, 70]],
    [["step-ladder", 62, 104], ["amp", 212, 70]],
    [],
  ]);
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
  assert.equal(rectangles.some(([x, y, w, h]) => x === 16 && y === 54 && w === 116 && h === 108), true);
  for (const prefix of ["000000", "TRAINING"]) {
    const label = labels.find(([value]) => String(value).startsWith(prefix));
    assert.ok(label, prefix);
    assert.equal(label[1], 240);
    assert.equal(label[3], 200);
  }
  const command = labels.find(([value]) => String(value).startsWith("COMMAND:"));
  assert.ok(command);
  assert.equal(command[1], 240);
  assert.equal(command[3], 220);
});
