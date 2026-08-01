import test from "node:test";
import assert from "node:assert/strict";
import { ANIMATION_CLIPS, CHARACTERS, CHARACTER_IDS, DIFFICULTIES, STAGES, getOpponentId } from "../src/data.js";
import { FIXED_DT, FIXED_UPDATE_ORDER, activeFrame, aiPlan, applyDamage, createFighterState, createProjectile, evaluateStrike, evaluateThrow, fixedStep, getFighterBoxes, projectileIsActive, rectsOverlap, resolvePushboxes, scoreForEvent, stageOpponent, continueCount, rankForScore } from "../src/engine.js";
import { STORAGE_KEY, loadSave, resetSave, safeStorage, saveData, validateSave } from "../src/storage.js";
import { Game, formatDuration } from "../src/game.js";

test("data exposes the eight required Japanese fighters and all 32 clips", () => {
  assert.equal(CHARACTER_IDS.length, 8);
  assert.deepEqual(CHARACTER_IDS.map((id) => CHARACTERS[id].name), ["\u30ae\u30bf\u30fc\u5c11\u5e74", "\u3069\u308d\u3069\u308d\u30b9\u30e9\u30a4\u30e0", "\u30dc\u30d6\u306e\u5973\u306e\u5b50", "\u304a\u3058\u3055\u3093", "\u3089\u3059\u3066\u3043\u30fc", "\u304b\u305a\u3057\u3052", "\u306e\u308a\u304a", "\u30c8\u30b3"]);
  assert.equal(ANIMATION_CLIPS.length, 32);
  assert.equal(new Set(CHARACTER_IDS.map((id) => CHARACTERS[id].special.specialType)).size, 8);
  for (const id of CHARACTER_IDS) {
    const fighter = CHARACTERS[id];
    assert.equal(Object.keys(fighter.animation).length, 32);
    assert.equal(fighter.sprite.frames.length, 4);
    assert.equal(fighter.special.unblockable, true);
    assert.equal(fighter.special.meterCost, 100);
    assert.notEqual(fighter.stats.speed, undefined);
    assert.notEqual(fighter.moves.light_attack_neutral.damage, fighter.moves.strong_attack_neutral.damage);
  }
});

test("stage order and mirror opponent progression are deterministic", () => {
  assert.deepEqual(STAGES.map((stage) => stage.opponent), ["toko", "norio", "kazushige", "rusty", "mirror"]);
  assert.equal(stageOpponent(1, "guitar-boy"), "toko");
  assert.equal(getOpponentId(5, "guitar-boy"), "guitar-boy");
});

test("facing transforms hitboxes and separates three hurtbox parts", () => {
  const fighter = createFighterState("guitar-boy", 100, 1);
  const move = CHARACTERS["guitar-boy"].moves.strong_attack_neutral;
  const right = getFighterBoxes(fighter, move);
  fighter.facing = -1;
  const left = getFighterBoxes(fighter, move);
  assert.equal(right.hurtboxes.length, 3);
  assert.ok(right.hitbox.x > fighter.x);
  assert.ok(left.hitbox.x + left.hitbox.w < fighter.x);
  assert.equal(rectsOverlap(right.pushbox, right.hurtboxes[0]), true);
});

test("pushbox resolution prevents overlap and respects arena bounds", () => {
  const a = createFighterState("guitar-boy", 100, 1);
  const b = createFighterState("toko", 105, -1);
  const result = resolvePushboxes(a, b);
  assert.equal(result.moved, true);
  assert.equal(rectsOverlap(getFighterBoxes(a).pushbox, getFighterBoxes(b).pushbox), false);
  assert.ok(a.x >= 24 && b.x <= 456);
});

test("fixed step consumes deterministic 60 Hz ticks", () => {
  const result = fixedStep(0, 5 * FIXED_DT);
  assert.equal(result.steps, 5);
  assert.ok(result.accumulator >= 0 && result.accumulator < FIXED_DT);
  assert.deepEqual(FIXED_UPDATE_ORDER.slice(0, 3), ["input", "stateTransition", "velocityGravity"]);
});

test("difficulty continue policy and rank are bounded", () => {
  assert.equal(continueCount("easy"), Infinity);
  assert.equal(continueCount("normal"), 3);
  assert.equal(continueCount("hard"), 1);
  assert.equal(rankForScore(0), "D");
  assert.equal(rankForScore(60000), "S");
});

test("corrupt or unavailable storage never stops gameplay", () => {
  const memory = new Map([[STORAGE_KEY, "{not-json"]]);
  const fake = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  assert.deepEqual(loadSave(fake).highScores, []);
  const normalized = validateSave({ version: 999, highScores: [{ score: "bad" }], sound: 0 });
  assert.equal(normalized.version, 1);
  assert.equal(normalized.sound, true);
  saveData({ sound: false, bgmEnabled: false, seEnabled: true, highScores: [] }, fake);
  assert.equal(loadSave(fake).sound, false);
  assert.equal(loadSave(fake).bgmEnabled, false);
  assert.equal(loadSave(fake).seEnabled, true);
  resetSave(fake);
  assert.equal(loadSave(fake).version, 1);
  assert.doesNotThrow(() => loadSave({ getItem() { throw new Error("blocked"); } }));
  assert.equal(safeStorage(fake).load().version, 1);
});

test("guard level, invulnerability, and throws remain separate collision rules", () => {
  const attacker = createFighterState("guitar-boy", 100, 1);
  const defender = createFighterState("toko", 125, -1);
  const low = { id: "low", startupFrames: 0, activeFrames: 2, hitLevel: "low", damage: 20, chipDamage: 1, hitbox: { x: 0, y: 73, w: 80, h: 28 } };
  const overhead = { id: "overhead", startupFrames: 0, activeFrames: 2, hitLevel: "overhead", damage: 20, chipDamage: 1, hitbox: { x: 0, y: 73, w: 80, h: 28 } };
  defender.state = "guarding"; defender.action = "guard_high"; defender.boxProfile = "standing";
  assert.equal(evaluateStrike(attacker, defender, low, 0, new Set()).blocked, false);
  defender.action = "guard_low"; defender.boxProfile = "crouch";
  assert.equal(evaluateStrike(attacker, defender, low, 0, new Set()).blocked, true);
  assert.equal(evaluateStrike(attacker, defender, overhead, 0, new Set()).blocked, false);
  defender.invulnerableFrames = 3;
  assert.equal(evaluateStrike(attacker, defender, low, 0, new Set()).reason, "invulnerable");
  defender.invulnerableFrames = 0; defender.state = "idle"; defender.grounded = true; attacker.grounded = true;
  assert.equal(evaluateThrow(attacker, defender, 0), true);
});

test("projectiles respect startup and KO stops later damage", () => {
  const attacker = createFighterState("kazushige", 100, 1);
  const move = CHARACTERS.kazushige.special;
  const projectile = createProjectile("player", attacker, move, 20);
  assert.equal(projectile.type, "projectileHitbox");
  assert.equal(projectileIsActive(projectile, 19), false);
  assert.equal(projectileIsActive(projectile, 20), true);
  assert.equal(projectileIsActive(projectile, 20 + move.activeFrames), false);
  const target = createFighterState("toko", 100, -1);
  applyDamage(target, 2000);
  assert.equal(target.hp, 0);
  assert.equal(target.state, "defeat");
  assert.equal(applyDamage(target, 50), 0);
});

test("projectile specials cannot double-hit and all specials knock down", () => {
  const projectileGame = new Game();
  projectileGame.player = createFighterState("kazushige", 100, 1);
  projectileGame.cpu = createFighterState("toko", 130, -1);
  projectileGame.player.currentMove = CHARACTERS.kazushige.special;
  projectileGame.player.state = "attacking";
  projectileGame.player.actionFrame = CHARACTERS.kazushige.special.startupFrames;
  const hpBefore = projectileGame.cpu.hp;
  projectileGame.handleCombat(projectileGame.player, projectileGame.cpu);
  assert.equal(projectileGame.cpu.hp, hpBefore);

  const strikeGame = new Game();
  strikeGame.player = createFighterState("guitar-boy", 100, 1);
  strikeGame.cpu = createFighterState("toko", 130, -1);
  strikeGame.player.currentMove = CHARACTERS["guitar-boy"].special;
  strikeGame.player.state = "attacking";
  strikeGame.player.actionFrame = CHARACTERS["guitar-boy"].special.startupFrames;
  strikeGame.handleCombat(strikeGame.player, strikeGame.cpu);
  assert.equal(strikeGame.cpu.state, "knockdown");
});

test("clear time is formatted for the final score screen", () => {
  assert.equal(formatDuration(0), "00:00");
  assert.equal(formatDuration(125999), "02:05");
});

test("runtime projectile is not spawned during its telegraph", () => {
  const game = new Game();
  game.player = createFighterState("kazushige", 100, 1);
  game.cpu = createFighterState("toko", 360, -1);
  game.player.meter = 100;
  const startup = CHARACTERS.kazushige.special.startupFrames;
  game.startSpecial(game.player);
  assert.equal(game.projectiles.length, 0);
  const blank = { left: false, right: false, up: false, down: false, light: false, strong: false, guard: false, special: false, throwHeld: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, lightPressed: false, strongPressed: false, specialPressed: false, throwPressed: false };
  for (let i = 0; i < startup - 1; i += 1) { game.frame += 1; game.updateFighter(game.player, blank, true); }
  assert.equal(game.projectiles.length, 0);
  game.frame += 1; game.updateFighter(game.player, blank, true);
  assert.equal(game.projectiles.length, 1);
});

test("AI uses delayed state observations and difficulty-sensitive score rules", () => {
  const self = createFighterState("uncle", 120, 1);
  const opponent = createFighterState("toko", 125, -1);
  opponent.state = "crouching";
  const sequence = [0.2, 0.2, 0.2, 0.2];
  let i = 0;
  const first = aiPlan({ self, opponent, difficulty: "hard", nowFrame: 0, random: () => sequence[i++ % sequence.length] });
  assert.ok(["guard_low", "guard", "jump", "light", "strong", "special", "throw"].includes(first.action));
  const delayed = aiPlan({ self, opponent, difficulty: "hard", nowFrame: 1, random: () => 0.99 });
  assert.equal(delayed.action, first.action);
  const rankValue = { D: 0, C: 1, B: 2, A: 3, S: 4 };
  assert.ok(rankValue[rankForScore(45000, { difficulty: "hard" })] >= rankValue[rankForScore(45000, { difficulty: "easy" })]);
  assert.ok(scoreForEvent("stage") > 0 && scoreForEvent("clear") > 0 && scoreForEvent("continue") > 0 && scoreForEvent("whiffSpecial") < 0);
});
