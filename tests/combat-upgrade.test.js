import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHARACTERS } from "../src/data.js";
import { aiPlan, createFighterState } from "../src/engine.js";
import { Game, SCREEN } from "../src/game.js";
import { getSkillConfig } from "../src/skills.js";
import { getEffectAssetManifest } from "../src/sprite-manifest.js";
import { effectForMove } from "../src/vfx.js";

const blank = () => ({ left: false, right: false, up: false, down: false, light: false, strong: false, guard: false, skill: false, special: false, throwHeld: false, throwPressed: false, skillPressed: false, specialPressed: false, jumpPressed: false, jumpReleased: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, lightPressed: false, strongPressed: false, guardPressed: false });

test("canonical face mapping and the single A+X chord edge are source-independent", () => {
  const game = new Game(null);
  game.state.screen = SCREEN.battle;
  game.keys.add("j"); game.justKeys.add("j");
  assert.equal(game.readInput().light, true);
  game.justKeys.clear(); game.keys.add("k"); game.justKeys.add("k");
  const chord = game.readInput();
  assert.equal(chord.throwHeld, true);
  assert.equal(chord.throwPressed, true);
  game.justKeys.clear();
  assert.equal(game.readInput().throwPressed, false);
});

test("B is skill-only and never aliases a normal attack", () => {
  const game = new Game(null);
  game.state.screen = SCREEN.battle;
  game.keys.add("b"); game.justKeys.add("b");
  const input = game.readInput();
  assert.equal(input.skill, true);
  assert.equal(input.light, false);
  assert.equal(input.strong, false);
});

test("down landing, one follow-up, and wakeup invulnerability are bounded", () => {
  const game = new Game(null);
  const defender = createFighterState("uncle", 130, -1);
  game.player = createFighterState("guitar-boy", 100, 1); game.cpu = defender;
  game.beginKnockdownLanding(defender);
  for (let i = 0; i < 10; i += 1) game.updateFighter(defender, blank(), false);
  assert.equal(defender.state, "downed");
  const follow = { ...blank(), down: true, lightPressed: true };
  game.player.x = defender.x;
  assert.equal(game.startAttack(game.player, follow), true);
  game.player.actionFrame = game.player.currentMove.startupFrames;
  game.handleCombat(game.player, defender);
  assert.equal(defender.downFollowupUsed, true);
  defender.state = "downed"; defender.downed = true; defender.downedFrames = 59;
  game.updateFighter(defender, blank(), false);
  assert.equal(defender.state, "wakeup");
  for (let i = 0; i < 20; i += 1) game.updateFighter(defender, blank(), false);
  assert.equal(defender.state, "wakeupInvulnerable");
  assert.equal(defender.wakeupInvulnerableFrames, 12);
});

test("light combo alternates left/right and respects character limit", () => {
  const game = new Game(null);
  const fighter = createFighterState("rusty", 100, 1);
  game.startAttack(fighter, { ...blank(), lightPressed: true });
  assert.equal(fighter.currentMove.id, "light_left");
  fighter.comboHits = 1; fighter.comboTimer = 20;
  game.startAttack(fighter, { ...blank(), lightPressed: true });
  assert.equal(fighter.currentMove.id, "light_right");
  fighter.comboHits = CHARACTERS.rusty.stats.comboLimit; fighter.comboTimer = 20;
  assert.equal(game.startAttack(fighter, { ...blank(), lightPressed: true }), false);
});

test("guard dash is forward-only, guarded at startup, and attack-cancellable", () => {
  const game = new Game(null);
  const fighter = createFighterState("guitar-boy", 100, 1);
  game.updateFighter(fighter, { ...blank(), right: true, guard: true, rightPressed: true, guardPressed: true }, true);
  assert.equal(fighter.state, "guardDash");
  assert.equal(fighter.guardDashInvulnerableFrames, 4);
  fighter.guardDashFrames = 1;
  game.updateFighter(fighter, { ...blank(), lightPressed: true }, true);
  assert.equal(fighter.state, "attacking");
});

test("normal and double jump stay inside the arena and reach distinct heights", () => {
  const game = new Game(null);
  const fighter = createFighterState("guitar-boy", 100, 1);
  game.updateFighter(fighter, { ...blank(), jumpPressed: true }, true);
  let normalApex = 0;
  for (let i = 0; i < 28; i += 1) { game.updateFighter(fighter, blank(), true); normalApex = Math.max(normalApex, fighter.y); }
  assert.ok(normalApex > 80);
  game.updateFighter(fighter, { ...blank(), jumpPressed: true }, true);
  let doubleApex = fighter.y;
  for (let i = 0; i < 40; i += 1) { game.updateFighter(fighter, blank(), true); doubleApex = Math.max(doubleApex, fighter.y); }
  assert.ok(doubleApex > normalApex);
  assert.ok(doubleApex <= 228 * 0.9);
});

test("just guard applies recoil/hitstop without damage", () => {
  const game = new Game(null);
  const attacker = createFighterState("guitar-boy", 100, 1);
  const defender = createFighterState("uncle", 125, -1);
  game.player = defender; game.cpu = attacker; game.frame = 20;
  attacker.state = "attacking"; attacker.currentMove = CHARACTERS[attacker.id].moves.light_attack_neutral; attacker.actionFrame = attacker.currentMove.startupFrames;
  defender.guardHeld = true; defender.guardStartedFrame = 18; defender.action = "guard_high";
  const hp = defender.hp;
  game.handleCombat(attacker, defender);
  assert.equal(defender.hp, hp);
  assert.equal(attacker.stunFrames, 12);
  assert.equal(game.state.hitstopFrames, 4);
});

test("round meter carry and skill configs integrate with deterministic VFX records", () => {
  const game = new Game(null);
  game.state.mode = "arcade"; game.state.screen = SCREEN.battle; game.player.meter = 42; game.captureRoundCarry();
  game.beginRound();
  assert.equal(game.player.meter, 42);
  for (const id of ["guitar-boy", "green-slime", "bob-girl", "uncle", "rusty", "kazushige", "norio", "toko"]) {
    const fighter = createFighterState(id, 100, 1);
    const local = new Game(null); local.player = fighter; local.cpu = createFighterState("guitar-boy", 140, -1);
    assert.equal(local.startSkill(fighter, { skillPressed: true }), true, id);
    assert.equal(fighter.skillPhase, "skillStartup");
  }
  const move = CHARACTERS["guitar-boy"].moves.light_attack_neutral;
  const effect = effectForMove(move);
  assert.notEqual(effect, move.hitbox);
  const vfx = game.spawnVfx(effect.id, game.player);
  assert.equal(vfx.hitbox, null);
});

test("effect manifest resolves cached frames and the draw path consumes ready PNGs", () => {
  const PreviousImage = globalThis.Image;
  class FakeImage { constructor() { this.complete = true; this.naturalWidth = 1; } set src(value) { this.srcValue = value; } }
  globalThis.Image = FakeImage;
  try {
    const game = new Game(null);
    const manifest = getEffectAssetManifest("skill-dog-summon");
    assert.equal(manifest.frames.length, 12);
    assert.notEqual(game.loadEffectFrame("skill-dog-summon", 0).src, game.loadEffectFrame("skill-dog-summon", 96).src);
    const cached = game.loadEffectFrame("skill-dog-summon", 96);
    assert.equal(cached.image, game.effectImages.get(cached.src));
    const calls = [];
    game.player = createFighterState("guitar-boy", 100, 1); game.cpu = createFighterState("toko", 300, -1);
    game.state.vfx = [game.spawnVfx("skill-dog-summon", game.player)]; game.skillEntities = [{ active: true, type: "dogMarker", effectId: "skill-dog-summon", x: 120, y: 0, w: 20, h: 20, age: 0, delay: 0 }];
    game.ctx = { save() {}, restore() {}, translate() {}, scale() {}, drawImage(...args) { calls.push(args); }, fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {}, stroke() {}, lineWidth: 1, textAlign: "left" };
    game.drawBattle(game.ctx);
    assert.ok(calls.length >= 2);
  } finally { globalThis.Image = PreviousImage; }
});

test("guitar copy fills to full, stores two uses, and consumes a copied skill", () => {
  const game = new Game(null);
  const guitar = createFighterState("guitar-boy", 100, 1); const opponent = createFighterState("kazushige", 140, -1);
  game.player = guitar; game.cpu = opponent; guitar.skillGauge = 100;
  game.activateSkill(guitar, getSkillConfig("guitar-boy"));
  assert.equal(guitar.copiedSkillUses, 2); assert.equal(guitar.copiedSkillId, "kazushige");
  guitar.skillPhase = "skillUnavailable"; guitar.state = "idle"; assert.equal(game.startSkill(guitar, { skill: true }), true);
  game.activateSkill(guitar, getSkillConfig("guitar-boy"));
  assert.equal(guitar.copiedSkillUses, 1);
});

test("ramen buff scales runtime hitbox/damage, expires, and retains half charge on hit", () => {
  const game = new Game(null);
  const attacker = createFighterState("kazushige", 100, 1); const defender = createFighterState("guitar-boy", 124, -1);
  game.player = attacker; game.cpu = defender; attacker.buff = { attackScale: 1.35, hitboxScale: 1.25, effectScale: 1.3, chipScale: 1.2, frames: 1 };
  const move = CHARACTERS.kazushige.moves.light_attack_neutral; attacker.currentMove = move; attacker.state = "attacking"; attacker.actionFrame = move.startupFrames;
  const before = defender.hp; game.handleCombat(attacker, defender); assert.ok(defender.hp < before);
  game.updateFighter(attacker, blank(), true); assert.equal(attacker.buff, null);
  attacker.skillGauge = 80; game.interruptSkillFor(attacker, "hit"); assert.equal(attacker.skillGauge, 40);
});

test("flash reloads on held B and stuns once without damage", () => {
  const game = new Game(null); const toko = createFighterState("toko", 100, 1); const target = createFighterState("guitar-boy", 120, -1);
  game.player = toko; game.cpu = target; toko.skillAmmo = 0; toko.ammo = 0;
  assert.equal(game.startSkill(toko, { skill: true }), true);
  for (let i = 0; i < 60; i += 1) game.updateSkill(toko, { skill: true });
  assert.equal(toko.skillAmmo, 3);
  toko.skillPhase = "skillUnavailable"; toko.state = "idle"; game.activateSkill(toko, getSkillConfig("toko"));
  const hp = target.hp; game.updateSkillEntities();
  assert.equal(target.hp, hp); assert.equal(target.flashStunned, true);
});

test("dog has marker/falling/impact phases and only impact deals hard knockdown", () => {
  const game = new Game(null); const rusty = createFighterState("rusty", 100, 1); const target = createFighterState("guitar-boy", 130, -1);
  game.player = rusty; game.cpu = target; game.activateSkill(rusty, getSkillConfig("rusty"));
  const dog = game.skillEntities[0]; assert.equal(dog.type, "dogMarker"); assert.equal(dog.damage, 0); assert.equal(dog.targetX, target.x);
  for (let i = 0; i < 21; i += 1) game.updateSkillEntities(); assert.equal(game.skillEntities[0].type, "fallingDog");
  const before = target.hp; for (let i = 0; i < 20; i += 1) game.updateSkillEntities(); assert.equal(game.skillEntities[0].type, "dogImpact");
  assert.ok(target.hp < before); assert.equal(target.downed, true);
});

test("tackle cooldown rejects start and norio markers become capped impacts", () => {
  const game = new Game(null); const uncle = createFighterState("uncle", 100, 1); const target = createFighterState("guitar-boy", 130, -1);
  game.player = uncle; game.cpu = target; uncle.tackleCooldown = 1; assert.equal(game.startSkill(uncle, { skill: true }), false);
  const norio = createFighterState("norio", 100, 1); game.player = norio; norio.skillAmmo = 16; norio.ammo = 16; game.cpu = target; game.activateSkill(norio, getSkillConfig("norio"));
  assert.equal(game.skillEntities.length, 16); assert.equal(game.skillEntities[0].type, "snareMarker");
  game.skillEntities = Array.from({ length: 4 }, () => ({ active: true, type: "snareImpact", owner: "player", x: target.x, y: 0, w: 50, h: 80, duration: 3, age: 0, delay: 0, damage: 1, hitTargets: new Set() }));
  const hp = target.hp; game.updateSkillEntities(); assert.equal(target.norioHits, 3); assert.equal(hp - target.hp >= 3, true);
});

test("CPU round carry and mirror consume only after a successful reflection", () => {
  const game = new Game(null); game.state.mode = "arcade"; game.state.screen = SCREEN.battle; game.player = createFighterState("guitar-boy", 100, 1); game.cpu = createFighterState("bob-girl", 140, -1); game.player.meter = 12; game.cpu.meter = 34; game.captureRoundCarry(); game.beginRound(); assert.equal(game.cpu.meter, 34);
  const mirror = createFighterState("bob-girl", 100, 1); const attacker = createFighterState("kazushige", 120, -1); game.player = mirror; game.cpu = attacker; game.activateSkill(mirror, getSkillConfig("bob-girl")); assert.equal(mirror.skillAmmo, 1); mirror.mirrorActiveFrames = 2; attacker.state = "attacking"; attacker.currentMove = CHARACTERS.kazushige.special; attacker.actionFrame = attacker.currentMove.startupFrames; game.handleCombat(attacker, mirror); assert.equal(mirror.skillAmmo, 0);
});

test("virtual pad action buttons stay within the 64–84 px clamp", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.virtual-pad button \{[^}]*clamp\(64px, 14vw, 84px\)/);
  assert.match(css, /\.virtual-pad__utility \{[^}]*clamp\(64px, 14vw, 84px\)/);
});

test("Toko reload owns progress, cancels early, and requires a fresh B edge", () => {
  const game = new Game(null); const toko = createFighterState("toko", 100, 1); game.player = toko; game.cpu = createFighterState("guitar-boy", 140, -1); toko.skillAmmo = 0; toko.ammo = 0;
  assert.equal(game.startSkill(toko, { skill: true }), true);
  for (let i = 0; i < 35; i += 1) game.updateSkill(toko, { skill: true });
  assert.equal(toko.flashReloadFrames, 35); assert.equal(toko.skillAmmo, 0);
  game.updateSkill(toko, { skill: false, skillReleased: true }); assert.equal(toko.flashReloadFrames, 0); assert.equal(toko.skillAmmo, 0); assert.equal(toko.skillPhase, "skillUnavailable");
  assert.equal(game.startSkill(toko, { skill: true }), true);
  for (let i = 0; i < 54; i += 1) game.updateSkill(toko, { skill: true });
  assert.equal(toko.skillAmmo, 3); assert.equal(toko.skillPhase, "skillUnavailable");
});

test("copied Toko flash executes while Guitar resources and reload remain unchanged", () => {
  const game = new Game(null); const guitar = createFighterState("guitar-boy", 100, 1); const toko = createFighterState("toko", 130, -1); game.player = guitar; game.cpu = toko;
  guitar.copiedSkillId = "toko"; guitar.copiedSkillUses = 2; guitar.copyCharges = 2; guitar.skillCopiedUse = true; guitar.skillAmmo = 0; guitar.ammo = 0;
  game.activateSkill(guitar, getSkillConfig("guitar-boy"));
  assert.equal(guitar.copiedSkillUses, 1); assert.equal(guitar.skillAmmo, 0); assert.equal(guitar.flashReloadFrames, 0); assert.equal(game.skillEntities.some((entry) => entry.type === "flash"), true);
});

test("CPU skill plan emits one press, holds across replans, then one release and effect", () => {
  const cpu = createFighterState("toko", 100, 1); const opponent = createFighterState("guitar-boy", 130, -1); const plan = aiPlan({ self: cpu, opponent, difficulty: "normal", nowFrame: 0, random: () => 0.1 });
  assert.equal(plan.action, "skill"); const game = new Game(null); game.player = opponent; game.cpu = cpu; game.state.screen = SCREEN.battle;
  const first = game.inputForPlan(plan); const held = game.inputForPlan(plan); assert.equal(first.skillPressed, true); assert.equal(held.skillPressed, false); assert.equal(held.skill, true);
  const releasePlan = { ...plan, released: true }; const release = game.inputForPlan(releasePlan); assert.equal(release.skillReleased, true); assert.equal(game.inputForPlan(releasePlan).skillReleased, false);
  game.updateFighter(cpu, first, false); for (let i = 0; i < 20; i += 1) game.updateFighter(cpu, i < 2 ? held : release, false);
  assert.equal(game.skillEntities.some((entry) => entry.type === "flash"), true);
});

test("Norio activations use injected bounded positions with separation and repeat suppression", () => {
  const game = new Game(null); game.random = () => 0.5; const norio = createFighterState("norio", 100, 1); game.player = norio; game.cpu = createFighterState("guitar-boy", 140, -1);
  game.activateSkill(norio, getSkillConfig("norio")); const first = norio.norioLastPositions.slice(); game.skillEntities = [];
  game.activateSkill(norio, getSkillConfig("norio")); const second = norio.norioLastPositions.slice();
  assert.equal(first.length, 16); assert.equal(second.length, 16); assert.ok(first.every((x) => x >= 20 && x <= 460)); assert.ok(second.every((x) => x >= 20 && x <= 460)); assert.ok(second.some((x, i) => Math.abs(x - first[i]) >= 18));
});
