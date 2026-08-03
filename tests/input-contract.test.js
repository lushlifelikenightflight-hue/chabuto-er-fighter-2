import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { TouchInput, isTouchAvailable, stickActionsFromVector } from "../src/touch-input.js";
import { Game, SCREEN, debugBuildEnabled, resolveDebugFlag } from "../src/game.js";
import { CHARACTER_IDS } from "../src/data.js";
import { createFighterState } from "../src/engine.js";
import { getSkillHudState, SKILL_HOLD_THRESHOLD_FRAMES } from "../src/skills.js";

const touchSource = fs.readFileSync(new URL("../src/touch-input.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("face layout and dedicated mobile controls follow the input contract", () => {
  assert.match(css, /grid-template-areas:\s*"\. y \."\s*"x \. b"\s*"\. a \."/);
  assert.match(touchSource, /createButton\("jump",\s*"JUMP"/);
  assert.match(touchSource, /createButton\("special",\s*"SP"/);
  assert.doesNotMatch(touchSource, /createButton\("pause"/);
  assert.match(html, /data-header-pause[^>]*>PAUSE<\/button>/);
  assert.match(touchSource, /createButton\("throw"/);
  assert.match(html, /<main id="game" data-game-root/);
  assert.doesNotMatch(html, /<footer\b/i);
});

test("screen transitions preserve the originating edge and audio Promise does not gate it", () => {
  const game = new Game(null);
  game.state.screen = SCREEN.menu;
  game.keys.add("j"); game.justKeys.add("j");
  game.setScreen(SCREEN.battle);
  assert.equal(game.justKeys.has("j"), true);
  assert.equal(game.readInput().lightPressed, true);
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = class {
    constructor() { this.state = "suspended"; }
    resume() { return Promise.resolve(); }
  };
  try {
    game.ensureAudio();
    assert.equal(game.audioResumePromise instanceof Promise, true);
  } finally {
    if (previous === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = previous;
  }
});

test("touch throw edge, viewport orientation, pause placement, and production debug guard are explicit", () => {
  const game = new Game(null);
  game.state.screen = SCREEN.battle;
  game.touchInput = { getSnapshot: () => ({ held: new Set(["throw"]), pressed: new Set(["throw"]) }) };
  assert.equal(game.readInput().throwPressed, true);
  assert.equal(debugBuildEnabled(), false);
  assert.equal(resolveDebugFlag({ debug: true }), false);
  assert.match(touchSource, /visualViewport/);
  assert.match(touchSource, /dataset\.orientation/);
  assert.match(css, /\.header-pause\s*\{/);
  assert.match(css, /\.virtual-pad__throw/);
  assert.doesNotMatch(touchSource, /createButton\("pause"/);
});

test("B hold threshold and all eight HUD resources expose stable public values", () => {
  const game = new Game(null);
  const fighter = createFighterState("guitar-boy", 100, 1);
  game.player = fighter; game.cpu = createFighterState("toko", 140, -1);
  assert.equal(SKILL_HOLD_THRESHOLD_FRAMES, 21);
  assert.equal(game.startSkill(fighter, { skill: true, skillPressed: true }), true);
  for (let i = 0; i < SKILL_HOLD_THRESHOLD_FRAMES - 1; i += 1) game.updateFighter(fighter, { skill: true }, true);
  assert.equal(fighter.skillHoldActive, false);
  game.updateSkill(fighter, { skill: false, skillReleased: true });
  assert.equal(fighter.skillPhase, "skillUnavailable");
  assert.equal(game.startSkill(fighter, { skill: true, skillPressed: true }), true);
  for (let i = 0; i < SKILL_HOLD_THRESHOLD_FRAMES; i += 1) game.updateFighter(fighter, { skill: true }, true);
  assert.equal(fighter.skillHoldActive, true);
  for (const id of CHARACTER_IDS) {
    const state = getSkillHudState(createFighterState(id, 100, 1), id);
    assert.ok(["charge", "ammo", "uses", "duration"].includes(state.mode));
    assert.equal(typeof state.ready, "boolean");
    assert.equal(typeof state.disabled, "boolean");
  }
});

test("touch snapshots expose held, pressed, and released edges", () => {
  const input = Object.create(TouchInput.prototype);
  input.actionCounts = new Map();
  input.pressed = new Set();
  input.released = new Set();

  input.addAction("a");
  assert.deepEqual([...input.getSnapshot().held], ["a"]);
  assert.deepEqual([...input.getSnapshot().pressed], ["a"]);
  input.removeAction("a");
  assert.deepEqual([...input.getSnapshot().held], []);
  assert.deepEqual([...input.getSnapshot().released], ["a"]);
  input.clearEdges();
  assert.deepEqual(input.getSnapshot().pressed, new Set());
  assert.deepEqual(input.getSnapshot().released, new Set());
});

test("stick dead zone and pointer availability remain deterministic", () => {
  assert.deepEqual(stickActionsFromVector(0.1, -0.2), []);
  assert.deepEqual(stickActionsFromVector(-0.8, 0.8), ["left", "down"]);
  assert.equal(isTouchAvailable({ PointerEvent: class {} }, { maxTouchPoints: 0 }), true);
  assert.equal(isTouchAvailable({ ontouchstart: null }, { maxTouchPoints: 0 }), true);
});

test("battle viewport lock and safe-area protections are scoped to the game root", () => {
  assert.match(touchSource, /target\.style\.position = "fixed"/);
  assert.match(touchSource, /target\.style\.height = "100dvh"/);
  assert.match(touchSource, /style\.cssText = snapshot\.cssText/);
  assert.match(css, /#game\.game-viewport-lock\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /env\(safe-area-inset-(?:top|right|bottom|left)/);
  assert.match(touchSource, /onWindowPointerCancel = \(\) => this\.reset\(\)/);
  assert.match(touchSource, /onVisibility = \(\) =>/);
});
