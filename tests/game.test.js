import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ANIMATION_CLIPS, CHARACTERS, CHARACTER_IDS, DIFFICULTIES, MENU_ITEMS, SETTINGS_ITEMS, STAGE_BOUNDS, STAGES, getOpponentId } from "../src/data.js";
import { FIXED_DT, FIXED_UPDATE_ORDER, activeFrame, aiPlan, applyDamage, createFighterState, createProjectile, evaluateStrike, evaluateThrow, fixedStep, getFighterBoxes, projectileIsActive, rectsOverlap, resolvePushboxes, scoreForEvent, stageOpponent, continueCount, rankForScore } from "../src/engine.js";
import { STORAGE_KEY, loadSave, resetSave, safeStorage, saveData, validateSave } from "../src/storage.js";
import { DEFAULT_SPRITE_SCALE, Game, SCREEN, advanceVisualSequence, animationNameFor, animationSelectionFor, formatDuration, setVisualSequence, spriteDrawPlacement, spriteScaleFor } from "../src/game.js";
import { EXPANDED_FIGHTER_IDS, REQUIRED_ANIMATION_CLIPS } from "../src/sprite-manifest.js";
import { isTouchAvailable } from "../src/touch-input.js";

test("data exposes the eight required Japanese fighters and all required clips", () => {
  assert.equal(CHARACTER_IDS.length, 8);
  assert.deepEqual(CHARACTER_IDS.map((id) => CHARACTERS[id].name), ["\u30ae\u30bf\u30fc\u5c11\u5e74", "\u3069\u308d\u3069\u308d\u30b9\u30e9\u30a4\u30e0", "\u30dc\u30d6\u306e\u5973\u306e\u5b50", "\u304a\u3058\u3055\u3093", "\u3089\u3059\u3066\u3043\u30fc", "\u304b\u305a\u3057\u3052", "\u306e\u308a\u304a", "\u30c8\u30b3"]);
  assert.equal(ANIMATION_CLIPS.length, 41);
  assert.deepEqual(ANIMATION_CLIPS, REQUIRED_ANIMATION_CLIPS);
  assert.equal(new Set(CHARACTER_IDS.map((id) => CHARACTERS[id].special.specialType)).size, 8);
  for (const id of CHARACTER_IDS) {
    const fighter = CHARACTERS[id];
    assert.equal(Object.keys(fighter.animation).length, 41);
    assert.equal(fighter.sprite.frames.length, 4);
    assert.equal(fighter.special.unblockable, true);
    assert.equal(fighter.special.meterCost, 100);
    assert.notEqual(fighter.stats.speed, undefined);
    assert.notEqual(fighter.moves.light_attack_neutral.damage, fighter.moves.strong_attack_neutral.damage);
  }
});

test("the original four fighters use expanded authored animation frames", () => {
  for (const id of EXPANDED_FIGHTER_IDS) {
    const fighter = CHARACTERS[id];
    assert.match(fighter.animation.idle.frames[0], new RegExp(`assets/sprites/${id}/actions/idle/idle-1\\.png$`));
    assert.equal(fighter.animation.throw_break.frames.length, 2);
    assert.equal(fighter.animation.down_idle.loop, true);
  }
});

test("runtime actions select canonical clips and special phases", () => {
  assert.equal(animationNameFor({ action: "light_attack_neutral" }), "light_stand");
  assert.equal(animationNameFor({ action: "jump_up", vy: 0.5 }), "jump_apex");
  const currentMove = { startupFrames: 5, activeFrames: 3 };
  assert.equal(animationNameFor({ action: "special_start", actionFrame: 2, currentMove }), "special_start");
  assert.equal(animationNameFor({ action: "special_start", actionFrame: 6, currentMove }), "special_active");
  assert.equal(animationNameFor({ action: "special_start", actionFrame: 10, currentMove }), "special_recovery");
  assert.deepEqual(animationSelectionFor({ action: "special_start", actionFrame: 6, currentMove }), { name: "special_active", frame: 1 });
  assert.deepEqual(animationSelectionFor({ action: "throw_start", actionFrame: 8, currentMove }), { name: "throw_miss", frame: 0 });
});

test("event visuals use clip-local frames and advance through their sequence", () => {
  const fighter = {};
  setVisualSequence(fighter, [{ name: "hit_heavy", duration: 2 }, { name: "knockback", duration: 2 }]);
  assert.deepEqual(animationSelectionFor(fighter), { name: "hit_heavy", frame: 0 });
  advanceVisualSequence(fighter);
  assert.deepEqual(animationSelectionFor(fighter), { name: "hit_heavy", frame: 1 });
  advanceVisualSequence(fighter);
  assert.deepEqual(animationSelectionFor(fighter), { name: "knockback", frame: 0 });
});

test("crouch input visibly transitions and diagonals remain crouched", () => {
  const game = new Game(null);
  const fighter = createFighterState("guitar-boy", 100, 1);
  const input = { left: true, right: false, up: false, down: true, light: false, strong: false, guard: false, special: false, throwHeld: false, leftPressed: true, rightPressed: false, upPressed: false, downPressed: true, lightPressed: false, strongPressed: false, specialPressed: false, throwPressed: false };
  game.updateFighter(fighter, input, true);
  assert.equal(fighter.state, "crouching");
  assert.equal(fighter.action, "crouch");
  assert.equal(fighter.visualAction, "crouch_start");
  assert.equal(fighter.vx, 0);
  game.updateFighter(fighter, { ...input, left: false, leftPressed: false, down: false, downPressed: false }, true);
  assert.equal(fighter.visualAction, "crouch_end");
});

test("held crouch settles on one pose and jump returns to ground promptly", () => {
  const game = new Game(null);
  const fighter = createFighterState("guitar-boy", 100, 1);
  const crouch = { left: false, right: false, up: false, down: true, light: false, strong: false, guard: false, special: false, throwHeld: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: true, lightPressed: false, strongPressed: false, specialPressed: false, throwPressed: false };
  for (let i = 0; i < 16; i += 1) game.updateFighter(fighter, crouch, true);
  assert.equal(fighter.state, "crouching");
  assert.equal(fighter.visualAction, "");
  assert.deepEqual(animationSelectionFor(fighter), { name: "crouch_idle", frame: 0 });

  const jump = createFighterState("guitar-boy", 100, 1);
  game.updateFighter(jump, { ...crouch, down: false, downPressed: false, upPressed: true }, true);
  assert.equal(jump.grounded, false);
  for (let i = 0; i < 60 && !jump.grounded; i += 1) game.updateFighter(jump, { ...crouch, down: false, downPressed: false, upPressed: false }, true);
  assert.equal(jump.grounded, true);
  assert.equal(jump.y, 0);
});

test("held walk advances its clip and direction double taps latch dash/backstep", () => {
  const game = new Game(null);
  const blank = { left: false, right: false, up: false, down: false, light: false, strong: false, guard: false, special: false, throwHeld: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, lightPressed: false, strongPressed: false, specialPressed: false, throwPressed: false };
  const forward = createFighterState("guitar-boy", 100, 1);
  game.frame = 1;
  game.updateFighter(forward, { ...blank, right: true, rightPressed: true }, true);
  game.frame = 2;
  game.updateFighter(forward, { ...blank, right: true }, true);
  assert.equal(forward.action, "walk_forward");
  assert.ok(forward.actionFrame > 0);
  game.frame = 3;
  game.updateFighter(forward, { ...blank, right: true, rightPressed: true }, true);
  assert.equal(forward.action, "dash");
  const dashFrame = forward.actionFrame;
  for (let frame = 4; frame <= 7; frame += 1) {
    game.frame = frame;
    game.updateFighter(forward, { ...blank, right: true }, true);
    assert.equal(forward.action, "dash");
  }
  assert.ok(forward.actionFrame > dashFrame);
  for (let frame = 8; frame <= 14; frame += 1) {
    game.frame = frame;
    game.updateFighter(forward, { ...blank, right: true }, true);
  }
  assert.equal(forward.action, "walk_forward");

  const backward = createFighterState("guitar-boy", 160, 1);
  game.frame = 10;
  game.updateFighter(backward, { ...blank, left: true, leftPressed: true }, true);
  game.frame = 11;
  game.updateFighter(backward, { ...blank, left: true, leftPressed: false }, true);
  game.frame = 12;
  game.updateFighter(backward, { ...blank, left: true, leftPressed: true }, true);
  assert.equal(backward.action, "backstep");
  for (let frame = 13; frame <= 18; frame += 1) {
    game.frame = frame;
    game.updateFighter(backward, { ...blank, left: true }, true);
    assert.equal(backward.action, "backstep");
  }
});

test("throw input is guard plus light and Toko idle receives the authored scale", () => {
  const game = new Game(null);
  game.keys.add("l"); game.keys.add("j"); game.justKeys.add("l"); game.justKeys.add("j");
  const input = game.readInput();
  assert.equal(input.throwHeld, true);
  assert.equal(input.throwPressed, true);
  assert.equal(input.light, false);
  assert.equal(spriteScaleFor({ id: "toko" }, "idle"), 0.92);
  assert.equal(spriteScaleFor({ id: "toko" }, "throw_start"), DEFAULT_SPRITE_SCALE);
});

test("training pause can exit to title with ESC", () => {
  const game = new Game(null);
  game.state.mode = "training";
  game.state.screen = SCREEN.pause;
  game.justKeys.add("escape");
  game.tick();
  assert.equal(game.state.screen, SCREEN.title);
});

test("training mode starts with an idle dummy and independently toggles CPU options", () => {
  const game = new Game(null);
  game.state.selectedId = "rusty";
  game.startTraining();
  assert.equal(game.state.mode, "training");
  assert.equal(game.state.screen, SCREEN.roundIntro);
  assert.equal(game.state.timerFrames, Infinity);
  game.setScreen(SCREEN.battle);
  const blank = { left: false, right: false, up: false, down: false, light: false, strong: false, guard: false, special: false, throwHeld: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, lightPressed: false, strongPressed: false, specialPressed: false, throwPressed: false };
  game.tickBattle(blank);
  assert.equal(game.cpu.state, "idle");
  assert.equal(game.state.trainingCpuMove, false);
  assert.equal(game.state.trainingCpuAttack, false);
  game.state.trainingCpuMove = true;
  assert.notEqual(game.trainingInput().left || game.trainingInput().right, false);
});

test("virtual pad is available on pointer-capable desktop and mobile viewports", () => {
  const phoneWindow = { PointerEvent: class {}, innerWidth: 390, innerHeight: 844, matchMedia: () => ({ matches: false }) };
  assert.equal(isTouchAvailable(phoneWindow, { maxTouchPoints: 0 }), true);
  const desktopWindow = { PointerEvent: class {}, innerWidth: 1440, innerHeight: 900, matchMedia: () => ({ matches: false }) };
  assert.equal(isTouchAvailable(desktopWindow, { maxTouchPoints: 0 }), true);
});

test("combat transitions select just guard, throw, hit, and down-idle visuals", () => {
  const game = new Game(null);
  const blank = { left: false, right: false, up: false, down: false, light: false, strong: false, guard: false, special: false, throwHeld: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, lightPressed: false, strongPressed: false, specialPressed: false, throwPressed: false };

  const strongAttacker = createFighterState("guitar-boy", 100, 1);
  const strongDefender = createFighterState("uncle", 125, -1);
  strongAttacker.state = "attacking";
  strongAttacker.currentMove = CHARACTERS["guitar-boy"].moves.strong_attack_neutral;
  strongAttacker.actionFrame = strongAttacker.currentMove.startupFrames;
  game.handleCombat(strongAttacker, strongDefender);
  assert.equal(strongDefender.visualAction, "hit_heavy");
  assert.equal(strongDefender.visualQueue[0].name, "knockback");

  const thrower = createFighterState("guitar-boy", 100, 1);
  const thrown = createFighterState("uncle", 112, -1);
  thrown.actionFrame = 46;
  game.startThrow(thrower);
  thrower.actionFrame = thrower.currentMove.startupFrames;
  const hpBeforeThrow = thrown.hp;
  game.handleCombat(thrower, thrown);
  assert.equal(thrower.visualAction, "throw_success");
  assert.equal(thrown.visualAction, "thrown");
  assert.equal(thrown.actionFrame, 0);
  assert.ok(thrown.hp < hpBeforeThrow);
  const hpAfterThrow = thrown.hp;
  game.handleCombat(thrower, thrown);
  assert.equal(thrown.hp, hpAfterThrow);

  const guardAttacker = createFighterState("guitar-boy", 100, 1);
  const guardDefender = createFighterState("uncle", 125, -1);
  game.player = guardDefender;
  guardAttacker.state = "attacking";
  guardAttacker.currentMove = CHARACTERS["guitar-boy"].moves.light_attack_neutral;
  guardAttacker.actionFrame = guardAttacker.currentMove.startupFrames;
  guardDefender.guardHeld = true;
  guardDefender.guardStartedFrame = game.frame - 1;
  guardDefender.action = "guard_high";
  game.handleCombat(guardAttacker, guardDefender);
  assert.equal(guardDefender.visualAction, "just_guard");
  assert.equal(game.state.combatNotice.text, "GUARD");

  const downed = createFighterState("uncle", 125, -1);
  downed.state = "knockdown";
  downed.actionFrame = 18;
  game.updateFighter(downed, blank, false);
  assert.equal(downed.action, "down_idle");
});

test("generated JSON metadata stays consistent with the runtime manifest", () => {
  for (const id of EXPANDED_FIGHTER_IDS) {
    const metadata = JSON.parse(fs.readFileSync(new URL(`../assets/sprites/${id}/metadata/${id}-animations.json`, import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(metadata.actions), REQUIRED_ANIMATION_CLIPS);
    for (const name of REQUIRED_ANIMATION_CLIPS) assert.deepEqual(metadata.actions[name].frames, CHARACTERS[id].animation[name].frames);
  }
});

test("settings are grouped under one main-menu route", () => {
  assert.deepEqual(MENU_ITEMS, ["GAME START", "TRAINING MODE", "HOW TO PLAY", "SCORE", "SETTINGS"]);
  assert.deepEqual(SETTINGS_ITEMS, ["SOUND", "BGM", "SE", "DEBUG OVERLAY", "RESET DATA", "BACK"]);
  assert.equal(SCREEN.settings, "settings");
});

test("sprite placement uses the authored anchor on the visible stage floor", () => {
  const sprite = CHARACTERS["guitar-boy"].sprite;
  const grounded = spriteDrawPlacement({ x: 150, y: 0 }, sprite);
  assert.equal(grounded.originX, 150);
  assert.equal(grounded.baselineY, STAGE_BOUNDS.floor);
  assert.equal(grounded.drawX + sprite.anchor.x * DEFAULT_SPRITE_SCALE, 0);
  assert.equal(grounded.drawY + sprite.anchor.y * DEFAULT_SPRITE_SCALE, 0);
  assert.equal(grounded.width, sprite.cellWidth * DEFAULT_SPRITE_SCALE);
  const airborne = spriteDrawPlacement({ x: 150, y: 40 }, sprite);
  assert.equal(airborne.baselineY, STAGE_BOUNDS.floor - 40);
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
  strikeGame.cpu.actionFrame = 46;
  strikeGame.player.currentMove = CHARACTERS["guitar-boy"].special;
  strikeGame.player.state = "attacking";
  strikeGame.player.actionFrame = CHARACTERS["guitar-boy"].special.startupFrames;
  strikeGame.handleCombat(strikeGame.player, strikeGame.cpu);
  assert.equal(strikeGame.cpu.state, "knockdown");
  assert.equal(strikeGame.cpu.actionFrame, 0);
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
