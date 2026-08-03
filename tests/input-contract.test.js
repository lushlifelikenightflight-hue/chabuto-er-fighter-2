import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { TouchInput, isTouchAvailable, stickActionsFromVector } from "../src/touch-input.js";

const touchSource = fs.readFileSync(new URL("../src/touch-input.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("face layout and dedicated mobile controls follow the input contract", () => {
  assert.match(css, /grid-template-areas:\s*"\. y \."\s*"x \. b"\s*"\. a \."/);
  assert.match(touchSource, /createButton\("jump",\s*"JUMP"/);
  assert.match(touchSource, /createButton\("special",\s*"SP"/);
  assert.match(touchSource, /createButton\("pause"/);
  assert.match(html, /<main id="game" data-game-root/);
  assert.doesNotMatch(html, /<footer\b/i);
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
